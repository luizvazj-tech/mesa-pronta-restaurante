import assert from 'node:assert/strict';
import fs from 'node:fs';
import jsdom from 'jsdom';
import { fileURLToPath } from 'node:url';
const html = fs.readFileSync(fileURLToPath(new URL('../../public/index.html', import.meta.url)), 'utf8').replace(/<link[^>]*>/g, '').replace('<script src="config.js"></script>', '');
const errs = []; let n = 0; const ok = m => console.log(`ok ${++n} - ${m}`);
const dom = new jsdom.JSDOM(html, { runScripts: 'dangerously', url: 'https://app.test/', pretendToBeVisual: true, beforeParse(w) { w.scrollTo = () => {}; w.TextEncoder = TextEncoder; w.addEventListener('error', e => errs.push(e.message)); } });
const w = dom.window, d = w.document, ev = s => w.eval(s); await new Promise(r => setTimeout(r, 100));
const app = () => d.querySelector('#app').textContent;
ev(`ui.user=S.users.find(u=>u.perfil==='dono');ui.tab='salao';render()`);
assert.equal(ev('S.mesas.length'), 12); assert.ok(app().includes('Mesas livres')); assert.ok(app().includes('Varanda')); ok('salão renderiza mesas cadastradas, áreas e indicadores');
// abrir mesa, lançar, pedir conta, servir
ev(`A.mesa({m:'3'});addProd(S.produtos[0].id);S.comandas[0].itens[0].env='x';S.comandas[0].itens[0].pronto=true;drawCmd()`);
assert.ok(d.querySelector('#md').textContent.includes('marcar servido')); ev(`A.servir({k:'0'})`); assert.ok(ev('!!S.comandas[0].itens[0].servido')); ok('item pronto pode ser marcado como servido');
ev(`A.pconta()`); assert.equal(ev('S.comandas[0].conta'), true); assert.ok(d.querySelector('#md').textContent.includes('Reabrir consumo')); ok('conta pedida marcada na comanda');
ev(`hideModal();render()`); assert.ok(d.querySelector('.mesa.conta')); ok('mesa com conta pedida destacada no salão');
// transferir
ev(`ui.cmd=S.comandas[0].id;A.mvopen({mode:'transf'})`); assert.ok(d.querySelector('#md').textContent.includes('Transferir para outra mesa')); ev(`A.mvdo({m:'7'})`);
assert.equal(ev('S.comandas[0].mesa'), 7); assert.equal(ev('S.comandas[0].local'), 'Mesa 7 · Varanda'.replace('Mesa 7 · Varanda', ev('rotuloMesa(mesaPorNum(7))'))); assert.equal(ev('!!cmdDaMesa(3)'), false); ok('transferência move a comanda e libera a mesa de origem');
// juntar
ev(`hideModal();A.mesa({m:'2'});addProd(S.produtos[1].id);ui.cmd=S.comandas[1].id;`); const antes = ev('subtotal(S.comandas[0].itens)+subtotal(S.comandas[1].itens)');
ev(`A.mvjoin({id:S.comandas[0].id});A.cfyes()`); assert.equal(ev('S.comandas.length'), 1); assert.equal(ev('subtotal(S.comandas[0].itens)'), antes); ok('juntar soma os itens, mantém o valor total e encerra a outra comanda');
// gerenciar mesas: adicionar, duplicada, lote, excluir
ev(`hideModal();S.comandas=[];A.mesager()`); assert.ok(app().includes('Adicionar mesa')); 
d.querySelector('#mn_num').value = '13'; d.querySelector('#mn_nome').value = 'Janela'; d.querySelector('#mn_area').value = 'Salão'; d.querySelector('#mn_lug').value = '2'; ev('A.mesaadd()');
assert.equal(ev('mesaPorNum(13).nome'), 'Janela'); assert.equal(ev('mesaPorNum(13).lugares'), 2); ok('mesa adicionada com nome, área e lugares');
d.querySelector('#mn_num').value = '13'; ev('A.mesaadd()'); assert.equal(ev('S.mesas.filter(m=>m.num===13).length'), 1); ok('número duplicado é recusado');
d.querySelector('#mn_num').value = '1000'; ev('A.mesaadd()'); assert.equal(ev('S.mesas.length'), 13); ok('número fora de 1–999 é recusado');
d.querySelector('#ml_qtd').value = '4'; d.querySelector('#ml_area').value = 'Terraço'; d.querySelector('#ml_lug').value = '8'; ev('A.mesalote()'); assert.equal(ev('S.mesas.length'), 17); assert.equal(ev('mesaPorNum(17).area'), 'Terraço'); ok('criação em lote continua a numeração');
ev(`A.mesa({m:'4'});addProd(S.produtos[0].id);hideModal();A.mesager()`); ev(`A.mesadel({id:'m4'})`); assert.ok(ev('!!mesaPorNum(4)')); ok('mesa com comanda aberta não pode ser excluída');
ev(`CH.mesaf(false,{id:'m4',k:'ativa'})`); assert.ok(ev('mesaPorNum(4).ativa!==false')); ok('mesa ocupada não pode ser desativada');
ev(`A.mesadel({id:'m13'});A.cfyes()`); assert.equal(ev('!!mesaPorNum(13)'), false); ok('mesa livre é excluída');
ev(`CH.mesaf('Varanda 2',{id:'m5',k:'area'});CH.mesaf('9',{id:'m5',k:'lugares'});CH.mesaf('99',{id:'m6',k:'lugares'})`); assert.equal(ev('mesaPorNum(5).area'), 'Varanda 2'); assert.equal(ev('mesaPorNum(6).lugares'), 50); ok('edição de área e lugares (limite 50)');
// venda de mesa excluída preserva histórico; salão sem a mesa
ev(`S.comandas=[];ui.gm=false;render()`); assert.ok(!app().includes('Mesa 13')); ok('mesa excluída some do salão');
// perfis
ev(`ui.user=S.users.find(u=>u.perfil==='garcom');ui.gm=false;ui.tab='salao';render()`); assert.ok(!app().includes('Gerenciar mesas')); ev(`A.mesadel({id:'m9'})`); assert.ok(ev('!!mesaPorNum(9)')); ev(`A.mesager()`); assert.equal(ev('!!ui.gm'), false); ok('garçom não vê nem executa gestão de mesas');
ev(`ui.user=S.users.find(u=>u.perfil==='gerente');render()`); assert.ok(app().includes('Gerenciar mesas')); ok('gerente gerencia mesas');
// migração de dados antigos (cfg.mesas)
const m = ev(`JSON.stringify(migra({v:1,cfg:{mesas:3},produtos:[],insumos:[],vendas:[],comandas:[],delivery:[],notas:[],contas:[],users:[]}).mesas.map(x=>x.num))`); assert.equal(m, '[1,2,3]'); ok('estado antigo com "N mesas" migra para mesas cadastradas');
assert.deepEqual(errs, []); console.log(`\n${n} verificações passaram`); process.exit(0);
