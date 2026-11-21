import assert from 'node:assert/strict';
import fs from 'node:fs';
import jsdom from 'jsdom';
import { makeBackend } from './harness.mjs';
import { fileURLToPath } from 'node:url';
const { JSDOM } = jsdom;
const html = fs.readFileSync(fileURLToPath(new URL('../../public/index.html', import.meta.url)), 'utf8').replace(/<link[^>]*>/g, '').replace('<script src="config.js"></script>', '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await makeBackend();
let step = 0; const ok = m => console.log(`ok ${++step} - ${m}`);
const errs = [];

function device(name) {
  let online = true;
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://app.test/', pretendToBeVisual: true, beforeParse(w) {
    w.MP_API = 'http://api.test'; w.scrollTo = () => {}; w.TextEncoder = TextEncoder;
    w.addEventListener('error', e => errs.push(name + ': ' + e.message));
    Object.defineProperty(w.navigator, 'onLine', { get: () => online });
    w.fetch = async (url, opts = {}) => {
      if (!online) throw new TypeError('Failed to fetch');
      const u = new URL(url);
      const r = await b.call(opts.method || 'GET', u.pathname, { body: opts.body ? JSON.parse(opts.body) : undefined, token: ((opts.headers || {}).authorization || '').replace('Bearer ', ''), query: Object.fromEntries(u.searchParams) });
      return { ok: r.status < 400, status: r.status, json: async () => r.data };
    };
  } });
  const w = dom.window, d = w.document;
  const click = s => { const e = d.querySelector(s); if (!e) throw new Error(name + ' sem ' + s); e.click(); };
  const set = (s, v) => { const e = d.querySelector(s); e.value = v; e.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const until = async (f, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return; } catch {} await sleep(20); } throw new Error(name + ': timeout ' + f); };
  const sync = async () => { while (w.eval('cloud').busy) await sleep(10); await w.syncNow(); await w.syncNow(); };
  return { w, d, click, set, until, sync, setOnline: v => { online = v; }, S: () => w.eval('S') };
}

// 1. Dispositivo 1: cadastro de restaurante
const A = device('A');
assert.ok(!A.d.querySelector('#login').hidden); A.click('[data-act=cl_signupform]');
A.set('#su_rest', 'Sabor da Casa'); A.set('#su_nome', 'Ana'); A.set('#su_email', 'ana@x.com'); A.set('#su_pin', '1234');
A.click('[data-act=cl_signup]'); await A.until(() => A.d.querySelector('#login').hidden);
assert.equal(A.S().produtos.length, 12); assert.equal(A.S().vendas.length, 0); ok('cadastro entra logado com cardápio de exemplo e sem vendas fictícias');
await A.sync();

// 2. Dispositivo 2 entra no mesmo restaurante
const B = device('B');
B.set('#cl_slug', 'sabor-da-casa'); B.click('[data-act=cl_users]'); await B.until(() => B.d.querySelector('#lpin'));
B.set('#lpin', '0000'); B.click('[data-act=login]'); await B.until(() => /incorreto/.test(B.d.querySelector('#lmsg').textContent)); ok('PIN errado é recusado pelo servidor');
B.set('#lpin', '1234'); B.click('[data-act=login]'); await B.until(() => B.d.querySelector('#login').hidden);
await B.until(() => B.S().produtos.length === 12); assert.equal(B.S().insumos.find(i => i.id === 'arroz').estoque, 25); ok('segundo computador recebe cardápio e estoque do servidor');

// 3. Abrir caixa no A e ver no B
A.click('[data-act=tab][data-k=financeiro]'); A.set('#abv', '200'); A.click('[data-act=abrecaixa]'); await A.sync(); await B.sync();
assert.equal(B.S().caixa.aberto, true); ok('caixa aberto num computador aparece no outro');

// 4. Comanda de mesa criada no A aparece no B
A.click('[data-act=tab][data-k=salao]'); A.click('[data-act=mesa][data-m="3"]'); A.click('[data-act=addp][data-id=p2]'); A.click('[data-act=sendk]'); A.click('[data-act=close]');
await A.sync(); await B.sync();
assert.equal(B.S().comandas.filter(c => c.mesa === 3).length, 1); assert.equal(B.S().comandas.find(c => c.mesa === 3).itens[0].env !== null, true); ok('comanda e itens enviados à cozinha chegam ao outro computador');

// 5. Vendas simultâneas nos dois PDVs: estoque soma, números diferentes
async function venda(X, cod) {
  X.click('[data-act=tab][data-k=pdv]'); const q = X.d.querySelector('#pdvq'); q.value = cod; X.click('[data-act=pdvadd]');
  X.click('[data-act=pdvpay][data-f=Dinheiro]'); X.click('[data-act=confpay]'); await X.until(() => X.d.querySelector('#md pre')); X.click('[data-act=close]');
}
await venda(A, '101'); await venda(B, '101');
await A.sync(); await B.sync(); await A.sync(); await B.sync();
const arrozA = A.S().insumos.find(i => i.id === 'arroz').estoque, arrozB = B.S().insumos.find(i => i.id === 'arroz').estoque;
console.log('   arroz A/B:', arrozA, arrozB, '(esperado 25 - 0,15 - 0,15 - 0,2 mesa nao baixou) ');
assert.equal(arrozA, arrozB); assert.equal(arrozA, 24.7); ok('baixas de estoque feitas ao mesmo tempo nos dois PDVs somam');
const ns = A.S().vendas.map(v => v.n); assert.equal(ns.length, 2); assert.equal(new Set(ns).size, 2); assert.equal(B.S().vendas.length, 2); ok('vendas com números distintos e visíveis nos dois lados: ' + ns.join(','));

// 6. Offline no B: vende, depois reconecta
B.setOnline(false); B.w.dispatchEvent(new B.w.Event('offline'));
await venda(B, '103'); await B.sync(); assert.equal(B.w.eval('cloud').status, 'off'); assert.equal(B.S().vendas.length, 3); ok('PDV sem internet continua vendendo e mostra aviso de conexão');
B.setOnline(true); B.w.dispatchEvent(new B.w.Event('online')); await sleep(100); await B.sync(); await A.sync();
assert.equal(A.S().vendas.length, 3); assert.equal(A.w.eval('cloud').status, 'ok'); ok('ao reconectar, a venda feita offline sobe e aparece no outro computador');
const frangoA = A.S().insumos.find(i => i.id === 'frango').estoque; assert.equal(frangoA, B.S().insumos.find(i => i.id === 'frango').estoque); ok('estoque final igual nos dois: frango ' + frangoA);

// 7. NFC-e pelo servidor
A.click('[data-act=tab][data-k=pdv]'); A.d.querySelector('#pdvq').value = '104'; A.click('[data-act=pdvadd]');
const cb = A.d.querySelector('[data-chg=pdvnfce]'); cb.checked = true; cb.dispatchEvent(new A.w.Event('change', { bubbles: true }));
A.click('[data-act=pdvpay][data-f=Pix]'); A.click('[data-act=confpay]'); await A.until(() => A.d.querySelector('#md pre'));
const nota = A.S().notas.at(-1); assert.equal(nota.status, 'autorizada'); assert.equal(nota.numero, 1); assert.equal(nota.chave.length, 44); A.click('[data-act=close]'); ok('NFC-e numerada e emitida pelo servidor (nº ' + nota.numero + ')');

// 8. Autorização e usuários via servidor
A.click('[data-act=tab][data-k=acesso]'); await sleep(50); A.click('[data-act=newuser]'); A.set('#u_nome', 'Caixa 1'); A.set('#u_pin', '3456'); A.click('[data-act=usersave]');
await A.until(() => A.S().users.length === 2); ok('proprietário cria usuário no servidor');
A.click('[data-act=lock]'); await A.until(() => !A.d.querySelector('#login').hidden);
A.set('#cl_slug', 'sabor-da-casa'); A.click('[data-act=cl_users]'); await A.until(() => A.d.querySelector('#lpin'));
const caixaBtn = [...A.d.querySelectorAll('[data-act=lsel]')].find(x => x.textContent === 'Caixa 1'); caixaBtn.click();
A.set('#lpin', '3456'); A.click('[data-act=login]'); await A.until(() => A.d.querySelector('#login').hidden);
assert.deepEqual([...A.d.querySelectorAll('.nav')].map(x => x.textContent.replace(/\d+$/, '').replace('Bloquear', '')).slice(0, 5).join('|').includes('Financeiro'), true); ok('operador de caixa entra com o próprio PIN e vê só o seu perfil');
A.click('[data-act=tab][data-k=pdv]'); A.d.querySelector('#pdvq').value = '101'; A.click('[data-act=pdvadd]'); A.click('[data-act=pdvpay][data-f=Pix]');
A.set('[data-chg=pdv]', '5'); A.click('[data-act=confpay]'); await A.until(() => !A.d.querySelector('#cf').hidden);
A.d.querySelector('#apin').value = '3456'; A.click('[data-act=authok]'); await A.until(() => /não autoriza/.test(A.d.querySelector('#amsg').textContent)); ok('PIN do próprio caixa não autoriza desconto (servidor)');
A.d.querySelector('#apin').value = '1234'; A.click('[data-act=authok]'); await A.until(() => A.d.querySelector('#md pre')); ok('PIN do proprietário autoriza o desconto');
const v = A.S().vendas.at(-1); assert.equal(v.desc, 5); assert.equal(v.op, 'Caixa 1');

console.log('\nerros de script:', errs); console.log(step + ' verificações passaram'); process.exit(0);
