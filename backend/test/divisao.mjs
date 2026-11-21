import assert from 'node:assert/strict';
import fs from 'node:fs';
import jsdom from 'jsdom';
import { fileURLToPath } from 'node:url';
const html = fs.readFileSync(fileURLToPath(new URL('../../public/index.html', import.meta.url)), 'utf8').replace(/<link[^>]*>/g, '').replace('<script src="config.js"></script>', '');
const errs = []; let n = 0; const ok = m => console.log(`ok ${++n} - ${m}`);
const dom = new jsdom.JSDOM(html, { runScripts: 'dangerously', url: 'https://app.test/', pretendToBeVisual: true, beforeParse(w) { w.scrollTo = () => {}; w.TextEncoder = TextEncoder; w.addEventListener('error', e => errs.push(e.message)); } });
const w = dom.window, d = w.document, ev = s => w.eval(s); await new Promise(r => setTimeout(r, 100));
ev(`ui.user=S.users.find(u=>u.perfil==='dono');ui.tab='salao';S.caixa.aberto=true;S.cfg.servicoPct=10;
 S.produtos.push({id:'tA',nome:'Item A',cat:'Teste',preco:10,tipo:'un',ficha:[],pf:''},{id:'tB',nome:'Item B',cat:'Teste',preco:7.33,tipo:'un',ficha:[],pf:''},{id:'tC',nome:'Item C',cat:'Teste',preco:0.01,tipo:'un',ficha:[],pf:''});`);
const abre = (mesa, itens) => { ev(`hideModal();A.mesa({m:'${mesa}'});const c=curCmd();${itens.map(([id, q]) => `c.itens.push({pid:'${id}',qtd:${q},obs:'',env:null,pronto:false})`).join(';')};drawCmd()`); };
const pagaGrupo = async g => { ev(`A.sprec({g:'${g}'});A.payfull({f:'Dinheiro'})`); await ev('confirmPay()'); };

// 1) por pessoas: 3 pessoas, 3 × R$ 10,00 + 1 × R$ 7,33 + 1 × R$ 0,01
abre(1, [['tA', 3], ['tB', 1], ['tC', 1]]);
const total = ev('toC(subtotal(curCmd().itens))'); assert.equal(total, 3734);
ev('A.spopen()'); assert.ok(d.querySelector('#md').textContent.includes('Dividir conta')); assert.equal(ev('curCmd().split.grupos.length'), 2);
ev('A.spn({d:1})'); assert.equal(ev('curCmd().split.grupos.length'), 3);
const sh = JSON.parse(ev('JSON.stringify(Object.values(splitShares(curCmd())).map(l=>l.reduce((a,i)=>a+i.vl,0)))'));
assert.equal(sh.reduce((a, b) => a + b, 0), total); assert.ok(Math.max(...sh) - Math.min(...sh) <= 1); ok('divisão por pessoas soma exatamente o consumo e diverge no máximo 1 centavo entre as partes (' + sh.join('/') + ')');
// item de 3 unidades dividido entre 3: cada uma paga 10,00, sem favorecer sempre a mesma pessoa
const linhaA = JSON.parse(ev('JSON.stringify(splitShares(curCmd()))')); assert.ok(Object.values(linhaA).every(l => l.find(i => i.pid === 'tA').vl === 1000)); ok('item divisível sem resto é repartido sem diferença');

// 2) receber partes; estoque baixa uma única vez; comanda só fecha na última
const mov0 = ev('S.movEst.length'); const v0 = ev('S.vendas.length');
await pagaGrupo('g1'); assert.equal(ev('S.vendas.length'), v0 + 1); assert.equal(ev('S.comandas.some(c=>c.mesa===1)'), true);
ev(`ui.cmd=S.comandas.find(c=>c.mesa===1).id`); assert.equal(ev('curCmd().split.grupos[0].pago!=null'), true); ok('primeira parte recebida gera venda própria e mantém a comanda aberta');
assert.equal(ev('cmdRestante(curCmd())'), ev('fromC(' + (total - sh[0]) + ')')); ok('salão passa a exibir apenas o valor restante');
// bloqueios com parte paga
ev('addProd("tA")'); assert.equal(ev('curCmd().itens.find(i=>i.pid==="tA").qtd'), 3); ev('A.qty({k:"0",d:1})'); assert.equal(ev('curCmd().itens[0].qtd'), 3); ev('A.cancmd()'); assert.equal(ev('!!curCmd()'), true); ok('consumo e cancelamento bloqueados após receber parte');
ev('A.spopen();A.sprec({g:"g1"})'); ev('drawSplit()'); const vv = ev('S.vendas.length'); ev('ui.pay=null'); // reabrir g1 já paga
ev(`openPay({kind:'sp',id:curCmd().id,g:'g1'});A.payfull({f:'Dinheiro'})`); await ev('confirmPay()'); assert.equal(ev('S.vendas.length'), vv); ok('parte já recebida não pode ser cobrada duas vezes');
ev('ui.pay=null;ui.cmd=S.comandas.find(c=>c.mesa===1).id'); await pagaGrupo('g2'); ev(`ui.cmd=S.comandas.find(c=>c.mesa===1).id`); await pagaGrupo('g3');
assert.equal(ev('S.comandas.some(c=>c.mesa===1)'), false); ok('comanda é encerrada ao receber a última parte');
const vs = JSON.parse(ev(`JSON.stringify(S.vendas.slice(${v0}).map(v=>({sub:toC(v.sub),g:v.grupo,serv:toC(v.serv),it:v.itens.length})))`));
assert.equal(vs.length, 3); assert.equal(vs.reduce((a, x) => a + x.sub, 0), total); ok('soma dos subtotais das vendas é igual ao consumo original');
assert.ok(vs.every(x => x.serv > 0 || x.sub < 10)); ok('taxa de serviço calculada em cada recebimento');
const movDiv = ev('S.movEst.length') - mov0;
ev(`hideModal();S.comandas=[];A.mesa({m:'2'});const c=curCmd();c.itens.push({pid:'tA',qtd:3,obs:'',env:null,pronto:false},{pid:'tB',qtd:1,obs:'',env:null,pronto:false},{pid:'tC',qtd:1,obs:'',env:null,pronto:false});drawCmd();A.fechar();A.payfull({f:'Dinheiro'})`); const m1 = ev('S.movEst.length'); await ev('confirmPay()');
assert.equal(movDiv, ev('S.movEst.length') - m1); ok('baixa de estoque na divisão é idêntica à de uma venda única');
// NFC-e coerente com valor fracionado
ev(`(()=>{const v=S.vendas[${v0}];const nota={vendaId:v.id};const it=payloadNota(nota).itens;window.__s=toC(it.reduce((a,i)=>a+i.valor_total,0));window.__t=toC(v.sub);window.__n=it.length;window.__u=it.every((i,k)=>Math.abs(i.valor_unitario*i.quantidade-i.valor_total)<0.005)})()`);
assert.equal(ev('__s'), ev('__t')); assert.equal(ev('__u'), true); ok('NFC-e da parte tem valor total dos itens igual ao subtotal da venda e quantidade × unitário confere (' + ev('__n') + ' itens)');

// 3) por agrupamento de itens
ev(`hideModal();S.comandas=[];ui.pay=null`);
abre(4, [['tA', 1], ['tB', 2], ['tC', 1]]);
ev('A.spopen();A.spmodo({m:"itens"});A.spn({d:1})'); assert.ok(d.querySelector('#md').textContent.includes('Itens')); 
assert.equal(d.querySelector('[data-act="sprec"]').disabled, true); ok('com itens sem conta, recebimento fica bloqueado');
ev('A.spt({k:"0",g:"g1"});A.spt({k:"1",g:"g2"});A.spall({k:"2"})');
assert.equal(ev('toC(subtotal(splitShares(curCmd()).g1))'), 1000); assert.equal(ev('toC(subtotal(splitShares(curCmd()).g2))'), 1466); assert.equal(ev('toC(subtotal(splitShares(curCmd()).g3))'), 1); ok('itens agrupados por conta; item marcado em todas é dividido (centavo indivisível vai para a conta com menor valor)');
const soma3 = ev('Object.values(splitShares(curCmd())).reduce((a,l)=>a+toC(subtotal(l)),0)'); assert.equal(soma3, 1000 + 1466 + 1); ok('soma das contas igual ao consumo');
ev('addProd("tA")'); assert.equal(ev('curCmd().split'), null); ok('alterar o consumo sem partes recebidas descarta a divisão');
ev('A.spopen()'); assert.equal(ev('curCmd().split.modo'), 'pessoas'); ev('A.spdesf()'); assert.equal(ev('curCmd().split'), null); ok('desfazer divisão restaura a comanda inteira');
// 4) pdv não divide
ev(`hideModal();ui.pdv=null;`); 
assert.equal(errs.length, 0, errs.join('|')); ok('sem erros de script');
console.log(`\n${n} verificações passaram`); process.exit(0);
