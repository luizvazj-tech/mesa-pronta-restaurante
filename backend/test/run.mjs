import assert from 'node:assert/strict';
import { makeBackend } from './harness.mjs';

const b = await makeBackend();
const { call } = b;
let n = 0; const ok = (name) => console.log(`ok ${++n} - ${name}`);

// cadastro
let r = await call('POST', '/signup', { body: { restaurante: 'Sabor da Casa', nome: 'Ana', email: 'ana@x.com', pin: '1234' } });
assert.equal(r.status, 200); const A = r.data; assert.equal(A.tenant.slug, 'sabor-da-casa'); ok('cadastro cria restaurante e proprietário');
r = await call('POST', '/signup', { body: { restaurante: 'Sabor da Casa', nome: 'Beto', email: 'b@x.com', pin: '1234' } });
assert.equal(r.status, 409); ok('código de restaurante duplicado é recusado');
r = await call('POST', '/signup', { body: { restaurante: 'Outro Lugar', nome: 'Beto', email: 'b@x.com', pin: '12' } });
assert.equal(r.status, 400); ok('PIN inválido é recusado');
r = await call('POST', '/signup', { body: { restaurante: 'Cantina Dois', nome: 'Caio', email: 'c@x.com', pin: '9999' } });
const B = r.data; assert.equal(B.tenant.slug, 'cantina-dois'); ok('segundo restaurante criado');

// login
r = await call('GET', '/public/users', { query: { slug: 'sabor-da-casa' } });
assert.deepEqual(r.data.users.map(u => u.nome), ['Ana']); const anaId = r.data.users[0].id;
r = await call('POST', '/login', { body: { slug: 'sabor-da-casa', userId: anaId, pin: '0000' } }); assert.equal(r.status, 401);
r = await call('POST', '/login', { body: { slug: 'sabor-da-casa', userId: anaId, pin: '1234' } }); assert.equal(r.status, 200); const tokA = r.data.token; ok('login com PIN certo e erro com PIN errado');
for (let i = 0; i < 5; i++) await call('POST', '/login', { body: { slug: 'sabor-da-casa', userId: anaId, pin: '0000' } });
r = await call('POST', '/login', { body: { slug: 'sabor-da-casa', userId: anaId, pin: '1234' } }); assert.equal(r.status, 429); ok('bloqueio após 5 PINs errados');
b.advance(61000);
r = await call('POST', '/login', { body: { slug: 'sabor-da-casa', userId: anaId, pin: '1234' } }); assert.equal(r.status, 200); ok('bloqueio expira');
r = await call('GET', '/sync', {}); assert.equal(r.status, 401); ok('sem token não acessa');
r = await call('GET', '/sync', { token: tokA + 'x' }); assert.equal(r.status, 401); ok('token adulterado é recusado');

// usuários
r = await call('POST', '/users', { token: tokA, body: { nome: 'Caixa 1', perfil: 'caixa', pin: '3456' } }); assert.equal(r.status, 200); const caixaId = r.data.user.id;
r = await call('POST', '/login', { body: { slug: 'sabor-da-casa', userId: caixaId, pin: '3456' } }); const tokC = r.data.token;
r = await call('POST', '/users', { token: tokC, body: { nome: 'Invasor', perfil: 'dono', pin: '1111' } }); assert.equal(r.status, 403); ok('caixa não cria usuário');
r = await call('POST', '/users', { token: tokA, body: { id: anaId, nome: 'Ana', perfil: 'caixa', ativo: true } }); assert.equal(r.status, 400); ok('último proprietário não pode ser rebaixado');
r = await call('POST', '/authorize', { token: tokC, body: { acao: 'desconto', pin: '3456' } }); assert.equal(r.status, 403); ok('caixa não autoriza desconto');
r = await call('POST', '/authorize', { token: tokC, body: { acao: 'desconto', pin: '1234' } }); assert.equal(r.status, 200); assert.equal(r.data.nome, 'Ana'); ok('PIN do proprietário autoriza desconto');
r = await call('POST', '/users/pin', { token: tokC, body: { atual: '3456', novo: '6543' } }); assert.equal(r.status, 200);
r = await call('POST', '/login', { body: { slug: 'sabor-da-casa', userId: caixaId, pin: '6543' } }); assert.equal(r.status, 200); ok('troca do próprio PIN');

// sync: dois dispositivos
const prod = { id: 'p1', nome: 'Prato', preco: 20 };
r = await call('POST', '/sync', { token: tokA, body: { changes: [{ c: 'produtos', id: 'p1', d: prod }, { c: 'insumos', id: 'arroz', d: { id: 'arroz', nome: 'Arroz', estoque: 25, min: 8 } }] } }); assert.equal(r.status, 200);
r = await call('GET', '/sync', { token: tokC, query: { since: '0' } });
assert.equal(r.data.records.length, 2); assert.equal(r.data.records.find(x => x.c === 'insumos').d.estoque, 25); const cur = r.data.cs; ok('outro dispositivo recebe os registros');
// isolamento
r = await call('GET', '/sync', { token: B.token, query: { since: '0' } }); assert.equal(r.data.records.length, 0); ok('restaurantes são isolados');
// estoque por delta de dois dispositivos
await call('POST', '/sync', { token: tokA, body: { incs: [{ c: 'insumos', id: 'arroz', delta: -3 }] } });
await call('POST', '/sync', { token: tokC, body: { incs: [{ c: 'insumos', id: 'arroz', delta: -2 }] } });
r = await call('GET', '/sync', { token: tokA, query: { since: String(cur) } });
assert.equal(r.data.records.length, 1); assert.equal(r.data.records[0].d.estoque, 20); ok('baixas simultâneas de estoque somam (25-3-2=20)');
// editar insumo não zera estoque
await call('POST', '/sync', { token: tokA, body: { changes: [{ c: 'insumos', id: 'arroz', d: { id: 'arroz', nome: 'Arroz agulhinha', estoque: 999, min: 10 } }] } });
r = await call('GET', '/sync', { token: tokA, query: { since: '0' } });
const ins = r.data.records.find(x => x.c === 'insumos'); assert.equal(ins.d.nome, 'Arroz agulhinha'); assert.equal(ins.d.estoque, 20); ok('editar cadastro preserva o estoque do servidor');
// exclusão
await call('POST', '/sync', { token: tokA, body: { changes: [{ c: 'produtos', id: 'p1', del: true }] } });
r = await call('GET', '/sync', { token: tokC, query: { since: '0' } }); assert.equal(r.data.records.find(x => x.c === 'produtos').del, true); ok('exclusão chega como marcador');
r = await call('POST', '/sync', { token: tokA, body: { changes: [{ c: 'users', id: 'x', d: {} }] } }); assert.equal(r.status, 400); ok('coleção fora da lista é recusada');
// paginação
const many = Array.from({ length: 320 }, (_, i) => ({ c: 'vendas', id: 'v' + i, d: { id: 'v' + i, total: i } }));
await call('POST', '/sync', { token: tokA, body: { changes: many.slice(0, 160) } }); await call('POST', '/sync', { token: tokA, body: { changes: many.slice(160) } });
let since = 0, got = 0, pages = 0; for (;;) { r = await call('GET', '/sync', { token: tokC, query: { since: String(since) } }); got += r.data.records.length; since = r.data.cs; pages++; if (!r.data.more) break; }
assert.ok(got >= 320 && pages >= 2); ok('paginação do sync (' + pages + ' páginas)');

// contador e NFC-e
const nums = await Promise.all([1, 2, 3, 4, 5].map(() => call('POST', '/counter', { token: tokA, body: { name: 'venda' } })));
assert.equal(new Set(nums.map(x => x.data.n)).size, 5); ok('contador de vendas é atômico e sem repetição');
const pl = { numero: 0, serie: 1, emitente: { cnpj: '12.345.678/0001-95', uf: 'PR' } };
r = await call('POST', '/nfce/transmit', { token: tokC, body: { payload: pl } }); assert.equal(r.data.numero, 1); assert.equal(r.data.chave.length, 44); assert.equal(r.data.status, 'autorizada');
r = await call('POST', '/nfce/transmit', { token: tokC, body: { payload: pl } }); assert.equal(r.data.numero, 2); ok('NFC-e: número sequencial atribuído pelo servidor, chave de 44 dígitos');
const plr = { ...pl, ref: 'venda-xyz' };
const t1 = await call('POST', '/nfce/transmit', { token: tokC, body: { payload: plr } }); const t2 = await call('POST', '/nfce/transmit', { token: tokC, body: { payload: plr } });
assert.equal(t1.data.numero, t2.data.numero); assert.equal(t1.data.chave, t2.data.chave); ok('reenvio da mesma venda devolve o mesmo número e a mesma chave (idempotente)');
r = await call('POST', '/nfce/transmit', { token: tokC, body: { payload: { ...pl, ref: 'venda-forjada', numero: 9000 } } }); assert.ok(r.data.numero < 100); ok('o número da NFC-e nunca vem do cliente');
r = await call('POST', '/nfce/transmit', { token: tokC, body: { payload: { ...pl, emitente: { cnpj: '12.ABC.345/01DE-35', uf: 'PR' } } } });
assert.equal(r.data.chave.length, 44); assert.ok(r.data.chave.includes('12ABC34501DE35')); assert.match(r.data.chave, /^[0-9A-Z]{43}[0-9]$/); ok('CNPJ alfanumérico: chave de 44 posições com letras no CNPJ');
r = await call('POST', '/nfce/transmit', { token: tokC, body: { payload: { ...pl, emitente: { cnpj: '12.ABC.345/01DE-36', uf: 'PR' } } } }); assert.equal(r.status, 400); ok('CNPJ com dígito verificador inválido é rejeitado pelo servidor');
r = await call('PUT', '/fiscal', { token: tokC, body: { provedor: 'api', url: 'https://x', token: 'seg' } }); assert.equal(r.status, 403); ok('só o proprietário configura o fiscal');
r = await call('PUT', '/fiscal', { token: tokA, body: { provedor: 'api', url: 'http://inseguro' } }); assert.equal(r.status, 400); ok('URL do provedor exige https');
r = await call('GET', '/nao-existe', { token: tokA }); assert.equal(r.status, 404);
// ===== regressões da auditoria =====
const pull = async tok => { let since = 0, all = []; for (;;) { const x = await call('GET', '/sync', { token: tok, query: { since: String(since) } }); all = all.concat(x.data.records); since = x.data.cs; if (!x.data.more) return all; } };
r = await call('POST', '/users', { token: tokA, body: { nome: 'Caixa Aud', perfil: 'caixa', pin: '1111' } }); const cxId = r.data.user.id;
r = await call('POST', '/login', { body: { slug: 'sabor-da-casa', userId: cxId, pin: '1111' } }); const tokCx = r.data.token;
r = await call('POST', '/sync', { token: tokCx, body: { changes: [{ c: 'cfg', id: 'main', d: { nome: 'hack' } }, { c: 'contas', id: 'k9', d: { valor: 1 } }, { c: 'vendas', id: 'vok', d: { id: 'vok', total: 1 } }] } });
assert.equal(r.data.rej, 2); const recs = await pull(tokA);
assert.ok(!recs.some(x => x.c === 'contas' && x.id === 'k9') && recs.some(x => x.c === 'vendas' && x.id === 'vok')); ok('caixa não grava cfg nem contas; venda (operacional) passa');
await call('POST', '/sync', { token: tokA, body: { changes: [{ c: 'audit', id: 'au1', d: { acao: 'original' } }] } });
r = await call('POST', '/sync', { token: tokCx, body: { changes: [{ c: 'audit', id: 'au1', d: { acao: 'adulterado' } }, { c: 'audit', id: 'au1', del: true }] } }); assert.equal(r.data.rej, 2);
const au = (await pull(tokA)).find(x => x.c === 'audit' && x.id === 'au1'); assert.equal(au.d.acao, 'original'); assert.equal(au.del, false); ok('trilha de auditoria é somente de inclusão (sem alterar nem apagar)');
await call('POST', '/users', { token: tokA, body: { id: cxId, nome: 'Caixa Aud', perfil: 'garcom', pin: '' } });
r = await call('POST', '/nfce/transmit', { token: tokCx, body: { payload: { ...pl, ref: 'r-garcom' } } }); assert.equal(r.status, 403); ok('perfil rebaixado perde a permissão imediatamente (sem esperar o token vencer)');
await call('POST', '/users', { token: tokA, body: { id: cxId, nome: 'Caixa Aud', perfil: 'garcom', ativo: false } });
r = await call('GET', '/sync', { token: tokCx, query: { since: '0' } }); assert.equal(r.status, 401); ok('usuário desativado perde o acesso imediatamente');
r = await call('POST', '/users', { token: tokA, body: { nome: 'Gar1', perfil: 'garcom', pin: '4444' } }); const g1 = (await call('POST', '/login', { body: { slug: 'sabor-da-casa', userId: r.data.user.id, pin: '4444' } })).data.token;
for (let i = 0; i < 5; i++) await call('POST', '/authorize', { token: g1, body: { acao: 'desconto', pin: '0000' } });
r = await call('POST', '/authorize', { token: tokA, body: { acao: 'desconto', pin: '1234' } }); assert.equal(r.status, 200); ok('garçom que erra PINs não bloqueia a autorização do proprietário');
r = await call('POST', '/authorize', { token: g1, body: { acao: 'desconto', pin: '1234' } }); assert.equal(r.status, 429); ok('o bloqueio vale só para quem errou');
r = await call('POST', '/sync', { token: g1, body: { changes: [{ c: 'mesas', id: 'm99', d: { id: 'm99', num: 99, ativa: true } }] } }); assert.equal(r.data.rej, 1);
r = await call('POST', '/sync', { token: tokA, body: { changes: [{ c: 'mesas', id: 'm99', d: { id: 'm99', num: 99, ativa: true } }] } }); assert.equal(r.data.rej, 0);
assert.ok((await pull(g1)).some(x => x.c === 'mesas' && x.id === 'm99')); ok('só proprietário e gerente gravam mesas; garçom as recebe');
{ const id = (await call('GET', '/public/users', { query: { slug: 'cantina-dois' } })).data.users[0].id;
  for (let i = 0; i < 5; i++) await call('POST', '/login', { body: { slug: 'cantina-dois', userId: id, pin: '0000' } }); b.advance(61000);
  for (let i = 0; i < 5; i++) await call('POST', '/login', { body: { slug: 'cantina-dois', userId: id, pin: '0000' } }); b.advance(61000);
  r = await call('POST', '/login', { body: { slug: 'cantina-dois', userId: id, pin: '9999' } }); assert.equal(r.status, 429); b.advance(60000);
  r = await call('POST', '/login', { body: { slug: 'cantina-dois', userId: id, pin: '9999' } }); assert.equal(r.status, 200); ok('bloqueio progressivo no login: 1ª falha 1 min, 2ª 2 min; zera ao acertar'); }
await b.close(); console.log('\n' + n + ' verificações passaram'); process.exit(0);
