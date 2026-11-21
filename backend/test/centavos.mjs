import assert from 'node:assert/strict';
import fs from 'node:fs';
import jsdom from 'jsdom';
import { fileURLToPath } from 'node:url';
const { JSDOM } = jsdom;
const html = fs.readFileSync(fileURLToPath(new URL('../../public/index.html', import.meta.url)), 'utf8').replace(/<link[^>]*>/g, '').replace('<script src="config.js"></script>', '');
const errs = []; let n = 0; const ok = m => console.log(`ok ${++n} - ${m}`);
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://app.test/', pretendToBeVisual: true, beforeParse(w) { w.scrollTo = () => {}; w.TextEncoder = TextEncoder; w.addEventListener('error', e => errs.push(e.message)); } });
const w = dom.window, ev = s => w.eval(s); await new Promise(r => setTimeout(r, 100));
ev(`ui.user=S.users.find(u=>u.perfil==='dono')`);
// critério único: metade para longe do zero, imune ao erro de ponto flutuante
const casos = [[1.005, 1.01], [2.675, 2.68], [1.015, 1.02], [0.285, 0.29], [1.004999, 1], [-1.005, -1.01], [0.1 + 0.2, 0.3], [1.255, 1.26], [8.345, 8.35]];
for (const [x, y] of casos) assert.equal(ev(`r2(${x})`), y, `r2(${x})`); ok('r2: metade para longe do zero, sem o erro clássico de 1,005 → 1,00');
assert.equal(ev(`toC(19.99)`), 1999); assert.equal(ev(`toC(0.29)`), 29); assert.equal(ev(`toC(4.35)`), 435); ok('conversão reais → centavos inteiros exata (19,99; 0,29; 4,35)');
// soma monetária exata
assert.equal(ev(`soma([1,2,3].map(()=>0.1),x=>x)`), 0.3); assert.equal(ev(`soma(Array(10).fill(0.1),x=>x)`), 1); ok('soma de 10 × 0,10 = 1,00 exatos');
// percentual arredondado uma só vez
assert.equal(ev(`fromC(pctC(toC(33.35),10))`), 3.34); assert.equal(ev(`fromC(pctC(toC(10.05),10))`), 1.01); ok('percentual sobre centavos arredondado uma única vez');
// venda: soma das linhas = subtotal = total; serviço e desconto exatos
ev(`S.produtos.push({id:'t1',nome:'T1',cat:'X',preco:3.33,tipo:'un',custoManual:0,ncm:'',cfop:'5101',csosn:'102',ficha:[]},{id:'t2',nome:'T2',cat:'X',preco:7.77,tipo:'kg',custoManual:0,ncm:'',cfop:'5101',csosn:'102',ficha:[]})`);
const itens = `[{pid:'t1',qtd:3},{pid:'t2',qtd:0.355}]`; // 9,99 + 2,75835 → linha 2,76
assert.equal(ev(`subtotal(${itens})`), 12.75); ok('subtotal arredonda cada linha uma vez (3×3,33 + 0,355 kg×7,77 = 12,75)');
const v = ev(`JSON.parse(JSON.stringify(mkVenda({tipo:'balcao',itens:${itens},servico:fromC(pctC(toC(12.75),10)),desc:0.5,taxa:0,pagamentos:[]})))`);
assert.equal(v.sub, 12.75); assert.equal(v.serv, 1.28); assert.equal(v.total, 13.53); ok('venda: serviço 10% = 1,28 (1,275 → 1,28) e total 13,53');
assert.equal(v.itens.reduce((a, i) => a + Math.round(i.qtd * i.preco * 100 + 1e-9), 0) >= 0, true);
// payCalc fecha em centavos
ev(`ui.pay={ref:{kind:'cmd',id:'x'},servico:true,dtipo:'%',dval:10,pags:[{forma:'Pix',valor:5.1},{forma:'Pix',valor:5.1},{forma:'Pix',valor:0.1}]};S.comandas.push({id:'x',mesa:1,itens:${itens},pessoas:1})`);
const k = ev(`JSON.parse(JSON.stringify(payCalc()))`); assert.equal(k.serv, 1.28); assert.equal(k.desc, 1.28); assert.equal(k.total, 12.75); assert.equal(k.pago, 10.3); assert.equal(k.falta, 2.45); ok('payCalc: serviço, desconto %, total, pago e falta em centavos exatos');
// caixa esperado e fluxo sem resíduos de ponto flutuante
ev(`S.caixa={aberto:true,abertura:200.1,em:new Date(Date.now()-1000).toISOString(),movs:[{tipo:'suprimento',valor:0.2},{tipo:'sangria',valor:0.1}]};S.vendas=[]`);
assert.equal(ev(`caixaEsperado()`), 200.2); ok('caixa esperado sem resíduo (200,10 + 0,20 − 0,10 = 200,20)');
// rateio: soma exata e retenção pelo critério único
ev(`S.vendas=[{id:'a',data:new Date().toISOString(),serv:0.07,itens:[],total:0.07,pagamentos:[]},{id:'b',data:new Date().toISOString(),serv:33.35,itens:[],total:33.35,pagamentos:[]}];S.gorjLanc=[];S.cfg.gorj.retPct=20;ui.gj=gjMesPadrao()`);
const r = ev(`JSON.parse(JSON.stringify(gjCalc(ui.gj.ini,ui.gj.fim,{})))`); assert.equal(r.total, 33.42); assert.equal(r.ret, 6.68); assert.equal(r.dist, 26.74);
assert.equal(r.eq.reduce((a, e) => a + Math.round(e.valor * 100), 0), 2674); ok('gorjeta: 20% de 33,42 = 6,68 e distribuição fecha em 26,74');
// ciclos em receitas
ev(`S.insumos=[{id:'A',nome:'Molho A',un:'kg',estoque:0,min:0,custo:0,receita:[{id:'B',qtd:1}],rend:1},{id:'B',nome:'Base B',un:'kg',estoque:0,min:0,custo:0,receita:[{id:'C',qtd:1}],rend:1},{id:'C',nome:'Caldo C',un:'kg',estoque:0,min:0,custo:2,receita:[],rend:1}]`);
assert.equal(ev(`custoIns(ins('A'))`), 2); assert.equal(ev(`detectaCiclos().length`), 0); ok('cadeia sem ciclo (A → B → C) calcula o custo');
ev(`ins('A').receita=[{id:'B',qtd:1},{id:'C',qtd:1}]`); assert.equal(ev(`detectaCiclos().length`), 0); assert.equal(ev(`custoIns(ins('A'))`), 4); ok('losango/diamante (A usa B e C; B usa C) não é falso ciclo');
assert.equal(ev(`JSON.stringify(cicloDe('C',[{id:'A',qtd:1}]))`), JSON.stringify(['Caldo C', 'Molho A', 'Base B', 'Caldo C'])); ok('ciclo indireto detectado: C → A → B → C');
assert.equal(ev(`JSON.stringify(cicloDe('A',[{id:'A',qtd:1}]))`), JSON.stringify(['Molho A', 'Molho A'])); ok('autorreferência detectada');
assert.equal(ev(`cicloDe('C',[])`), null); ok('sem linhas, sem ciclo');
// dados já circulares (importados/sincronizados) não travam o sistema
ev(`ins('C').receita=[{id:'A',qtd:1}];ins('C').rend=1`);
const c0 = ev(`custoIns(ins('A'))`); assert.equal(typeof c0, 'number'); assert.equal(ev(`detectaCiclos().length`), 1); ok('dado circular existente não estoura a pilha; ciclo é listado uma única vez');
ev(`ui.tab='painel';render()`); assert.ok(w.document.querySelector('#app').textContent.includes('Referência circular')); ok('painel alerta sobre referência circular');
// salvar preparo circular é bloqueado
ev(`ins('C').receita=[];ui.ed={kind:'ins',id:'C',d:{nome:'Caldo C',un:'kg',estoque:0,min:0,custo:2,prep:true,rend:1,receita:[{id:'A',qtd:1}]}};A.edsave()`);
assert.equal(ev(`ins('C').receita.length`), 0); ok('salvar preparo que fecha ciclo é recusado');
assert.deepEqual(errs, []); console.log(`\n${n} verificações passaram`); process.exit(0);
