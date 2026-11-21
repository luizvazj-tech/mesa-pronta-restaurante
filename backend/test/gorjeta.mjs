import assert from 'node:assert/strict';
import fs from 'node:fs';
import jsdom from 'jsdom';
import { fileURLToPath } from 'node:url';
const { JSDOM } = jsdom;
const html = fs.readFileSync(fileURLToPath(new URL('../../public/index.html', import.meta.url)), 'utf8').replace(/<link[^>]*>/g, '').replace('<script src="config.js"></script>', '');
const errs = []; let n = 0; const ok = m => console.log(`ok ${++n} - ${m}`);
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://app.test/', pretendToBeVisual: true, beforeParse(w) { w.scrollTo = () => {}; w.TextEncoder = TextEncoder; w.addEventListener('error', e => errs.push(e.message)); } });
const w = dom.window, d = w.document, ev = s => w.eval(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const set = (s, v) => { const e = d.querySelector(s); e.value = v; e.dispatchEvent(new w.Event('change', { bubbles: true })); };
await sleep(100);
// login como proprietário (PIN padrão 1234)
ev(`ui.user=S.users.find(u=>u.perfil==='dono');ui.tab='gorjeta';render()`);
assert.ok(d.querySelector('#app').textContent.includes('Regra coletiva')); ok('painel de gorjeta renderiza');
// vendas de teste com taxa de serviço conhecida
ev(`S.vendas=[];S.gorjLanc=[];const hoje=new Date().toISOString();S.vendas.push({id:'a',data:hoje,serv:100,itens:[],total:110,pagamentos:[]},{id:'b',data:hoje,serv:50.5,itens:[],total:55,pagamentos:[]});S.cfg.gorj.retPct=20;S.cfg.gorj.criterio='pontos';ui.gj=gjMesPadrao();`);
let r = ev(`JSON.parse(JSON.stringify(gjCalc(ui.gj.ini,ui.gj.fim,ui.gj.dias)))`);
assert.equal(r.serv, 150.5); assert.equal(r.ret, 30.1); assert.equal(r.dist, 120.4);
const soma = r.eq.reduce((a, e) => a + Math.round(e.valor * 100), 0); assert.equal(soma, 12040); ok('rateio soma exatamente o valor a distribuir (sem perda de centavos)');
const g1 = r.eq.find(e => e.nome.includes('exemplo 1')), g2 = r.eq.find(e => e.nome.includes('exemplo 2')); assert.equal(g1.valor, g2.valor); ok('mesma função e mesmos dias recebem o mesmo valor');
// ausências reduzem a parte
ev(`ui.gj.dias[S.gorjEquipe[0].id]=Math.floor(gjNd(ui.gj.ini,ui.gj.fim)/2)`);
const r2_ = ev(`JSON.parse(JSON.stringify(gjCalc(ui.gj.ini,ui.gj.fim,ui.gj.dias)))`); assert.ok(r2_.eq[0].valor < r2_.eq[1].valor); assert.equal(r2_.eq.reduce((a, e) => a + Math.round(e.valor * 100), 0), 12040); ok('dias trabalhados ponderam o rateio');
// critério partes iguais; função com 0 ponto fica fora
ev(`S.gorjEquipe.push({id:'ger',nome:'Gerente X',funcao:'f5',ativo:true});S.cfg.gorj.criterio='igual'`);
const r3 = ev(`JSON.parse(JSON.stringify(gjCalc(ui.gj.ini,ui.gj.fim,{})))`); assert.equal(r3.eq.find(e => e.id === 'ger').valor, 0); ok('função com 0 ponto (gerência) não participa');
// limite legal de retenção (Simples: 20%)
set('[data-k="retPct"]', '25'); assert.equal(ev('S.cfg.gorj.retPct'), 20); ok('retenção acima de 20% é recusada no Simples Nacional');
ev(`S.cfg.regime='Lucro Presumido'`); set('[data-k="retPct"]', '33'); assert.equal(ev('S.cfg.gorj.retPct'), 33); ev(`S.cfg.regime='Simples Nacional';S.cfg.gorj.retPct=20`); ok('33% permitido para os demais regimes');
// fechamento exige instrumento; depois fecha e impede sobreposição
ev(`ui.gj=gjMesPadrao();S.gorjEquipe=S.gorjEquipe.filter(m=>m.id!=='ger')`); w.eval(`A.gfechar()`); assert.equal(ev('S.gorjFech.length'), 0); ok('fechamento bloqueado sem instrumento coletivo');
ev(`S.cfg.gorj.instrumento='CCT Teste 2026'`); w.eval(`A.gfechar()`); d.querySelector('#cf [data-act="cfyes"]')?.click(); w.eval(`askConfirm.fn&&0`);
if (ev('S.gorjFech.length') === 0) { w.eval(`A.cfyes()`); }
assert.equal(ev('S.gorjFech.length'), 1); const f = ev('JSON.parse(JSON.stringify(S.gorjFech[0]))'); assert.equal(f.dist, 120.4); assert.equal(f.itens.reduce((a, i) => a + Math.round(i.valor * 100), 0), 12040); ok('período fechado com snapshot da regra');
w.eval(`A.gfechar()`); assert.equal(ev('S.gorjFech.length'), 1); ok('fechamento sobreposto é recusado');
// perfil gerente não altera regra
ev(`ui.user=S.users.find(u=>u.perfil==='gerente');`); set('[data-k="retPct"]', '10'); ok('gerente não altera a regra'); assert.equal(ev('S.cfg.gorj.retPct'), 20);
ev(`ui.user=S.users.find(u=>u.perfil==='dono');ui.tab='padroes';render()`);
// padrões fiscais
assert.ok(d.querySelector('#app').textContent.includes('Validação do contador')); ok('painel de padrões fiscais renderiza');
const pl = ev(`JSON.parse(JSON.stringify(payloadNota({vendaId:S.vendas[0].id})))`.replace('S.vendas[0].id', `(S.vendas.push({id:'vv',data:new Date().toISOString(),serv:0,desc:0,taxa:0,total:6.5,pagamentos:[],itens:[{pid:'p8',nome:'Refri',qtd:1,preco:6.5}]}),'vv')`));
const it = pl.itens[0]; assert.equal(it.cfop, '5405'); assert.equal(it.csosn, '500'); assert.equal(it.cst_pis, '04'); ok('NFC-e usa CFOP 5405 / CSOSN 500 / CST 04 do padrão da bebida com ST e monofásico');
// bloqueio em produção enquanto não validado
ev(`S.cfg.ambiente='producao'`); assert.ok(ev(`fiscPend([{pid:'p8'}])`).length === 1); assert.equal(ev(`fiscPend([{pid:'p8'}])`)[0].includes('Água'), true); ok('em produção, emissão bloqueada para padrão não validado');
ev(`S.cfg.ambiente='homologacao'`); assert.equal(ev(`fiscPend([{pid:'p8'}])`).length, 0); ok('em homologação não bloqueia');
// validação exige contador/CRC e padrão completo
ev(`S.cfg.fisc.validacao.contador='';`); w.eval('A.fvalidar()'); assert.equal(ev(`S.cfg.fisc.perfis.some(p=>p.status==='validado')`), false); ok('validação exige nome e CRC');
ev(`S.cfg.fisc.validacao.contador='Contador Teste';S.cfg.fisc.validacao.crc='PR-000000/O'`); w.eval('A.fvalidar()');
assert.equal(ev(`S.cfg.fisc.perfis.some(p=>p.status==='validado')`), false); ok('padrão incompleto (cerveja sem CST) impede a validação');
ev(`const c=S.cfg.fisc.perfis.find(p=>p.id==='pf_cerveja');c.cstPis='04';c.cstCofins='04'`); w.eval('A.fvalidar()'); w.eval('A.cfyes()');
assert.equal(ev(`S.cfg.fisc.perfis.every(p=>p.status==='validado')`), true); ok('validação registrada para todos os padrões completos');
ev(`S.cfg.ambiente='producao'`); assert.equal(ev(`fiscPend([{pid:'p8'}])`).length, 0); ok('padrão validado libera a emissão em produção');
set('[data-k="cfop"][data-i="1"]', '5102'); assert.equal(ev(`S.cfg.fisc.perfis[1].status`), 'sugerido'); ok('alterar padrão validado exige nova validação');
const ap = ev(`JSON.parse(JSON.stringify(fiscApur(dayKey(Date.now()).slice(0,7))))`); assert.ok(ap.total > 0); ok('apuração mensal por padrão');
assert.deepEqual(errs, []); console.log(`\n${n} verificações passaram`); process.exit(0);
