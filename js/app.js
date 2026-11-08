/* VAT2 · plataforma de estudo espaçado
   Sem servidor: plano em data/plano.json, questões em data/questoes/<materia>.json,
   progresso no navegador (localStorage) e, se configurado, num Gist privado do GitHub. */
'use strict';

const LS_KEY = 'vat2-progresso';
const LS_SYNC = 'vat2-sync';
const GIST_FILE = 'vat2-progresso.json';
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

let PLANO = null;
const MAT = {};      // id -> matéria
const ASS = {};      // id -> assunto
const BANCOS = {};   // matéria -> array de questões | null (sem banco)
let S = null;        // progresso
let PARTEQ = {};     // código da questão -> parte do assunto (1, 2, ...), classificado no NotebookLM

/* ---------- datas (sempre no fuso local) ---------- */
function hojeISO() {
  const forc = new URLSearchParams(location.search).get('dia');
  if (forc && /^\d{4}-\d{2}-\d{2}$/.test(forc)) return forc;
  const d = new Date();
  return iso(d);
}
function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDias(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
function diff(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); } // b - a em dias
function fmt(s) { const d = parse(s); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); }
function fmtLongo(s) { const d = parse(s); return DIAS_SEMANA[d.getDay()] + ', ' + fmt(s); }

/* ---------- progresso ---------- */
const CHAVES = ['assuntos', 'tarefas', 'questoes', 'pulados', 'mapas'];
function novoEstado() { return { v: 1, assuntos: {}, tarefas: {}, questoes: {}, pulados: {}, mapas: {}, t: 0 }; }
function carregar() {
  try { S = JSON.parse(localStorage.getItem(LS_KEY)) || novoEstado(); } catch (e) { S = novoEstado(); }
  for (const k of CHAVES) S[k] = S[k] || {};
}
function salvar() {
  S.t = Date.now();
  localStorage.setItem(LS_KEY, JSON.stringify(S));
  Sync.agendar();
}
function merge(a, b) {
  const out = novoEstado();
  for (const k of CHAVES) {
    const A = (a && a[k]) || {}, B = (b && b[k]) || {};
    for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const x = A[id], y = B[id];
      out[k][id] = !x ? y : !y ? x : ((y.t || 0) > (x.t || 0) ? y : x);
    }
  }
  out.t = Math.max((a && a.t) || 0, (b && b.t) || 0);
  return out;
}

function estAss(id) { return S.assuntos[id] || { estudado: null, revisoes: [], proxima: null }; }
function provaDe(assId) { return MAT[ASS[assId].materia].prova; }

/* limite para revisões: até a véspera da prova */
function limitar(assId, data, hoje) {
  const lim = addDias(provaDe(assId), -1);
  if (data <= lim) return data;
  return lim > hoje ? lim : null;
}
function marcarEstudado(assId, hoje, valor = true) {
  const e = estAss(assId);
  const n = partesDe(assId).length;
  if (valor) {
    e.estudado = e.estudado || hoje;
    e.proxima = limitar(assId, addDias(hoje, 1), hoje);
    if (n) { e.partes = e.partes || {}; for (let i = 0; i < n; i++) e.partes[i] = e.partes[i] || hoje; }
  } else {
    e.estudado = null; e.proxima = null; e.revisoes = []; e.partes = {}; e.adiado = null;
  }
  e.t = Date.now();
  S.assuntos[assId] = e;
}
/* ---------- partes de um assunto ----------
   As partes vêm do mapa que o NotebookLM fez a partir do slide (plano.json) ou, se você
   colar a divisão do seu chat, da sua versão (S.mapas). Cada parte guarda o dia em que foi
   estudada. Quando todas estão feitas, o assunto conta como estudado. Se você parar no meio,
   as partes que faltam são remarcadas para outro dia, como um assunto atrasado. */
function partesDe(assId) {
  const m = S.mapas[assId];
  if (m && m.lista && m.lista.length) return m.lista.map(t => ({ t, top: [] }));
  return ASS[assId].partes || [];
}
function partesFeitas(assId) {
  const e = estAss(assId), n = partesDe(assId).length;
  return Array.from({ length: n }, (_, i) => i).filter(i => e.partes && e.partes[i]);
}
function faixa(nums) { // [3,4,5] -> "3–5"; [1,3] -> "1 e 3"
  const g = []; for (const n of nums) { const u = g[g.length - 1]; if (u && n === u[1] + 1) u[1] = n; else g.push([n, n]); }
  const t = g.flatMap(([a, b]) => a === b ? [String(a)] : b === a + 1 ? [String(a), String(b)] : [a + '–' + b]);
  return t.length > 1 ? t.slice(0, -1).join(', ') + ' e ' + t[t.length - 1] : t[0] || '';
}
function partesFaltando(assId) {
  const n = partesDe(assId).length, f = new Set(partesFeitas(assId));
  return Array.from({ length: n }, (_, i) => i).filter(i => !f.has(i));
}
function marcarParte(assId, i, hoje) {
  const e = estAss(assId); e.partes = e.partes || {};
  if (e.partes[i]) { delete e.partes[i]; e.estudado = null; e.proxima = null; }
  else e.partes[i] = hoje;
  e.t = Date.now(); S.assuntos[assId] = e;
  if (!partesFaltando(assId).length) { e.adiado = null; marcarEstudado(assId, hoje, true); return 'todas'; }
  return e.partes[i] ? 'marcou' : 'desmarcou';
}
function adiarResto(assId, hoje, valor) {
  const e = estAss(assId); e.adiado = valor ? hoje : null; e.t = Date.now(); S.assuntos[assId] = e;
}

const INTERVALOS = { facil: [3, 5, 8], medio: [2, 3, 5], dificil: [1, 1, 2] };
function registrarRevisao(assId, hoje, nota, acerto) {
  const e = estAss(assId);
  if (!e.estudado) e.estudado = hoje;
  e.revisoes = (e.revisoes || []).filter(r => r.d !== hoje);
  e.revisoes.push({ d: hoje, nota, acerto: acerto == null ? undefined : acerto });
  const n = Math.min(e.revisoes.length - 1, 2);
  e.proxima = limitar(assId, addDias(hoje, INTERVALOS[nota][n]), hoje);
  e.t = Date.now();
  S.assuntos[assId] = e;
}
function notaPorAcerto(p) { return p >= 0.8 ? 'facil' : p >= 0.6 ? 'medio' : 'dificil'; }
function devidos(materia, hoje) {
  return PLANO.assuntos.filter(a => a.materia === materia).filter(a => {
    const e = estAss(a.id); return e.estudado && ((e.proxima && e.proxima <= hoje) || assuntoFraco(a.id));
  });
}
function tarefaFeita(chave) { return !!(S.tarefas[chave] && S.tarefas[chave].ok); }
function marcarTarefa(chave, ok) { S.tarefas[chave] = { ok, t: Date.now() }; }
function pulado(dt) { return !!(S.pulados[dt] && S.pulados[dt].ok); }

/* ---------- remarcação automática ----------
   O plano original fica intacto. A cada abertura, o site monta o "plano efetivo":
   - assuntos de dias que já passaram (ou de hoje, se você marcou que não vai estudar)
     e que não foram marcados como estudados viram "atrasados";
   - os atrasados são encaixados do mais urgente (prova mais próxima) para o menos urgente,
     no primeiro dia livre a partir de hoje, respeitando a data da aula;
   - limite normal: 2 assuntos novos por dia (1 em dia de prova). Se não couber até
     2 dias antes da prova, aceita 3 por dia; em último caso usa a véspera;
   - nunca passa da véspera da prova. Se não houver mais dia, ele fica para hoje, marcado como urgente. */
function planoEfetivo(hoje) {
  const dias = {};
  for (const d of PLANO.dias) dias[d.data] = Object.assign({}, d, { estudar: [] });
  const atrasados = [];
  for (const d of PLANO.dias) for (const id of d.estudar || []) {
    const e = estAss(id);
    const parou = e.adiado === hoje && !e.estudado; // estudou parte hoje e deixou o resto para outro dia
    const vencido = d.data < hoje || (d.data === hoje && (pulado(hoje) || parou));
    if (vencido && !e.estudado) atrasados.push({ id, de: d.data, parou });
    else dias[d.data].estudar.push({ id });
  }
  const carga = dt => dias[dt].estudar.filter(x => { const e = estAss(x.id); return !e.estudado || e.estudado === dt; }).length;
  const limite = (dt, base) => pulado(dt) ? 0 : ((dias[dt].provas || []).length ? base - 1 : base);
  atrasados.sort((a, b) => provaDe(a.id).localeCompare(provaDe(b.id)) || a.de.localeCompare(b.de));
  const inicio = pulado(hoje) ? addDias(hoje, 1) : hoje;
  for (const x of atrasados) {
    const prova = provaDe(x.id);
    if (prova <= hoje) continue; // a prova já passou (ou é hoje): não adianta remarcar
    const a = ASS[x.id];
    const ini = x.parou ? addDias(hoje, 1) : inicio;
    const lib = a.aula && a.aula > ini ? a.aula : ini;
    let posto = null;
    for (const [ate, base] of [[addDias(prova, -2), 2], [addDias(prova, -2), 3], [addDias(prova, -1), 3]]) {
      for (let dt = lib; dt <= ate && !posto; dt = addDias(dt, 1)) {
        if (dias[dt] && carga(dt) < limite(dt, base)) posto = dt;
      }
      if (posto) break;
    }
    const urgente = !posto;
    if (!posto) posto = dias[lib] && lib < prova ? lib : null;
    if (posto) dias[posto].estudar.push({ id: x.id, de: x.de, urgente });
    if (x.parou && dias[hoje]) (dias[hoje].parciais = dias[hoje].parciais || []).push({ id: x.id, para: posto });
  }
  // dentro do dia, a prova mais próxima vem primeiro
  for (const d of Object.values(dias)) d.estudar.sort((a, b) => provaDe(a.id).localeCompare(provaDe(b.id)));
  return dias;
}

/* ---------- questões ---------- */
function local() { return location.hostname === 'localhost' || location.hostname === '127.0.0.1'; }
function urlSimulados() { return local() ? '/vat2-simulados/' : (PLANO.simulados || ''); }
function urlPublicaSimulado(m) { return (PLANO.simulados || '') + m.pasta + '/'; }
async function banco(materia) {
  if (materia in BANCOS) return BANCOS[materia];
  try {
    // as questões moram no repositório vat2-simulados (fonte única, compartilhada com a turma)
    const base = local() ? '/vat2-simulados/data/' : (PLANO.questoes || 'data/questoes/');
    const r = await fetch(base + materia + '.json', { cache: 'no-cache' });
    BANCOS[materia] = r.ok ? await r.json() : null;
  } catch (e) { BANCOS[materia] = null; }
  return BANCOS[materia];
}
function qStatus(q) {
  const e = S.questoes[q.code]; if (!e || !e.tent || !e.tent.length) return 'nova';
  return e.tent[e.tent.length - 1].ok ? 'certa' : 'errada';
}
function registrarResposta(q, ok, hoje) {
  const e = S.questoes[q.code] || { tent: [] };
  e.tent.push({ d: hoje, ok }); e.t = Date.now();
  S.questoes[q.code] = e;
}
function acertoAssunto(materia, assId) {
  const qs = (BANCOS[materia] || []).filter(q => q.assunto === assId);
  let feitas = 0, certas = 0;
  for (const q of qs) { const s = qStatus(q); if (s !== 'nova') { feitas++; if (s === 'certa') certas++; } }
  return { total: qs.length, feitas, certas };
}
/* ---------- integração com o simulado completo ----------
   O simulado (vat2-simulados) fica no mesmo endereço, então o localStorage é o mesmo. Ele grava
   simfc_<storage>_answers = { código: [{ ts, ok }] }. Aqui essas respostas entram no progresso
   (e vão para o Gist), e cada simulado com 3+ questões de um assunto já estudado conta como revisão. */
function chaveSim(m) { return 'simfc_vat2-' + m.pasta + '_'; }
function lerLS(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function importarSimulados(hoje) {
  let mudou = false; const lotes = {}; const feitasHoje = new Set();
  for (const m of PLANO.materias) {
    const qs = BANCOS[m.id]; if (!Array.isArray(qs)) continue;
    const assDe = Object.fromEntries(qs.map(q => [q.code, q.assunto]));
    const log = lerLS(chaveSim(m) + 'answers') || {};
    for (const [code, arr] of Object.entries(log)) {
      const e = S.questoes[code] || { tent: [] };
      const ja = new Set(e.tent.map(t => t.ts).filter(Boolean));
      let novo = false;
      for (const r of arr || []) {
        if (!r || !r.ts || ja.has(r.ts)) continue;
        const d = iso(new Date(r.ts));
        e.tent.push({ d, ok: !!r.ok, ts: r.ts, sim: 1 }); novo = true;
        if (d === hoje) feitasHoje.add(m.id);
        const a = assDe[code];
        if (a) { const k = r.ts + '|' + a; lotes[k] = lotes[k] || { a, d, c: 0, t: 0 }; lotes[k].t++; if (r.ok) lotes[k].c++; }
      }
      if (novo) { e.tent.sort((x, y) => (x.ts || parse(x.d).getTime()) - (y.ts || parse(y.d).getTime())); e.t = Date.now(); S.questoes[code] = e; mudou = true; }
    }
    // erros de antes deste registro existir: a fila de revisão do simulado guarda as que você errou
    const srs = lerLS(chaveSim(m) + 'srs');
    for (const [code, it] of Object.entries((srs && srs.items) || {})) {
      if (it && it.box === 0 && !it.slow && assDe[code] && !S.questoes[code]) { S.questoes[code] = { tent: [{ d: hoje, ok: false, sim: 1, antigo: 1 }], t: Date.now() }; mudou = true; }
    }
  }
  for (const x of Object.values(lotes)) {
    if (x.t >= 3 && ASS[x.a] && estAss(x.a).estudado) { registrarRevisao(x.a, x.d, notaPorAcerto(x.c / x.t), Math.round(100 * x.c / x.t)); mudou = true; }
  }
  // fez questões da matéria hoje no simulado completo: a revisão de hoje dessa matéria conta como feita
  for (const mt of feitasHoje) { const k = hoje + '|rev|' + mt; if (!tarefaFeita(k)) { marcarTarefa(k, true); mudou = true; } }
  if (mudou) salvar();
}

/* ---------- pontos fracos ----------
   Conta o último resultado de cada questão já respondida (na plataforma ou no simulado completo).
   Ponto fraco = parte do assunto (ou o assunto, se não houver partes) com acerto abaixo de 60%. */
function parteDaQuestao(q) {
  const m = S.mapas[q.assunto]; if (m && m.lista && m.lista.length) return null; // você usa outra divisão
  return PARTEQ[q.code] || null;
}
function desempenho(materia) {
  const out = {};
  for (const q of BANCOS[materia] || []) {
    const st = qStatus(q); if (st === 'nova') continue;
    const o = out[q.assunto] = out[q.assunto] || { c: 0, t: 0, partes: {}, erradas: [] };
    o.t++; if (st === 'certa') o.c++; else o.erradas.push(q);
    const p = parteDaQuestao(q);
    if (p) { const x = o.partes[p] = o.partes[p] || { c: 0, t: 0, erradas: [] }; x.t++; if (st === 'certa') x.c++; else x.erradas.push(q); }
  }
  return out;
}
function pontosFracos(materia) {
  const lista = [];
  for (const [assId, o] of Object.entries(desempenho(materia))) {
    if (!ASS[assId]) continue;
    const ps = Object.entries(o.partes).filter(([, x]) => x.t >= 2 && x.c / x.t < 0.6);
    if (ps.length) ps.forEach(([p, x]) => lista.push({ materia, assId, parte: +p, c: x.c, t: x.t, erradas: x.erradas }));
    else if (o.t >= 3 && o.c / o.t < 0.6) lista.push({ materia, assId, parte: null, c: o.c, t: o.t, erradas: o.erradas });
  }
  return lista.sort((a, b) => (b.t - b.c) - (a.t - a.c) || a.c / a.t - b.c / b.t);
}
function assuntoFraco(assId) {
  const o = desempenho(ASS[assId].materia)[assId];
  return !!o && o.t >= 3 && o.c / o.t < 0.6;
}
function nomeFraco(x) {
  const p = x.parte ? partesDe(x.assId)[x.parte - 1] : null;
  return h(ASS[x.assId].nome) + (p ? ` · <b>Parte ${x.parte}</b>: ${h(p.t)}` : '');
}
function promptFraco(assId, parte) {
  const a = ASS[assId], m = MAT[a.materia];
  const o = desempenho(a.materia)[assId] || { erradas: [], partes: {} };
  const erradas = parte ? ((o.partes[parte] || {}).erradas || []) : o.erradas;
  const p = parte ? partesDe(assId)[parte - 1] : null;
  const slide = a.fontes && a.fontes.length ? a.fontes.map(f => '"' + f + '"').join(' e ') : 'sobre ' + a.nome;
  return `Fontes: o slide do professor ${slide} define o conteúdo da prova de ${m.nome} (${fmt(m.prova)}); os livros de referência servem para aprofundar.

Estou errando questões ${p ? `da Parte ${parte} da aula (${p.t}${p.top && p.top.length ? ': ' + p.top.join('; ') : ''})` : `de ${a.nome}`}. Os temas das questões que errei foram:
${erradas.slice(0, 12).map(q => '- ' + q.subcategory).join('\n')}

1. 📘 Re-explique esses pontos com profundidade de livro-texto, do jeito mais claro possível, sem resumir.
2. ⚠️ Mostre onde costuma estar a confusão: as pegadinhas e os erros de raciocínio mais comuns nesses temas.
3. 🧠 Monte uma tabela ou esquema para memorizar o essencial.
4. ❓ Me teste com 3 perguntas novas no estilo da prova (ENAMED/residência). NÃO dê a resposta. Espere eu responder e corrija meu raciocínio.`;
}
function cartaoFraco(x, compacto) {
  const m = MAT[x.materia];
  return `<div class="fraco" style="--c:${m.cor}">
    <div><span class="pill">${m.emoji}</span>${nomeFraco(x)}</div>
    <div class="muted">acertou ${x.c} de ${x.t} (${Math.round(100 * x.c / x.t)}%)</div>
    ${compacto ? '' : `<div class="actions" style="margin-top:.35rem">
      <a class="btn" href="${linkSimulado(x.materia, { a: x.assId, p: x.parte || '', n: 10, modo: 'treino' })}">✍️ Treinar ${x.parte ? 'esta parte' : 'este assunto'}</a>
      <button class="btn" data-prompt-fraco="${x.assId}|${x.parte || ''}">📋 Prompt de revisão</button></div>`}
  </div>`;
}

function embaralhar(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- utilidades de interface ---------- */
const $ = s => document.querySelector(s);
function h(str) { return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2200); }
function linkSimulado(materia, opts = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) if (v != null && v !== '') p.set(k, Array.isArray(v) ? v.join(',') : v);
  const qs = p.toString();
  return '#/simulado/' + materia + (qs ? '?' + qs : '');
}
function linkSimuladoCompleto(materia, opts = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) if (v != null && v !== '') p.set(k, Array.isArray(v) ? v.map(encodeURIComponent).join(',') : v);
  const qs = p.toString();
  return '#/simulado-completo/' + materia + (qs ? '?' + qs : '');
}
function rota() {
  const raw = location.hash.replace(/^#\/?/, '') || 'hoje';
  const [caminho, qs] = raw.split('?');
  return { partes: caminho.split('/'), q: new URLSearchParams(qs || '') };
}
function marcarAba(nome) {
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === nome));
}

/* ---------- tela: Hoje ---------- */
function chipsContagem(hoje) {
  return '<div class="countdown">' + PLANO.materias.slice().sort((a, b) => a.prova.localeCompare(b.prova)).map(m => {
    const d = diff(hoje, m.prova);
    const txt = d > 1 ? 'em ' + d + ' dias' : d === 1 ? 'amanhã' : d === 0 ? 'HOJE' : 'feita';
    return `<div class="chip ${d < 0 ? 'past' : ''}" style="--c:${m.cor}"><b>${m.emoji} ${txt}</b>${h(m.curto)} · ${fmt(m.prova)}</div>`;
  }).join('') + '</div>';
}

function promptEstudo(assId) {
  const a = ASS[assId], m = MAT[a.materia], ps = partesDe(assId);
  const falta = partesFaltando(assId), prox = (falta[0] ?? 0) + 1;
  const slide = a.fontes && a.fontes.length ? a.fontes.map(f => '"' + f + '"').join(' e ') : 'sobre ' + a.nome;
  const mapa = ps.map((p, k) => `Parte ${k + 1}${p.e ? ' ⭐' : ''}: ${p.t}${p.top && p.top.length ? ' (' + p.top.join('; ') + ')' : ''}`).join('\n');
  return `Fontes: o slide do professor ${slide} define o conteúdo da prova; os livros de referência selecionados servem para aprofundar. Tenho prova de ${m.nome} em ${fmt(m.prova)}, no estilo ENAMED/residência.

1. O MAPA da aula já está definido. Use exatamente estas partes, nesta ordem, sem refazer a divisão:
${mapa}

2. Agora NÃO explique nada: só confirme que entendeu o mapa e espere. Eu vou pedir uma parte por vez ("Parte 1", "Parte 2"…). Cada parte deve vir sempre neste formato:

🎯 Ideia central: em uma ou duas frases, do que trata esta parte.

${a.formato === 'medio'
  ? `📘 Explicação completa: divida a parte em subtópicos com título (A, B, C…), um para cada tópico do slide, e explique cada um com profundidade de livro-texto (conceito, mecanismo/porquê, classificação, critérios e números importantes), em parágrafos curtos e tópicos, nunca em texto corrido longo. Quando o slide citar vários exemplos (síndromes, doenças, fármacos), explique cada um. Comece pelo que está no slide e aprofunde com o livro, avisando quando algo vem só do livro. Se houver cálculo, resolva passo a passo, explicando cada etapa. Seja um pouco mais enxuto que um capítulo de livro: vá direto ao ponto em cada subtópico, sem repetir, mas sem cortar conteúdo.

🩺 Na prática: um ou dois casos clínicos mostrando como isso aparece no consultório e na prova.

⚠️ Pegadinhas: os erros e confusões mais comuns de estudante sobre esta parte.`
  : `📘 Explicação completa: explique cada tópico da parte com profundidade de livro-texto (conceito, mecanismo/porquê, classificação, critérios e números importantes). Comece pelo que está no slide e aprofunde com o livro, avisando quando algo vem só do livro. Se houver cálculo, resolva passo a passo, explicando cada etapa. Não resuma e não limite o tamanho: prefiro uma explicação longa e completa.

🩺 Na prática: um ou dois casos clínicos mostrando como isso aparece no consultório e na prova.

⚠️ Pegadinhas: os erros e confusões mais comuns de estudante sobre esta parte.`}

🧠 Para memorizar: tabela, esquema ou mnemônico com o essencial da parte.

❓ Me teste: 2 perguntas (uma de conceito e uma aplicada, no estilo da prova). NÃO dê a resposta. Espere eu responder, corrija meu raciocínio explicando o que acertei e o que errei, e só então pergunte se sigo para a próxima parte.`;
}
function promptParte(assId, k) {
  const p = partesDe(assId)[k];
  return `Parte ${k + 1}${p.e ? ' ⭐' : ''}: ${p.t}${p.top && p.top.length ? '\nTópicos: ' + p.top.join('; ') : ''}\n\nExplique esta parte no formato combinado (🎯 Ideia central, 📘 Explicação completa em subtópicos A, B, C…, 🩺 Na prática, ⚠️ Pegadinhas, 🧠 Para memorizar, ❓ Me teste).`;
}

function blocoPartes(assId, hoje, parcial) {
  const a = ASS[assId], m = MAT[a.materia], e = estAss(assId), ps = partesDe(assId);
  const proprio = !!(S.mapas[assId] && S.mapas[assId].lista && S.mapas[assId].lista.length);
  const editor = `<details class="livro"><summary>✏️ ${ps.length ? 'Meu chat dividiu diferente' : 'Colar as partes do meu chat'}</summary>
      <p class="muted">Cole os títulos das partes que o NotebookLM te deu, uma por linha.${ps.length ? ' Para voltar ao mapa original, apague tudo e salve.' : ''}</p>
      <textarea class="f" data-mapa-txt="${assId}" placeholder="Parte 1: ...&#10;Parte 2: ...">${proprio ? h(S.mapas[assId].lista.join('\n')) : ''}</textarea>
      <div class="actions"><button class="btn" data-mapa-salvar="${assId}">Salvar partes</button></div></details>`;
  if (!ps.length) return `<div class="muted" style="margin-top:.4rem">${a.aula && a.aula > hoje ? 'As partes aparecem quando o slide da aula estiver no notebook.' : 'Este assunto ainda não tem divisão em partes.'}</div>${editor}`;
  const feitas = partesFeitas(assId);
  const linhas = ps.map((p, k) => {
    const d = e.partes && e.partes[k];
    return `<div class="parte ${d ? 'ok' : ''}">
      <button class="check ${d ? 'on' : ''}" style="--c:${m.cor}" data-parte="${assId}|${k}" aria-label="Marcar parte ${k + 1}">${d ? '✓' : ''}</button>
      <div class="grow"><b>Parte ${k + 1}${p.e ? ' ⭐' : ''}</b> · ${h(p.t)}${d && d !== hoje ? ` <span class="muted">(estudada ${fmt(d)})</span>` : ''}
      <button class="btn ghost" style="padding:.1rem .55rem;font-size:.78rem;margin-left:.3rem" data-prompt-parte="${assId}|${k}">📋 Prompt parte ${k + 1}</button>
      ${p.top && p.top.length ? `<details><summary class="muted">tópicos</summary><ul>${p.top.map(t => '<li>' + h(t) + '</li>').join('')}</ul></details>` : ''}</div></div>`;
  }).join('');
  const falta = partesFaltando(assId);
  const hojeFeitas = feitas.filter(k => e.partes[k] === hoje);
  let rodape = '';
  if (parcial) {
    rodape = `<div class="note">✅ Hoje você estudou ${hojeFeitas.length ? 'a' + (hojeFeitas.length > 1 ? 's partes ' : ' parte ') + faixa(hojeFeitas.map(k => k + 1)) : 'parte do assunto'}. ${falta.length > 1 ? 'As partes' : 'A parte'} ${faixa(falta.map(k => k + 1))} ${parcial.para ? (falta.length > 1 ? 'foram' : 'foi') + ' para ' + fmtLongo(parcial.para) : 'não couberam antes da prova'}.
      <button class="btn" data-adiar="${assId}|0" style="margin-left:.3rem">Desfazer</button></div>`;
  } else if (!e.estudado && falta.length && hojeFeitas.length) {
    rodape = `<div class="actions"><button class="btn" data-adiar="${assId}|1">⏭️ Parar por hoje: ${falta.length > 1 ? 'partes' : 'parte'} ${faixa(falta.map(k => k + 1))} para outro dia</button></div>`;
  }
  return `<div class="partes">${linhas}</div>${rodape}${parcial ? '' : editor}`;
}

function cartaoEstudo(assId, hoje, item = {}, parcial = null) {
  const a = ASS[assId], m = MAT[a.materia], e = estAss(assId);
  const bloqueado = a.aula && a.aula > hoje;
  const temBanco = Array.isArray(BANCOS[a.materia]) && BANCOS[a.materia].some(q => q.assunto === assId);
  const n = partesDe(assId).length, feitas = partesFeitas(assId).length;
  let origem = item.de ? (item.urgente ? 'URGENTE · era de ' + fmt(item.de) : 'remarcado de ' + fmt(item.de)) : '';
  const feito = e.estudado || parcial;
  return `<div class="card ${feito ? 'done' : ''}" style="--c:${m.cor}">
    <div class="row">
      <button class="check ${e.estudado ? 'on' : ''}" data-estudo="${assId}" aria-label="Marcar assunto inteiro como estudado">${e.estudado ? '✓' : ''}</button>
      <div class="grow">
        <div class="tag">${m.emoji} ${h(m.curto)}${origem ? ' · ' + origem : ''}${n ? ' · ' + feitas + '/' + n + ' partes' : ''}</div>
        <h3>${h(a.nome)}</h3>
        ${item.urgente ? `<div class="note">Não coube antes da prova (${fmtLongo(provaDe(assId))}). Faça uma passada rápida pelos pontos principais.</div>` : ''}
        ${bloqueado ? `<div class="note">A aula é em ${fmtLongo(a.aula)}. Estude depois dela.</div>` : ''}
        ${a.aviso ? `<div class="note">${h(a.aviso)}</div>` : ''}
        ${a.fontes && a.fontes.length && !parcial ? `<div class="muted">No notebook, marque: ${a.fontes.map(f => '<b>' + h(f) + '</b>').join(' + ')} + os livros que quiser.</div>` : ''}
        ${blocoPartes(assId, hoje, parcial)}
        ${parcial ? '' : `<div class="actions">
          <a class="btn" href="${m.notebook}" target="_blank" rel="noopener">📓 Abrir notebook</a>
          ${n && !e.estudado ? `<button class="btn" data-prompt="${assId}">📋 Prompt inicial (mapa e formato)</button>` : ''}
          ${temBanco ? `<a class="btn" href="${linkSimulado(a.materia, { a: assId, n: 10, modo: 'treino' })}">✍️ 10 questões</a>` : ''}
        </div>`}
      </div>
    </div>
  </div>`;
}

function cartaoRevisao(materia, hoje, chave) {
  const m = MAT[materia];
  const feita = tarefaFeita(chave);
  let alvo = devidos(materia, hoje);
  let texto;
  if (alvo.length) texto = 'Na hora de revisar: ' + alvo.map(a => h(a.nome)).join(', ');
  else {
    const estudados = PLANO.assuntos.filter(a => a.materia === materia && estAss(a.id).estudado);
    if (!estudados.length) texto = 'Você ainda não marcou nenhum assunto desta matéria como estudado.';
    else {
      alvo = estudados.sort((x, y) => (estAss(x.id).proxima || '9').localeCompare(estAss(y.id).proxima || '9')).slice(0, 2);
      texto = 'Nada vencido hoje. Reforce: ' + alvo.map(a => h(a.nome)).join(', ');
    }
  }
  const temBanco = Array.isArray(BANCOS[materia]) && BANCOS[materia].length;
  const fracos = temBanco ? pontosFracos(materia) : [];
  // revisão no simulado completo: todos os assuntos já estudados da matéria, questões sorteadas
  const vistos = temBanco ? PLANO.assuntos.filter(a => a.materia === materia && estAss(a.id).estudado) : [];
  const idsVistos = new Set(vistos.map(a => a.id));
  const qsVistas = temBanco ? BANCOS[materia].filter(q => idsVistos.has(q.assunto)) : [];
  const cats = [...new Set(qsVistas.map(q => q.category))];
  const tamanhos = [10, 20, 30].filter(n => n < qsVistas.length);
  if (qsVistas.length && tamanhos.length < 3) tamanhos.push(qsVistas.length);
  const linkRev = n => linkSimuladoCompleto(materia, { assuntos: cats, qtd: n, aleatorio: 1 });
  const blocoRev = qsVistas.length ? `<div class="rev-sim">
          <div class="muted">✍️ <b>Revisão no simulado</b> com os assuntos já estudados (${vistos.map(a => h(a.nome)).join(', ')}). Quantas questões?</div>
          <div class="actions">${tamanhos.map((n, i) => `<a class="btn ${i === 0 ? 'primary' : ''}" href="${linkRev(n)}">${n === qsVistas.length && n > 30 ? 'Todas (' + n + ')' : n}</a>`).join('')}</div>
        </div>` : '';
  return `<div class="card ${feita ? 'done' : ''}" style="--c:${m.cor}">
    <div class="row">
      <button class="check ${feita ? 'on' : ''}" data-tarefa="${chave}" aria-label="Marcar revisão como feita">${feita ? '✓' : ''}</button>
      <div class="grow">
        <div class="tag">${m.emoji} ${h(m.curto)} · revisão</div>
        <h3>Revisar ${h(m.curto)}</h3>
        <div class="muted">${texto}</div>
        ${blocoRev}
        ${fracos.length ? `<div class="muted" style="margin-top:.3rem">🎯 Você tem errado: ${fracos.slice(0, 3).map(x => nomeFraco(x) + ` (${x.c}/${x.t})`).join('; ')}</div>` : ''}
        <div class="actions">
          ${fracos.length ? `<a class="btn" href="${linkSimulado(materia, { a: fracos[0].assId, p: fracos[0].parte || '', n: 10, modo: 'treino' })}">🎯 Treinar o ponto mais fraco</a>` : ''}
          ${!temBanco ? `<span class="muted">Simulado desta matéria em preparação: revise pelo notebook.</span>` : ''}
          <a class="btn" href="${m.notebook}" target="_blank" rel="noopener">📓 Notebook</a>
        </div>
      </div>
    </div>
  </div>`;
}

function cartaoSimulado(materia, chave, vespera) {
  const m = MAT[materia], feita = tarefaFeita(chave);
  const temBanco = Array.isArray(BANCOS[materia]) && BANCOS[materia].length;
  const titulo = vespera ? 'Véspera de ' + m.curto : 'Simulado de ' + m.curto;
  const desc = vespera
    ? 'Leia os pontos-chave e refaça só as questões que você errou. Nada de conteúdo novo hoje.'
    : 'Simulado com questões de todos os assuntos. Depois, revise os erros.';
  return `<div class="card ${feita ? 'done' : ''}" style="--c:${m.cor}">
    <div class="row">
      <button class="check ${feita ? 'on' : ''}" data-tarefa="${chave}" aria-label="Marcar como feito">${feita ? '✓' : ''}</button>
      <div class="grow">
        <div class="tag">${m.emoji} ${h(m.curto)} · ${vespera ? 'véspera' : 'simulado'}</div>
        <h3>${titulo}</h3>
        <div class="muted">${desc}</div>
        <div class="actions">
          ${temBanco ? (vespera
            ? `<a class="btn primary" href="#/pontos/${materia}">🎯 Pontos-chave</a><a class="btn" href="${linkSimulado(materia, { modo: 'erros', tarefa: chave })}">↺ Refazer erros</a>`
            : `<a class="btn primary" href="${linkSimulado(materia, { n: 30, modo: 'completo', tarefa: chave })}">✍️ Simulado (30 questões)</a><a class="btn" href="${linkSimulado(materia, { modo: 'erros' })}">↺ Só os erros</a>`)
            : `<span class="muted">Simulado desta matéria em preparação.</span>`}
        </div>
      </div>
    </div>
  </div>`;
}

function painelLateral(hoje, ef) {
  // próximos dias
  let prox = '';
  for (let i = 1; i <= 5; i++) {
    const dt = addDias(hoje, i); const d = ef[dt]; if (!d) continue;
    const it = tarefasDoDia(d);
    prox += `<div class="mini"><b>${fmtLongo(dt)}</b>${it.length ? it.map(x => `<div class="${x.ok ? 'ok' : ''}"><span class="pill" style="--c:${MAT[x.m].cor}">${MAT[x.m].emoji}</span>${x.prova ? '<b>' + h(x.txt) + '</b>' : h(x.txt)}${x.de ? ' <span class="muted">(remarcado)</span>' : ''}</div>`).join('') : '<div class="muted">livre</div>'}</div>`;
  }
  // progresso por matéria
  let prog = '';
  for (const m of PLANO.materias) {
    const ass = PLANO.assuntos.filter(a => a.materia === m.id);
    const feitos = ass.filter(a => estAss(a.id).estudado).length;
    const pct = Math.round(100 * feitos / ass.length);
    prog += `<div class="prog-row"><span>${m.emoji} ${h(m.curto)}</span><span class="muted">${feitos}/${ass.length}</span></div><div class="bar"><i style="width:${pct}%;--c:${m.cor}"></i></div>`;
  }
  const total = PLANO.assuntos.length, feitos = PLANO.assuntos.filter(a => estAss(a.id).estudado).length;
  return `<aside class="side">
    <div class="card"><h3>Próximos dias</h3>${prox}<a class="btn ghost" href="#/calendario" style="margin-top:.5rem">Ver calendário completo →</a></div>
    <div class="card"><h3>Seu progresso · ${feitos}/${total} assuntos</h3>${prog}</div>
  </aside>`;
}

async function telaHoje() {
  marcarAba('hoje');
  const hoje = hojeISO();
  await Promise.all(PLANO.materias.map(m => banco(m.id)));
  const ef = planoEfetivo(hoje);
  const dia = ef[hoje] || { estudar: [] };
  let main = '';

  for (const p of dia.provas || []) {
    const m = MAT[p];
    main += `<div class="banner" style="--c:${m.cor}"><h2>${m.emoji} Hoje é prova de ${h(m.curto)}</h2><div>Boa prova! Respira, lê o enunciado com calma.</div></div>`;
  }
  if (pulado(hoje)) {
    main += `<div class="note">😴 Você marcou que hoje não vai estudar. Os assuntos de hoje foram remarcados para os próximos dias. <button class="btn" data-pular="0" style="margin-left:.3rem">Desfazer</button></div>`;
  }
  if (dia.nota) main += `<div class="note">💡 ${h(dia.nota)}</div>`;
  const remarcados = (dia.estudar || []).filter(x => x.de).length;
  if (remarcados) main += `<div class="note">🔁 ${remarcados === 1 ? '1 assunto foi remarcado' : remarcados + ' assuntos foram remarcados'} para hoje porque ficaram para trás. Tudo bem, o plano já se ajustou.</div>`;

  let cards = '';
  if (!pulado(hoje)) for (const x of dia.estudar || []) cards += cartaoEstudo(x.id, hoje, x);
  for (const x of dia.parciais || []) cards += cartaoEstudo(x.id, hoje, {}, x);
  for (const mt of dia.revisar || []) cards += cartaoRevisao(mt, hoje, hoje + '|rev|' + mt);
  for (const mt of dia.simulado || []) cards += cartaoSimulado(mt, hoje + '|sim|' + mt, false);
  for (const mt of dia.vespera || []) cards += cartaoSimulado(mt, hoje + '|vesp|' + mt, true);
  main += `<section class="blk"><h2>Para hoje</h2>${cards || '<div class="empty">Nada planejado para hoje. Descanse 😊</div>'}</section>`;

  // pontos fracos (das matérias cuja prova ainda não passou)
  const fracos = PLANO.materias.filter(m => m.prova > hoje).sort((a, b) => a.prova.localeCompare(b.prova)).flatMap(m => pontosFracos(m.id));
  if (fracos.length) {
    main += `<section class="blk"><h2>🎯 Seus pontos fracos</h2><p class="muted">Vem das questões que você respondeu aqui e no simulado completo. Some quando você passa a acertar.</p>
      <div class="card">${fracos.slice(0, 4).map(x => cartaoFraco(x)).join('')}${fracos.length > 4 ? `<a class="btn ghost" href="#/materias">Ver todos (${fracos.length}) em Matérias →</a>` : ''}</div></section>`;
  }

  // revisões vencidas de matérias que não estão no plano de hoje
  const planejadas = new Set(dia.revisar || []);
  const extras = PLANO.materias.filter(m => m.prova > hoje && !planejadas.has(m.id) && devidos(m.id, hoje).length);
  if (extras.length) {
    main += `<section class="blk"><h2>Revisões vencidas</h2><p class="muted">Opcional: só se sobrar tempo.</p>`;
    main += extras.map(m => cartaoRevisao(m.id, hoje, hoje + '|rev|' + m.id)).join('');
    main += '</section>';
  }
  if (!pulado(hoje) && (dia.estudar || []).some(x => !estAss(x.id).estudado)) {
    main += `<div class="actions" style="margin-top:.4rem"><button class="btn ghost" data-pular="1">😴 Hoje não vou conseguir estudar</button></div>
      <p class="muted">Os assuntos de hoje vão para os próximos dias, sem passar da véspera de cada prova.</p>`;
  }

  $('#app').innerHTML = `<section class="blk"><h2>${fmtLongo(hoje)}</h2>${chipsContagem(hoje)}</section>
    <div class="cols"><div class="main-col">${main}</div>${painelLateral(hoje, ef)}</div>`;
}

/* ---------- tela: Calendário ---------- */
function tarefasDoDia(d) {
  const it = [];
  for (const p of d.provas || []) it.push({ txt: 'PROVA de ' + MAT[p].curto, m: p, ok: false, prova: true });
  for (const x of d.estudar || []) {
    const id = typeof x === 'string' ? x : x.id;
    const e = estAss(id), n = partesDe(id).length, ant = partesFeitas(id).filter(k => e.partes[k] < d.data);
    const resto = !e.estudado && n && ant.length ? ' (partes ' + faixa(partesFaltando(id).map(k => k + 1)) + ')' : '';
    it.push({ txt: ASS[id].nome + resto, m: ASS[id].materia, ok: !!e.estudado, de: x.de, urgente: x.urgente });
  }
  for (const x of d.parciais || []) {
    const e = estAss(x.id), hj = partesFeitas(x.id).filter(k => e.partes[k] === d.data);
    it.push({ txt: ASS[x.id].nome + (hj.length ? ' (partes ' + faixa(hj.map(k => k + 1)) + ')' : ' (parte)'), m: ASS[x.id].materia, ok: true });
  }
  for (const mt of d.revisar || []) it.push({ txt: 'Revisar ' + MAT[mt].curto, m: mt, ok: tarefaFeita(d.data + '|rev|' + mt) });
  for (const mt of d.simulado || []) it.push({ txt: 'Simulado de ' + MAT[mt].curto, m: mt, ok: tarefaFeita(d.data + '|sim|' + mt) });
  for (const mt of d.vespera || []) it.push({ txt: 'Véspera: pontos-chave e erros de ' + MAT[mt].curto, m: mt, ok: tarefaFeita(d.data + '|vesp|' + mt) });
  return it;
}
function telaCalendario() {
  marcarAba('calendario');
  const hoje = hojeISO();
  const ef = planoEfetivo(hoje);
  let html = `<section class="blk"><h2>Calendário da VAT2</h2><p class="muted">O calendário se ajusta sozinho quando algo fica para trás. <a href="#" id="baixar-ics">Baixar para o Calendário (Apple ou Google, .ics)</a></p><div class="cal">`;
  for (const d0 of PLANO.dias) {
    const d = ef[d0.data];
    const prova = (d.provas || []).length > 0;
    const it = tarefasDoDia(d);
    html += `<div class="day ${d.data === hoje ? 'today' : ''} ${prova ? 'exam' : ''} ${d.data < hoje ? 'past' : ''}" ${d.data === hoje ? 'id="hoje"' : ''}>
      <div class="date"><b>${parse(d.data).getDate()}</b><span>${DIAS_SEMANA[parse(d.data).getDay()]} · ${MESES[parse(d.data).getMonth()]}</span></div>
      <ul>${pulado(d.data) ? '<li class="muted">😴 dia de folga</li>' : ''}${it.map(i => `<li class="${i.ok ? 'ok' : ''}"><span class="pill" style="--c:${MAT[i.m].cor}">${MAT[i.m].emoji}</span>${i.prova ? '<b>' + h(i.txt) + '</b>' : h(i.txt)}${i.de ? ` <span class="muted">(${i.urgente ? 'urgente, ' : ''}era ${fmt(i.de)})</span>` : ''}</li>`).join('')}
      ${d.nota ? `<li class="muted">${h(d.nota)}</li>` : ''}</ul></div>`;
  }
  html += '</div>';
  html += '</section>';
  $('#app').innerHTML = html;
  $('#baixar-ics').addEventListener('click', e => { e.preventDefault(); baixarICS(); });
  const el = $('#hoje'); if (el) el.scrollIntoView({ block: 'center' });
}

/* ---------- tela: Matérias ---------- */
async function telaMaterias() {
  marcarAba('materias');
  const hoje = hojeISO();
  await Promise.all(PLANO.materias.map(m => banco(m.id)));
  let html = '<section class="blk"><h2>Matérias</h2><div class="mat-grid">';
  for (const m of PLANO.materias.slice().sort((a, b) => a.prova.localeCompare(b.prova))) {
    const d = diff(hoje, m.prova);
    const temBanco = Array.isArray(BANCOS[m.id]) && BANCOS[m.id].length;
    const fracosM = temBanco ? pontosFracos(m.id) : [];
    html += `<div class="card" style="--c:${m.cor}">
      <div class="tag">${m.emoji} prova ${fmtLongo(m.prova)} · ${d > 0 ? 'faltam ' + d + ' dias' : d === 0 ? 'HOJE' : 'feita'}</div>
      <h3>${h(m.nome)}</h3>
      <div class="actions" style="margin-bottom:.4rem">
        <a class="btn" href="${m.notebook}" target="_blank" rel="noopener">📓 Notebook</a>
        ${temBanco ? `<a class="btn" href="${linkSimulado(m.id, { n: 30, modo: 'completo' })}">✍️ Simulado</a><a class="btn" href="#/pontos/${m.id}">🎯 Pontos-chave</a>` : '<span class="muted">Simulado em preparação</span>'}
      </div>`;
    for (const a of PLANO.assuntos.filter(x => x.materia === m.id)) {
      const e = estAss(a.id);
      let st;
      if (a.aula && a.aula > hoje) st = '📅 aula ' + fmt(a.aula);
      else if (!e.estudado) st = partesFeitas(a.id).length ? partesFeitas(a.id).length + '/' + partesDe(a.id).length + ' partes' : 'não estudado';
      else st = 'estudado ' + fmt(e.estudado) + (e.revisoes && e.revisoes.length ? ' · ' + e.revisoes.length + ' rev.' : '') + (e.proxima ? ' · próx. ' + fmt(e.proxima) : '');
      const ac = temBanco ? acertoAssunto(m.id, a.id) : null;
      const pct = ac && ac.feitas ? Math.round(100 * ac.certas / ac.feitas) : null;
      html += `<div class="topic"><button class="check ${e.estudado ? 'on' : ''}" style="--c:${m.cor};width:24px;height:24px;flex-basis:24px;font-size:.8rem" data-estudo="${a.id}">${e.estudado ? '✓' : ''}</button>
        <div class="grow"><div>${h(a.nome)}</div><div class="st">${st}${pct != null ? ` · acerto ${pct}% (${ac.feitas}/${ac.total})` : ac && ac.total ? ` · ${ac.total} questões` : ''}</div>
        ${pct != null ? `<div class="bar"><i style="width:${pct}%;--c:${pct >= 80 ? 'var(--correct)' : pct >= 60 ? '#C8962E' : 'var(--incorrect)'}"></i></div>` : ''}
        ${fracosM.filter(x => x.assId === a.id).map(x => `<div class="st fraco-st">🎯 ${x.parte ? 'Parte ' + x.parte + ': ' + h(partesDe(a.id)[x.parte - 1].t) : 'assunto todo'} · ${x.c}/${x.t} · <a href="${linkSimulado(m.id, { a: a.id, p: x.parte || '', n: 10, modo: 'treino' })}">treinar</a> · <a href="#" data-prompt-fraco="${a.id}|${x.parte || ''}">prompt</a></div>`).join('')}</div></div>`;
    }
    html += '</div>';
  }
  html += '</div></section>';
  $('#app').innerHTML = html;
}

/* ---------- tela: Pontos-chave (véspera) ---------- */
async function telaPontos(materia) {
  marcarAba('materias');
  const m = MAT[materia]; const qs = await banco(materia);
  if (!m || !qs) { $('#app').innerHTML = '<div class="empty">Ainda não há questões para esta matéria.</div>'; return; }
  let html = `<section class="blk"><h2>${m.emoji} Pontos-chave · ${h(m.curto)}</h2><p class="muted">Um resumo tirado das questões. Os que você errou aparecem primeiro, marcados com ✗.</p>`;
  for (const a of PLANO.assuntos.filter(x => x.materia === materia)) {
    const doAss = qs.filter(q => q.assunto === a.id && q.clinicalPointers);
    if (!doAss.length) continue;
    doAss.sort((x, y) => (qStatus(y) === 'errada') - (qStatus(x) === 'errada'));
    const vistos = new Set();
    html += `<div class="card" style="--c:${m.cor}"><h3>${h(a.nome)}</h3><ul style="padding-left:1.1rem;margin:.4rem 0 0">`;
    for (const q of doAss) {
      if (vistos.has(q.clinicalPointers)) continue; vistos.add(q.clinicalPointers);
      html += `<li style="margin:.3rem 0">${qStatus(q) === 'errada' ? '<b style="color:var(--incorrect)">✗</b> ' : ''}${h(q.clinicalPointers)}</li>`;
    }
    html += '</ul></div>';
  }
  html += `<div class="actions"><a class="btn primary" href="${linkSimulado(materia, { modo: 'erros' })}">↺ Refazer os erros</a></div></section>`;
  $('#app').innerHTML = html;
}

/* ---------- tela: Simulado ---------- */
let SIM = null;
async function telaSimulado(materia, q) {
  marcarAba('materias');
  const m = MAT[materia];
  const todas = await banco(materia);
  if (!m || !todas) { $('#app').innerHTML = `<div class="empty">O simulado de ${m ? h(m.curto) : 'esta matéria'} ainda está em preparação.</div>`; return; }
  const assuntos = (q.get('a') || '').split(',').filter(Boolean);
  const modo = q.get('modo') || 'treino';
  const n = parseInt(q.get('n') || '0', 10);
  const parte = parseInt(q.get('p') || '0', 10);
  let pool = todas.filter(x => !assuntos.length || assuntos.includes(x.assunto));
  if (parte) pool = pool.filter(x => parteDaQuestao(x) === parte);
  const hoje = hojeISO();
  pool = pool.filter(x => { const a = ASS[x.assunto]; return !a || !a.aula || a.aula <= hoje; });
  if (modo === 'erros') pool = pool.filter(x => qStatus(x) === 'errada');
  if (modo === 'revisao' || modo === 'treino') {
    // prioridade: erradas > novas > certas
    const peso = x => ({ errada: 0, nova: 1, certa: 2 }[qStatus(x)]);
    pool = embaralhar(pool).sort((a, b) => peso(a) - peso(b));
  } else pool = embaralhar(pool);
  if (n > 0) pool = pool.slice(0, n);
  if (!pool.length) {
    $('#app').innerHTML = `<div class="empty">${modo === 'erros' ? 'Nenhuma questão errada aqui. 🎉' : 'Nenhuma questão disponível para este filtro.'}<div class="actions" style="justify-content:center"><a class="btn" href="#/hoje">Voltar</a></div></div>`;
    return;
  }
  SIM = { materia, modo, tarefa: q.get('tarefa'), qs: pool, i: 0, resp: [] };
  desenharQuestao();
}
function desenharQuestao() {
  const { qs, i, materia } = SIM; const q = qs[i]; const m = MAT[materia];
  const a = ASS[q.assunto];
  $('#app').innerHTML = `<section class="blk">
    <div class="progress"><i style="width:${(100 * i / qs.length).toFixed(1)}%"></i></div>
    <div class="q-meta"><span>${m.emoji} ${a ? h(a.nome) : h(q.category)}</span><span>${i + 1}/${qs.length}</span></div>
    <div class="card" style="--c:${m.cor}">
      <div class="q-prompt">${h(q.prompt)}</div>
      <div id="opts">${q.options.map(o => `<button class="opt" data-l="${o.letter}"><b>${o.letter})</b>${h(o.text)}</button>`).join('')}</div>
      <div id="pos"></div>
    </div>
    <div class="actions"><a class="btn ghost" href="#/hoje">Sair</a></div></section>`;
  window.scrollTo(0, 0);
  document.querySelectorAll('#opts .opt').forEach(b => b.addEventListener('click', () => responder(b.dataset.l)));
}
function responder(letra) {
  const q = SIM.qs[SIM.i]; if (SIM.resp[SIM.i]) return;
  const ok = letra === q.correctLetter;
  SIM.resp[SIM.i] = { letra, ok };
  registrarResposta(q, ok, hojeISO()); salvar();
  document.querySelectorAll('#opts .opt').forEach(b => {
    const o = q.options.find(x => x.letter === b.dataset.l);
    if (o.letter === q.correctLetter) b.classList.add('correct');
    else if (o.letter === letra) b.classList.add('wrong');
    b.insertAdjacentHTML('beforeend', `<span class="why">${h(o.rationale)}</span>`);
    b.disabled = true;
  });
  const ult = SIM.i === SIM.qs.length - 1;
  const ctx = q.bookContext && q.bookContext.text ? `<details class="livro"><summary>📖 Aprofundamento (livros de referência)</summary>
      <p>${h(q.bookContext.text)}</p>${q.bookContext.fonte ? `<small>Fonte indicada pelo NotebookLM: ${h(q.bookContext.fonte)}</small>` : ''}</details>` : '';
  $('#pos').innerHTML = `${q.clinicalPointers ? `<div class="pointer">🎯 ${h(q.clinicalPointers)}</div>` : ''}${ctx}
    <div class="actions"><button class="btn primary" id="prox">${ult ? 'Ver resultado' : 'Próxima →'}</button></div>`;
  $('#prox').addEventListener('click', () => { if (ult) resultado(); else { SIM.i++; desenharQuestao(); } });
  $('#prox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function resultado() {
  const hoje = hojeISO(); const m = MAT[SIM.materia];
  const porAss = {};
  SIM.qs.forEach((q, i) => {
    const r = SIM.resp[i]; if (!r) return;
    const k = q.assunto; porAss[k] = porAss[k] || { c: 0, t: 0 }; porAss[k].t++; if (r.ok) porAss[k].c++;
  });
  const tot = Object.values(porAss).reduce((s, x) => s + x.t, 0), cer = Object.values(porAss).reduce((s, x) => s + x.c, 0);
  // conta como revisão espaçada (a partir de 3 questões do assunto)
  for (const [k, x] of Object.entries(porAss)) {
    if (ASS[k] && x.t >= 3 && SIM.modo !== 'erros') registrarRevisao(k, hoje, notaPorAcerto(x.c / x.t), Math.round(100 * x.c / x.t));
  }
  if (SIM.tarefa) marcarTarefa(SIM.tarefa, true);
  salvar();
  const pct = tot ? Math.round(100 * cer / tot) : 0;
  $('#app').innerHTML = `<section class="blk"><div class="banner" style="--c:${m.cor}"><h2>${pct}% de acerto</h2><div>${cer} de ${tot} questões · ${h(m.curto)}</div></div>
    <div class="card">${Object.entries(porAss).map(([k, x]) => `<div class="result-row"><span>${ASS[k] ? h(ASS[k].nome) : h(k)}</span><b>${x.c}/${x.t}</b></div>`).join('')}
    <p class="muted" style="margin-bottom:0">${SIM.modo !== 'erros' ? 'O acerto de cada assunto ajusta a próxima revisão: ≥80% espaça mais, abaixo de 60% volta logo.' : ''}</p></div>
    <div class="actions">${tot - cer > 0 ? `<a class="btn primary" href="${linkSimulado(SIM.materia, { modo: 'erros', a: Object.keys(porAss) })}">↺ Refazer os erros</a>` : ''}<a class="btn" href="#/hoje">Voltar para Hoje</a></div></section>`;
}


/* ---------- tela: Simulados (o mesmo da turma, dentro da plataforma) ---------- */
async function telaSimulados() {
  marcarAba('simulados');
  await Promise.all(PLANO.materias.map(m => banco(m.id)));
  let html = `<section class="blk"><h2>Simulados</h2>
    <p class="muted">São os mesmos simulados do site da turma, com modos Exame e Tutor, código de sessão e revisão dos erros. O link que você manda para os colegas abre só o simulado, sem a sua plataforma.</p>
    <div class="actions" style="margin-bottom:1rem"><button class="btn" data-copiar="${h(PLANO.simulados || '')}">📤 Copiar link da página de simulados</button></div>
    <div class="mat-grid">`;
  for (const m of PLANO.materias.slice().sort((a, b) => a.prova.localeCompare(b.prova))) {
    const qs = BANCOS[m.id];
    const pronto = Array.isArray(qs) && qs.length;
    const nAss = pronto ? new Set(qs.map(q => q.assunto)).size : 0;
    html += `<div class="card" style="--c:${m.cor}">
      <div class="tag">${m.emoji} prova ${fmtLongo(m.prova)}</div>
      <h3>${h(m.nome)}</h3>
      <div class="muted">${pronto ? qs.length + ' questões · ' + nAss + ' assuntos' : 'Em preparação'}</div>
      ${pronto ? `<div class="actions">
        <a class="btn primary" href="#/simulado-completo/${m.id}">✍️ Abrir simulado</a>
        <button class="btn" data-copiar="${h(urlPublicaSimulado(m))}">📤 Copiar link para a turma</button>
      </div>` : ''}
    </div>`;
  }
  html += '</div></section>';
  $('#app').innerHTML = html;
}
function telaSimuladoCompleto(materia, q = new URLSearchParams()) {
  marcarAba('simulados');
  const m = MAT[materia];
  if (!m) { location.hash = '#/simulados'; return; }
  // assuntos/qtd/aleatorio vêm do cartão de revisão e pré-preenchem o simulado
  const p = new URLSearchParams();
  for (const k of ['assuntos', 'qtd', 'aleatorio']) if (q.get(k)) p.set(k, q.get(k));
  const src = urlSimulados() + m.pasta + '/' + (p.toString() ? '?' + p : '');
  $('#app').innerHTML = `<div class="sim-topo"><a class="btn ghost" href="#/simulados">← Simulados</a>
    <b>${m.emoji} ${h(m.curto)}</b>
    <span><button class="btn" data-copiar="${h(urlPublicaSimulado(m))}">📤 Link da turma</button>
    <a class="btn ghost" href="${src}" target="_blank" rel="noopener">⤢ Tela cheia</a></span></div>
    <iframe class="sim-frame" src="${src}" title="Simulado de ${h(m.nome)}"></iframe>`;
}

/* ---------- tela: Ajustes ---------- */
function telaAjustes() {
  marcarAba('ajustes');
  const cfg = Sync.cfg();
  $('#app').innerHTML = `<section class="blk"><h2>Sincronizar celular e computador</h2>
    <div class="card">
      <p class="muted" style="margin-top:0">O progresso fica salvo num <b>Gist privado</b> do seu GitHub. Configure uma vez em cada aparelho com o mesmo token.</p>
      <ol class="muted" style="padding-left:1.1rem">
        <li>No GitHub: <a href="https://github.com/settings/tokens/new?scopes=gist&description=vat2-estudos" target="_blank" rel="noopener">Settings → Tokens (classic) → Generate new token</a>.</li>
        <li>Marque <b>só</b> a permissão <b>gist</b>, escolha a validade e gere.</li>
        <li>Cole o token aqui. Ele fica salvo apenas neste aparelho.</li>
      </ol>
      <label class="f" for="tok">Token</label>
      <input class="f" id="tok" type="password" autocomplete="off" placeholder="ghp_..." value="${cfg.token ? '••••••••' : ''}">
      <div class="actions">
        <button class="btn primary" id="conectar">${cfg.token ? 'Salvar e sincronizar' : 'Conectar'}</button>
        ${cfg.token ? '<button class="btn" id="agora">Sincronizar agora</button><button class="btn ghost" id="sair">Desconectar</button>' : ''}
      </div>
      <p class="muted" id="sync-info">${cfg.token ? 'Conectado' + (cfg.gist ? ' · gist ' + h(cfg.gist.slice(0, 8)) + '…' : '') + (cfg.ultimo ? ' · última sincronização ' + new Date(cfg.ultimo).toLocaleString('pt-BR') : '') : 'Não conectado: o progresso fica só neste aparelho.'}</p>
    </div></section>
    <section class="blk"><h2>Backup manual</h2>
    <div class="card">
      <p class="muted" style="margin-top:0">Copie o código para guardar ou levar a outro aparelho. Para restaurar, cole e toque em Importar (o progresso é mesclado, nada se perde).</p>
      <textarea class="f" id="bk"></textarea>
      <div class="actions"><button class="btn" id="exp">Gerar código</button><button class="btn" id="imp">Importar</button></div>
    </div></section>
    <section class="blk"><h2>Agenda</h2><div class="card"><p class="muted" style="margin-top:0">Baixe o arquivo e abra no Google Agenda (ou Calendário do iPhone) para receber os estudos de cada dia e as provas.</p>
      <button class="btn" id="ics">Baixar .ics</button></div></section>
    <section class="blk"><h2>Zerar</h2><div class="card"><p class="muted" style="margin-top:0">Apaga o progresso deste aparelho (o Gist não é apagado).</p><button class="btn" id="zerar">Zerar progresso local</button></div></section>`;
  $('#conectar').addEventListener('click', async () => {
    const v = $('#tok').value.trim();
    if (v && !v.startsWith('•')) Sync.salvarCfg({ token: v, gist: null });
    if (!Sync.cfg().token) { toast('Cole o token primeiro'); return; }
    await Sync.agora(true); telaAjustes();
  });
  if ($('#agora')) $('#agora').addEventListener('click', async () => { await Sync.agora(true); telaAjustes(); });
  if ($('#sair')) $('#sair').addEventListener('click', () => { localStorage.removeItem(LS_SYNC); Sync.status(''); telaAjustes(); });
  $('#exp').addEventListener('click', () => { $('#bk').value = btoa(unescape(encodeURIComponent(JSON.stringify(S)))); $('#bk').select(); toast('Código gerado'); });
  $('#imp').addEventListener('click', () => {
    try { const o = JSON.parse(decodeURIComponent(escape(atob($('#bk').value.trim())))); S = merge(S, o); salvar(); toast('Progresso importado'); }
    catch (e) { toast('Código inválido'); }
  });
  $('#ics').addEventListener('click', baixarICS);
  $('#zerar').addEventListener('click', () => { if (confirm('Apagar o progresso deste aparelho?')) { S = novoEstado(); localStorage.setItem(LS_KEY, JSON.stringify(S)); toast('Progresso zerado'); } });
}

/* ---------- agenda .ics ---------- */
function baixarICS() {
  const esc = s => s.replace(/[,;\\]/g, m => '\\' + m);
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//vat2-estudos//PT-BR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:VAT2 estudos'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ef = planoEfetivo(hojeISO());
  for (const d0 of PLANO.dias) {
    const d = ef[d0.data];
    const it = tarefasDoDia(d).map(i => (i.prova ? '🔴 ' : MAT[i.m].emoji + ' ') + i.txt);
    const ini = d.data.replace(/-/g, ''), fim = addDias(d.data, 1).replace(/-/g, '');
    const prova = (d.provas || []).map(p => MAT[p].curto).join(' + ');
    if (!it.length || d.data < hojeISO()) continue; // dias passados ou sem nada não entram
    linhas.push('BEGIN:VEVENT', 'UID:vat2-' + ini + '@vat2-estudos', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + ini, 'DTEND;VALUE=DATE:' + fim,
      'SUMMARY:' + esc(prova ? 'PROVA ' + prova : 'Estudo VAT2: ' + it.filter(x => !x.startsWith('🔴')).slice(0, 2).join(' / ')),
      'DESCRIPTION:' + esc(it.join('\\n') + (d.nota ? '\\n' + d.nota : '')),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Estudo VAT2', 'TRIGGER:PT13H', 'END:VALARM', 'END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  const blob = new Blob([linhas.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vat2-estudos.ics'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- sincronização com Gist ---------- */
const Sync = {
  cfg() { try { return JSON.parse(localStorage.getItem(LS_SYNC)) || {}; } catch (e) { return {}; } },
  salvarCfg(c) { localStorage.setItem(LS_SYNC, JSON.stringify(Object.assign(this.cfg(), c))); },
  status(t) { const el = $('#sync'); if (el) el.textContent = t; },
  async api(caminho, opt = {}) {
    const r = await fetch('https://api.github.com' + caminho, Object.assign({}, opt, {
      headers: { Authorization: 'Bearer ' + this.cfg().token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
    }));
    if (!r.ok) throw new Error('GitHub ' + r.status);
    return r.json();
  },
  async acharGist() {
    for (let p = 1; p <= 5; p++) {
      const lista = await this.api('/gists?per_page=100&page=' + p);
      const g = lista.find(x => x.files && x.files[GIST_FILE]);
      if (g) return g.id;
      if (lista.length < 100) break;
    }
    return null;
  },
  async ler(id) {
    const g = await this.api('/gists/' + id);
    const f = g.files[GIST_FILE]; if (!f) return null;
    let txt = f.content;
    if (f.truncated) txt = await (await fetch(f.raw_url)).text();
    return JSON.parse(txt);
  },
  async agora(avisar) {
    const c = this.cfg(); if (!c.token) return;
    this.status('sincronizando…');
    try {
      let id = c.gist || await this.acharGist();
      if (id) { const remoto = await this.ler(id); S = merge(S, remoto); }
      localStorage.setItem(LS_KEY, JSON.stringify(S));
      const corpo = JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(S) } } });
      if (id) await this.api('/gists/' + id, { method: 'PATCH', body: corpo });
      else id = (await this.api('/gists', { method: 'POST', body: JSON.stringify({ description: 'Progresso da plataforma vat2-estudos', public: false, files: { [GIST_FILE]: { content: JSON.stringify(S) } } }) })).id;
      this.salvarCfg({ gist: id, ultimo: Date.now() });
      this.status('☁️ sincronizado');
      if (avisar) toast('Sincronizado');
    } catch (e) {
      this.status('⚠️ sem sincronizar');
      if (avisar) toast(String(e.message).includes('401') ? 'Token inválido ou expirado' : 'Não deu para sincronizar agora');
    }
  },
  agendar() {
    if (!this.cfg().token) return;
    clearTimeout(this._t); this.status('alterações locais…');
    this._t = setTimeout(() => this.agora(false), 4000);
  }
};

/* ---------- roteamento e eventos ---------- */
async function render() {
  await Promise.all(PLANO.materias.map(m => banco(m.id)));
  importarSimulados(hojeISO());
  const { partes, q } = rota();
  const [tela, arg] = partes;
  if (tela === 'calendario') telaCalendario();
  else if (tela === 'materias') await telaMaterias();
  else if (tela === 'ajustes') telaAjustes();
  else if (tela === 'simulados') await telaSimulados();
  else if (tela === 'simulado-completo' && arg) telaSimuladoCompleto(arg, q);
  else if (tela === 'simulado' && arg) await telaSimulado(arg, q);
  else if (tela === 'pontos' && arg) await telaPontos(arg);
  else await telaHoje();
}
document.addEventListener('click', e => {
  const est = e.target.closest('[data-estudo]');
  if (est) {
    const id = est.dataset.estudo, ja = !!estAss(id).estudado;
    marcarEstudado(id, hojeISO(), !ja); salvar();
    toast(ja ? 'Desmarcado' : 'Estudado! Primeira revisão amanhã.'); render(); return;
  }
  const par = e.target.closest('[data-parte]');
  if (par) {
    const [id, k] = par.dataset.parte.split('|'); const r = marcarParte(id, +k, hojeISO()); salvar();
    toast(r === 'todas' ? 'Assunto completo! Primeira revisão amanhã.' : r === 'marcou' ? 'Parte ' + (+k + 1) + ' estudada' : 'Desmarcada'); render(); return;
  }
  const adi = e.target.closest('[data-adiar]');
  if (adi) {
    const [id, v] = adi.dataset.adiar.split('|'); adiarResto(id, hojeISO(), v === '1'); salvar();
    toast(v === '1' ? 'Combinado! O resto foi remarcado.' : 'Desfeito'); render(); return;
  }
  const pro = e.target.closest('[data-prompt]');
  if (pro) {
    const txt = promptEstudo(pro.dataset.prompt);
    navigator.clipboard.writeText(txt).then(() => toast('Prompt copiado: cole no chat do notebook'), () => prompt('Copie o prompt:', txt));
    return;
  }
  const pf = e.target.closest('[data-prompt-fraco]');
  if (pf) {
    e.preventDefault();
    const [id, p] = pf.dataset.promptFraco.split('|'); const txt = promptFraco(id, p ? +p : null);
    navigator.clipboard.writeText(txt).then(() => toast('Prompt copiado: cole no chat do notebook'), () => prompt('Copie o prompt:', txt));
    return;
  }
  const ppt = e.target.closest('[data-prompt-parte]');
  if (ppt) {
    const [id, k] = ppt.dataset.promptParte.split('|'); const txt = promptParte(id, +k);
    navigator.clipboard.writeText(txt).then(() => toast('Prompt da parte ' + (+k + 1) + ' copiado'), () => prompt('Copie o prompt:', txt));
    return;
  }
  const map = e.target.closest('[data-mapa-salvar]');
  if (map) {
    const id = map.dataset.mapaSalvar, ta = document.querySelector(`[data-mapa-txt="${id}"]`);
    const lista = ta.value.split('\n').map(l => l.replace(/^\s*(parte\s*)?\d+\s*[-–—:.)]*\s*/i, '').trim()).filter(Boolean);
    S.mapas[id] = { lista, t: Date.now() }; salvar();
    toast(lista.length ? lista.length + ' partes salvas' : 'Voltou ao mapa original'); render(); return;
  }
  const cop = e.target.closest('[data-copiar]');
  if (cop) {
    const url = cop.dataset.copiar;
    if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) navigator.share({ title: 'Simulados VAT2', url }).catch(() => {});
    else navigator.clipboard.writeText(url).then(() => toast('Link copiado: é só colar no grupo'), () => prompt('Copie o link:', url));
    return;
  }
  const pul = e.target.closest('[data-pular]');
  if (pul) {
    const hoje = hojeISO();
    if (pul.dataset.pular === '1') {
      if (!confirm('Marcar hoje como dia sem estudo? Os assuntos de hoje serão remarcados para os próximos dias.')) return;
      S.pulados[hoje] = { ok: true, t: Date.now() }; toast('Tudo bem! O plano foi reorganizado.');
    } else { S.pulados[hoje] = { ok: false, t: Date.now() }; toast('Desfeito'); }
    salvar(); render(); return;
  }
  const tar = e.target.closest('[data-tarefa]');
  if (tar) { const k = tar.dataset.tarefa; marcarTarefa(k, !tarefaFeita(k)); salvar(); render(); }
});
window.addEventListener('hashchange', render);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.agora(false).then(render); });

(async function iniciar() {
  carregar();
  PLANO = await (await fetch('data/plano.json', { cache: 'no-cache' })).json();
  PLANO.materias.forEach(m => { MAT[m.id] = m; });
  PLANO.assuntos.forEach(a => { ASS[a.id] = a; });
  try { PARTEQ = await (await fetch('data/partes-questoes.json', { cache: 'no-cache' })).json(); } catch (e) { PARTEQ = {}; }
  $('#titulo-sub').textContent = PLANO.titulo;
  await render();
  if (Sync.cfg().token) { await Sync.agora(false); render(); }
})();
