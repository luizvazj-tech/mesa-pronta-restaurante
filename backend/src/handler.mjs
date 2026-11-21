// Mesa Pronta - API multi-restaurante (AWS Lambda + API Gateway HTTP API + DynamoDB)
// Tabela única. Cada restaurante (tenant) usa a partição T#<tid>; o token JWT carrega o tid,
// então nenhuma consulta consegue sair da partição do próprio restaurante.
import crypto from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
const bad = m => new HttpError(400, m);
const COLLS = ['produtos', 'insumos', 'comandas', 'vendas', 'delivery', 'entregadores', 'notas', 'contas', 'producao', 'movEst', 'caixaHist', 'audit', 'gorjEquipe', 'gorjLanc', 'gorjFech', 'mesas', 'cfg', 'caixa'];
const CAN = { dono: '*', gerente: ['desconto', 'cancelar', 'sangria', 'cancnota', 'fechacaixa', 'contas', 'ajusteest'], caixa: ['fechacaixa'], garcom: [], cozinha: ['ajusteest'] };
const PERFIS = Object.keys(CAN);
// Quem pode GRAVAR cada coleção (as demais são operacionais e ficam abertas a qualquer perfil autenticado).
// 'audit' é somente de inclusão: ninguém altera nem apaga registro existente.
const WRITE = { cfg: ['dono'], produtos: ['dono', 'gerente'], insumos: ['dono', 'gerente', 'cozinha'], contas: ['dono', 'gerente'], gorjEquipe: ['dono', 'gerente'], gorjLanc: ['dono', 'gerente'], gorjFech: ['dono', 'gerente'], mesas: ['dono', 'gerente'] };
const NFCE_PERFIS = ['dono', 'gerente', 'caixa'];
const lockMs = strikes => Math.min(60000 * 2 ** Math.min(strikes || 0, 6), 3600000); // 1 min, 2, 4 ... até 1 h
const can = (perfil, a) => a === 'usuarios' ? perfil === 'dono' : CAN[perfil] === '*' || (CAN[perfil] || []).includes(a);
const RESERVED = new Set(['admin', 'api', 'www', 'app', 'login', 'signup', 'mesa-pronta']);
const UFC = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };

const b64u = b => Buffer.from(b).toString('base64url');
const sign = (claims, secret) => { const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64u(JSON.stringify(claims)); return `${h}.${p}.${crypto.createHmac('sha256', secret).update(h + '.' + p).digest('base64url')}`; };
function verify(tok, secret, nowS) {
  const [h, p, s] = String(tok || '').split('.');
  if (!s) throw new HttpError(401, 'Sessão inválida.');
  const e = crypto.createHmac('sha256', secret).update(h + '.' + p).digest('base64url');
  const a = Buffer.from(s), b = Buffer.from(e);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Sessão inválida.');
  const c = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (!(c.exp > nowS)) throw new HttpError(401, 'Sessão expirada.');
  return c;
}
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const pinOk = (pin, salt, hash) => { const a = Buffer.from(hashPin(pin, salt), 'hex'), b = Buffer.from(hash, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const validPin = p => /^\d{4,6}$/.test(String(p || ''));
const slugify = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const cnpjLimpo = s => String(s == null ? '' : s).toUpperCase().replace(/[^0-9A-Z]/g, '');
const valCar = ch => ch.charCodeAt(0) - 48; // Receita Federal / NT Conjunta 2025.001: ASCII menos 48
function dvCnpj(base) { const dv = (s, w) => { let t = 0; for (let i = 0; i < w.length; i++) t += valCar(s[i]) * w[i]; const r = t % 11; return r < 2 ? 0 : 11 - r; }; const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return '' + d1 + dv(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); }
export function validaCnpj(c) { c = cnpjLimpo(c); return /^[0-9A-Z]{12}[0-9]{2}$/.test(c) && !/^(.)\1+$/.test(c) && dvCnpj(c.slice(0, 12)) === c.slice(12); }
const dv11 = s => { let p = 2, sum = 0; for (let i = s.length - 1; i >= 0; i--) { sum += valCar(s[i]) * p; p = p === 9 ? 2 : p + 1; } const r = sum % 11; return r < 2 ? 0 : 11 - r; };

export function createApp(deps) {
  const { doc, table, getSecret, now = () => Date.now(), fetchFn = globalThis.fetch, signupEnabled = true } = deps;
  const T = tid => `T#${tid}`;
  const get = async (PK, SK) => (await doc.send(new GetCommand({ TableName: table, Key: { PK, SK } }))).Item;
  const put = (Item, cond) => doc.send(new PutCommand({ TableName: table, Item, ...(cond ? { ConditionExpression: cond } : {}) }));
  const upd = (PK, SK, expr, vals, names, extra = {}) => doc.send(new UpdateCommand({ TableName: table, Key: { PK, SK }, UpdateExpression: expr, ExpressionAttributeValues: vals, ...(names ? { ExpressionAttributeNames: names } : {}), ReturnValues: 'ALL_NEW', ...extra }));
  const users = async tid => (await doc.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'PK = :p AND begins_with(SK, :s)', ExpressionAttributeValues: { ':p': T(tid), ':s': 'U#' } }))).Items || [];
  const pubUser = u => ({ id: u.uid, nome: u.nome, perfil: u.perfil, ativo: !!u.ativo, ultimo: u.ultimo || '' });
  const nextCounter = async (tid, field, n = 1) => (await upd(T(tid), 'META', 'ADD #f :n', { ':n': n }, { '#f': field })).Attributes[field];

  async function auth(event) {
    const h = event.headers || {};
    const m = /^Bearer (.+)$/i.exec(h.authorization || h.Authorization || '');
    if (!m) throw new HttpError(401, 'Faça login.');
    const c = verify(m[1], await getSecret(), Math.floor(now() / 1000));
    // O token só prova a identidade; perfil e situação vêm do cadastro atual (usuário desativado ou rebaixado perde acesso na hora).
    const u = await get(T(c.tid), `U#${c.uid}`);
    if (!u || !u.ativo) throw new HttpError(401, 'Sessão encerrada.');
    return { ...c, perfil: u.perfil, nome: u.nome, u }; // {tid, uid, perfil, nome, u}
  }
  const issue = async (u, tenant) => sign({ tid: tenant.tid, uid: u.uid, perfil: u.perfil, nome: u.nome, exp: Math.floor(now() / 1000) + 12 * 3600 }, await getSecret());

  const routes = {};
  const route = (method, path, fn) => { routes[`${method} ${path}`] = fn; };

  route('GET', '/health', async () => ({ ok: true }));

  route('POST', '/signup', async ({ body }) => {
    if (!signupEnabled) throw new HttpError(403, 'Cadastro de novos restaurantes está desativado.');
    const nome = String(body.restaurante || '').trim(), dono = String(body.nome || '').trim(), email = String(body.email || '').trim().toLowerCase();
    if (nome.length < 2 || nome.length > 80) throw bad('Informe o nome do restaurante (2 a 80 caracteres).');
    if (dono.length < 2 || dono.length > 60) throw bad('Informe o seu nome.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('E-mail inválido.');
    if (!validPin(body.pin)) throw bad('O PIN precisa ter de 4 a 6 números.');
    const slug = slugify(body.slug || nome);
    if (slug.length < 3 || RESERVED.has(slug)) throw bad('Escolha outro código para o restaurante (mínimo 3 letras ou números).');
    const tid = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    try { await put({ PK: `SLUG#${slug}`, SK: 'SLUG', tid }, 'attribute_not_exists(PK)'); }
    catch (e) { if (e.name === 'ConditionalCheckFailedException') throw new HttpError(409, 'Este código de restaurante já existe. Escolha outro.'); throw e; }
    const nowIso = new Date(now()).toISOString();
    await put({ PK: T(tid), SK: 'META', tid, slug, nome, email, criado: nowIso, chg: 0, n_venda: 0, n_nfce: 0 });
    const salt = crypto.randomBytes(16).toString('hex'), uid = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const u = { PK: T(tid), SK: `U#${uid}`, uid, nome: dono, perfil: 'dono', ativo: true, ps: salt, ph: hashPin(body.pin, salt), fails: 0, lockUntil: 0, ultimo: nowIso };
    await put(u);
    return { token: await issue(u, { tid }), user: pubUser(u), tenant: { id: tid, slug, nome } };
  });

  route('GET', '/public/users', async ({ query }) => {
    const s = await get(`SLUG#${slugify(query.slug || '')}`, 'SLUG');
    if (!s) throw new HttpError(404, 'Restaurante não encontrado.');
    const meta = await get(T(s.tid), 'META');
    return { restaurante: meta.nome, users: (await users(s.tid)).filter(u => u.ativo).map(u => ({ id: u.uid, nome: u.nome })) };
  });

  route('POST', '/login', async ({ body }) => {
    const s = await get(`SLUG#${slugify(body.slug || '')}`, 'SLUG');
    const fail = new HttpError(401, 'Código do restaurante, usuário ou PIN incorreto.');
    if (!s) throw fail;
    const u = await get(T(s.tid), `U#${String(body.userId || '')}`);
    if (!u || !u.ativo) throw fail;
    if (u.lockUntil > now()) throw new HttpError(429, `Muitas tentativas. Aguarde ${Math.ceil((u.lockUntil - now()) / 1000)} s.`);
    if (!pinOk(body.pin, u.ps, u.ph)) {
      const r = await upd(T(s.tid), u.SK, 'ADD fails :one', { ':one': 1 });
      if (r.Attributes.fails >= 5) await upd(T(s.tid), u.SK, 'SET fails = :z, lockUntil = :l, strikes = :k', { ':z': 0, ':l': now() + lockMs(u.strikes), ':k': (u.strikes || 0) + 1 });
      throw fail;
    }
    await upd(T(s.tid), u.SK, 'SET fails = :z, strikes = :z, ultimo = :u', { ':z': 0, ':u': new Date(now()).toISOString() });
    const meta = await get(T(s.tid), 'META');
    return { token: await issue(u, s), user: pubUser(u), tenant: { id: s.tid, slug: meta.slug, nome: meta.nome } };
  });

  route('GET', '/users', async ({ claims }) => ({ users: (await users(claims.tid)).map(pubUser) }));

  route('POST', '/users', async ({ claims, body }) => {
    if (!can(claims.perfil, 'usuarios')) throw new HttpError(403, 'Somente o proprietário gerencia usuários.');
    const nome = String(body.nome || '').trim();
    if (nome.length < 2 || nome.length > 60) throw bad('Informe o nome.');
    if (!PERFIS.includes(body.perfil)) throw bad('Perfil inválido.');
    const all = await users(claims.tid);
    if (body.id) {
      const u = all.find(x => x.uid === body.id);
      if (!u) throw new HttpError(404, 'Usuário não encontrado.');
      const ativo = body.ativo !== false;
      const outros = all.filter(x => x.uid !== u.uid && x.ativo && x.perfil === 'dono');
      if (u.perfil === 'dono' && (body.perfil !== 'dono' || !ativo) && !outros.length) throw bad('Mantenha ao menos um proprietário ativo.');
      let expr = 'SET nome = :n, perfil = :p, ativo = :a'; const vals = { ':n': nome, ':p': body.perfil, ':a': ativo };
      if (body.pin) { if (!validPin(body.pin)) throw bad('O PIN precisa ter de 4 a 6 números.'); const salt = crypto.randomBytes(16).toString('hex'); expr += ', ps = :s, ph = :h, fails = :z, lockUntil = :z'; vals[':s'] = salt; vals[':h'] = hashPin(body.pin, salt); vals[':z'] = 0; }
      return { user: pubUser((await upd(T(claims.tid), u.SK, expr, vals)).Attributes) };
    }
    if (!validPin(body.pin)) throw bad('O PIN precisa ter de 4 a 6 números.');
    if (all.length >= 50) throw bad('Limite de usuários atingido.');
    const salt = crypto.randomBytes(16).toString('hex'), uid = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const u = { PK: T(claims.tid), SK: `U#${uid}`, uid, nome, perfil: body.perfil, ativo: true, ps: salt, ph: hashPin(body.pin, salt), fails: 0, lockUntil: 0, ultimo: '' };
    await put(u);
    return { user: pubUser(u) };
  });

  route('POST', '/users/pin', async ({ claims, body }) => {
    const u = await get(T(claims.tid), `U#${claims.uid}`);
    if (!u || !pinOk(body.atual, u.ps, u.ph)) throw new HttpError(403, 'PIN atual incorreto.');
    if (!validPin(body.novo)) throw bad('O novo PIN precisa ter de 4 a 6 números.');
    const salt = crypto.randomBytes(16).toString('hex');
    await upd(T(claims.tid), u.SK, 'SET ps = :s, ph = :h', { ':s': salt, ':h': hashPin(body.novo, salt) });
    return { ok: true };
  });

  route('POST', '/authorize', async ({ claims, body }) => {
    const me = claims.u, key = { PK: T(claims.tid), SK: me.SK };
    if ((me.aLock || 0) > now()) throw new HttpError(429, `Muitas tentativas. Aguarde ${Math.ceil((me.aLock - now()) / 1000)} s.`);
    const u = (await users(claims.tid)).find(x => x.ativo && can(x.perfil, body.acao) && pinOk(body.pin, x.ps, x.ph));
    if (!u) {
      const r = await upd(key.PK, key.SK, 'ADD aFails :one', { ':one': 1 });
      if (r.Attributes.aFails >= 5) await upd(key.PK, key.SK, 'SET aFails = :z, aLock = :l, aStrikes = :k', { ':z': 0, ':l': now() + lockMs(me.aStrikes), ':k': (me.aStrikes || 0) + 1 });
      throw new HttpError(403, 'Este PIN não autoriza a ação.');
    }
    await upd(key.PK, key.SK, 'SET aFails = :z, aStrikes = :z', { ':z': 0 });
    return { ok: true, nome: u.nome };
  });

  // ----- Sincronização por registros (delta por cursor) -----
  const outRec = it => { const d = it.del ? null : JSON.parse(it.j); if (d && it.c === 'insumos') d.estoque = it.est; return { c: it.c, id: it.id, d, del: !!it.del, cs: it.cs }; };
  route('GET', '/sync', async ({ claims, query }) => {
    const since = Math.max(0, Number(query.since) || 0);
    const r = await doc.send(new QueryCommand({ TableName: table, IndexName: 'GSI1', KeyConditionExpression: 'GSI1PK = :p AND GSI1SK > :s', ExpressionAttributeValues: { ':p': T(claims.tid), ':s': since }, Limit: 300 }));
    const items = r.Items || [];
    return { cs: items.length ? items[items.length - 1].cs : since, records: items.map(outRec), more: !!r.LastEvaluatedKey };
  });
  route('POST', '/sync', async ({ claims, body }) => {
    const changes = Array.isArray(body.changes) ? body.changes : [], incs = Array.isArray(body.incs) ? body.incs : [];
    if (changes.length + incs.length > 200) throw bad('Lote grande demais (máximo de 200 alterações).');
    const total = changes.length + incs.length;
    if (!total) return { ok: true };
    for (const ch of changes) if (!ch || !COLLS.includes(ch.c) || typeof ch.id !== 'string' || !ch.id || ch.id.length > 64) throw bad('Registro inválido.');
    let rej = 0; const permitido = ch => !(WRITE[ch.c] && !WRITE[ch.c].includes(claims.perfil)) && !(ch.c === 'audit' && ch.del);
    const last = await nextCounter(claims.tid, 'chg', total);
    let cs = last - total;
    for (const ch of changes) {
      cs++;
      if (!permitido(ch)) { rej++; continue; }
      const key = { PK: T(claims.tid), SK: `R#${ch.c}#${ch.id}` };
      const base = { ':c': ch.c, ':id': ch.id, ':cs': cs, ':g': T(claims.tid) };
      if (ch.del) { await upd(key.PK, key.SK, 'SET c = :c, id = :id, #d = :t, cs = :cs, GSI1PK = :g, GSI1SK = :cs', { ...base, ':t': true }, { '#d': 'del' }); continue; }
      const d = { ...ch.d }; const est = Number(d.estoque) || 0; if (ch.c === 'insumos') delete d.estoque;
      const j = JSON.stringify(d); if (j.length > 100000) throw bad('Registro grande demais.');
      if (ch.c === 'insumos') await upd(key.PK, key.SK, 'SET c = :c, id = :id, j = :j, #d = :f, cs = :cs, GSI1PK = :g, GSI1SK = :cs, est = if_not_exists(est, :e)', { ...base, ':j': j, ':f': false, ':e': est }, { '#d': 'del' });
      else if (ch.c === 'audit') { try { await upd(key.PK, key.SK, 'SET c = :c, id = :id, j = :j, #d = :f, cs = :cs, GSI1PK = :g, GSI1SK = :cs', { ...base, ':j': j, ':f': false }, { '#d': 'del' }, { ConditionExpression: 'attribute_not_exists(PK)' }); } catch (e) { if (e.name !== 'ConditionalCheckFailedException') throw e; rej++; } }
      else await upd(key.PK, key.SK, 'SET c = :c, id = :id, j = :j, #d = :f, cs = :cs, GSI1PK = :g, GSI1SK = :cs', { ...base, ':j': j, ':f': false }, { '#d': 'del' });
    }
    for (const ic of incs) {
      cs++;
      if (ic.c !== 'insumos' || typeof ic.id !== 'string' || !Number.isFinite(Number(ic.delta))) throw bad('Ajuste inválido.');
      try { await upd(T(claims.tid), `R#insumos#${ic.id}`, 'ADD est :d SET cs = :cs, GSI1PK = :g, GSI1SK = :cs', { ':d': Number(ic.delta), ':cs': cs, ':g': T(claims.tid) }, null, { ConditionExpression: 'attribute_exists(PK)' }); }
      catch (e) { if (e.name !== 'ConditionalCheckFailedException') throw e; }
    }
    return { ok: true, cs: last, rej };
  });

  route('POST', '/counter', async ({ claims, body }) => {
    if (body.name !== 'venda') throw bad('Contador inválido.');
    return { n: await nextCounter(claims.tid, 'n_venda') };
  });

  // ----- Fiscal: o token do emissor fica só no servidor -----
  route('GET', '/fiscal', async ({ claims }) => {
    if (!can(claims.perfil, 'usuarios')) throw new HttpError(403, 'Somente o proprietário acessa a configuração fiscal.');
    const f = (await get(T(claims.tid), 'META')).fiscal || {};
    return { fiscal: { provedor: f.provedor || 'simulado', url: f.url || '', tokenDefinido: !!f.token } };
  });
  route('PUT', '/fiscal', async ({ claims, body }) => {
    if (!can(claims.perfil, 'usuarios')) throw new HttpError(403, 'Somente o proprietário altera a configuração fiscal.');
    const meta = await get(T(claims.tid), 'META'), f = { ...(meta.fiscal || {}) };
    if (body.provedor) { if (!['simulado', 'api'].includes(body.provedor)) throw bad('Provedor inválido.'); f.provedor = body.provedor; }
    if (typeof body.url === 'string') { if (body.url && !/^https:\/\//.test(body.url)) throw bad('A URL do provedor precisa começar com https://.'); f.url = body.url; }
    if (typeof body.token === 'string' && body.token) f.token = body.token;
    await upd(T(claims.tid), 'META', 'SET fiscal = :f', { ':f': f });
    return { ok: true };
  });
  route('POST', '/nfce/transmit', async ({ claims, body }) => {
    if (!NFCE_PERFIS.includes(claims.perfil)) throw new HttpError(403, 'Seu perfil não emite NFC-e.');
    const p = body.payload || {}, e = p.emitente || {};
    const ref = typeof p.ref === 'string' && p.ref && p.ref.length <= 64 ? p.ref : '';
    const meta = await get(T(claims.tid), 'META'), f = meta.fiscal || { provedor: 'simulado' };
    if (e.cnpj && !validaCnpj(e.cnpj)) throw bad('CNPJ do emitente inválido.');
    // Idempotência: a mesma venda nunca gera dois números. Autorizada/rejeitada devolve o resultado guardado; pendente reaproveita o número.
    const nvKey = ref ? { PK: T(claims.tid), SK: `NV#${ref}` } : null;
    const prev = nvKey ? await get(nvKey.PK, nvKey.SK) : null;
    if (prev && prev.status !== 'pendente') return { numero: prev.numero, status: prev.status, chave: prev.chave, protocolo: prev.protocolo, msg: prev.msg };
    const numero = prev ? prev.numero : await nextCounter(claims.tid, 'n_nfce'); // o número NUNCA vem do cliente
    const full = { ...p, numero };
    const guarda = async r => { if (nvKey) await put({ ...nvKey, numero, status: r.status, chave: r.chave, protocolo: r.protocolo, msg: r.msg, em: new Date(now()).toISOString() }); return r; };
    if (f.provedor === 'api' && f.url) {
      if (!e.cnpj) throw bad('Informe o CNPJ do emitente nas configurações fiscais.');
      try {
        const r = await fetchFn(f.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (f.token || '') }, body: JSON.stringify(full) });
        const j = await r.json().catch(() => ({}));
        if (r.ok && (j.status === 'autorizada' || j.chave)) return guarda({ numero, status: 'autorizada', chave: j.chave || '', protocolo: j.protocolo || '', msg: j.mensagem || 'Autorizada.' });
        return guarda({ numero, status: 'rejeitada', chave: '', protocolo: '', msg: j.mensagem || `Rejeitada pelo provedor (HTTP ${r.status}).` });
      } catch { return guarda({ numero, status: 'pendente', chave: '', protocolo: '', msg: 'Provedor inacessível: nota pendente de transmissão.' }); }
    }
    const d = new Date(now()), aamm = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0');
    const base = String(UFC[e.uf] || 41) + aamm + cnpjLimpo(e.cnpj).padStart(14, '0').slice(0, 14) + '65' + String(p.serie || 1).padStart(3, '0') + String(numero).padStart(9, '0') + '1' + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
    return guarda({ numero, status: 'autorizada', chave: base + dv11(base), protocolo: 'SIM' + String(now()).slice(-9), msg: 'Autorizada em simulação, sem valor fiscal.' });
  });

  return async function handler(event) {
    try {
      const method = event.requestContext?.http?.method || event.httpMethod, path = (event.rawPath || event.path || '/').replace(/\/+$/, '') || '/';
      if (method === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
      const fn = routes[`${method} ${path}`];
      if (!fn) throw new HttpError(404, 'Rota não encontrada.');
      let body = {};
      if (event.body) { try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); } catch { throw bad('Corpo inválido.'); } }
      const open = ['/health', '/signup', '/login', '/public/users'].includes(path);
      const claims = open ? null : await auth(event);
      const out = await fn({ event, body, query: event.queryStringParameters || {}, claims });
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(out) };
    } catch (e) {
      const status = e.status || 500; if (!e.status) console.error(e);
      return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ erro: e.status ? e.message : 'Erro interno.' }) };
    }
  };
}

let cached;
export const handler = async event => {
  if (!cached) {
    const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
    const sm = new SecretsManagerClient({}); let secret;
    cached = createApp({ doc, table: process.env.TABLE_NAME, signupEnabled: process.env.SIGNUP_ENABLED !== 'false',
      getSecret: async () => secret || (secret = (await sm.send(new GetSecretValueCommand({ SecretId: process.env.JWT_SECRET_ARN }))).SecretString) });
  }
  return cached(event);
};
