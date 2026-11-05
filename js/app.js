/* VAT2 · plataforma de estudo espaçado
   Sem servidor: plano em data/plano.json, questões em data/questoes/<materia>.json,
   progresso no navegador (localStorage) e, se configurado, num Gist privado do GitHub. */
'use strict';

const LS_KEY = 'vat2-progresso';
const LS_SYNC = 'vat2-sync';
const GIST_FILE = 'vat2-progresso.json';
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

let PLANO = null;
const MAT = {};      // id -> matéria
const ASS = {};      // id -> assunto
const BANCOS = {};   // matéria -> array de questões | null (sem banco)
let S = null;        // progresso

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
function novoEstado() { return { v: 1, assuntos: {}, tarefas: {}, questoes: {}, t: 0 }; }
function carregar() {
  try { S = JSON.parse(localStorage.getItem(LS_KEY)) || novoEstado(); } catch (e) { S = novoEstado(); }
  for (const k of ['assuntos', 'tarefas', 'questoes']) S[k] = S[k] || {};
}
function salvar() {
  S.t = Date.now();
  localStorage.setItem(LS_KEY, JSON.stringify(S));
  Sync.agendar();
}
function merge(a, b) {
  const out = novoEstado();
  for (const k of ['assuntos', 'tarefas', 'questoes']) {
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
  if (valor) {
    e.estudado = e.estudado || hoje;
    e.proxima = limitar(assId, addDias(hoje, 1), hoje);
  } else {
    e.estudado = null; e.proxima = null; e.revisoes = [];
  }
  e.t = Date.now();
  S.assuntos[assId] = e;
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
    const e = estAss(a.id); return e.estudado && e.proxima && e.proxima <= hoje;
  });
}
function tarefaFeita(chave) { return !!(S.tarefas[chave] && S.tarefas[chave].ok); }
function marcarTarefa(chave, ok) { S.tarefas[chave] = { ok, t: Date.now() }; }

/* ---------- questões ---------- */
async function banco(materia) {
  if (materia in BANCOS) return BANCOS[materia];
  try {
    const r = await fetch('data/questoes/' + materia + '.json', { cache: 'no-cache' });
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

function cartaoEstudo(assId, hoje, origem) {
  const a = ASS[assId], m = MAT[a.materia], e = estAss(assId);
  const bloqueado = a.aula && a.aula > hoje;
  const temBanco = Array.isArray(BANCOS[a.materia]) && BANCOS[a.materia].some(q => q.assunto === assId);
  return `<div class="card ${e.estudado ? 'done' : ''}" style="--c:${m.cor}">
    <div class="row">
      <button class="check ${e.estudado ? 'on' : ''}" data-estudo="${assId}" aria-label="Marcar como estudado">${e.estudado ? '✓' : ''}</button>
      <div class="grow">
        <div class="tag">${m.emoji} ${h(m.curto)}${origem ? ' · ' + origem : ''}</div>
        <h3>${h(a.nome)}</h3>
        ${bloqueado ? `<div class="note">A aula é em ${fmtLongo(a.aula)}. Estude depois dela.</div>` : ''}
        ${a.aviso ? `<div class="note">${h(a.aviso)}</div>` : ''}
        <div class="actions">
          <a class="btn" href="${m.notebook}" target="_blank" rel="noopener">📓 Abrir notebook</a>
          ${temBanco ? `<a class="btn" href="${linkSimulado(a.materia, { a: assId, n: 10, modo: 'treino' })}">✍️ 10 questões</a>` : ''}
        </div>
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
  return `<div class="card ${feita ? 'done' : ''}" style="--c:${m.cor}">
    <div class="row">
      <button class="check ${feita ? 'on' : ''}" data-tarefa="${chave}" aria-label="Marcar revisão como feita">${feita ? '✓' : ''}</button>
      <div class="grow">
        <div class="tag">${m.emoji} ${h(m.curto)} · revisão</div>
        <h3>Revisar ${h(m.curto)}</h3>
        <div class="muted">${texto}</div>
        <div class="actions">
          ${temBanco && alvo.length ? `<a class="btn primary" href="${linkSimulado(materia, { a: alvo.map(a => a.id), n: 15, modo: 'revisao', tarefa: chave })}">✍️ Revisar com 15 questões</a>` : ''}
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

async function telaHoje() {
  marcarAba('hoje');
  const hoje = hojeISO();
  await Promise.all(PLANO.materias.map(m => banco(m.id)));
  const dia = PLANO.dias.find(d => d.data === hoje) || {};
  let html = `<section class="blk"><h2>${fmtLongo(hoje)}</h2>${chipsContagem(hoje)}</section>`;

  for (const p of dia.provas || []) {
    const m = MAT[p];
    html += `<div class="banner" style="--c:${m.cor}"><h2>${m.emoji} Hoje é prova de ${h(m.curto)}</h2><div>Boa prova! Respira, lê o enunciado com calma.</div></div>`;
  }
  if (dia.nota) html += `<div class="note">💡 ${h(dia.nota)}</div>`;

  let cards = '';
  for (const id of dia.estudar || []) cards += cartaoEstudo(id, hoje);
  for (const mt of dia.revisar || []) cards += cartaoRevisao(mt, hoje, hoje + '|rev|' + mt);
  for (const mt of dia.simulado || []) cards += cartaoSimulado(mt, hoje + '|sim|' + mt, false);
  for (const mt of dia.vespera || []) cards += cartaoSimulado(mt, hoje + '|vesp|' + mt, true);
  html += `<section class="blk"><h2>Para hoje</h2>${cards || '<div class="empty">Nada planejado para hoje. Descanse 😊</div>'}</section>`;

  // atrasados: assuntos de dias anteriores ainda não estudados, com prova ainda por vir
  const atrasados = [];
  for (const d of PLANO.dias) {
    if (d.data >= hoje) break;
    for (const id of d.estudar || []) if (!estAss(id).estudado && provaDe(id) >= hoje) atrasados.push(id);
  }
  if (atrasados.length) {
    html += `<section class="blk"><h2>Ficou para trás</h2><p class="muted">Sem culpa: encaixe quando der, começando pela prova mais próxima.</p>`;
    html += atrasados.sort((a, b) => provaDe(a).localeCompare(provaDe(b))).map(id => cartaoEstudo(id, hoje, 'atrasado')).join('');
    html += '</section>';
  }

  // revisões vencidas de matérias que não estão no plano de hoje
  const planejadas = new Set(dia.revisar || []);
  const extras = PLANO.materias.filter(m => m.prova >= hoje && !planejadas.has(m.id) && devidos(m.id, hoje).length);
  if (extras.length) {
    html += `<section class="blk"><h2>Revisões vencidas</h2><p class="muted">Opcional: só se sobrar tempo.</p>`;
    html += extras.map(m => cartaoRevisao(m.id, hoje, hoje + '|rev|' + m.id)).join('');
    html += '</section>';
  }
  $('#app').innerHTML = html;
}

/* ---------- tela: Calendário ---------- */
function tarefasDoDia(d) {
  const it = [];
  for (const p of d.provas || []) it.push({ txt: 'PROVA de ' + MAT[p].curto, m: p, ok: false, prova: true });
  for (const id of d.estudar || []) it.push({ txt: ASS[id].nome, m: ASS[id].materia, ok: !!estAss(id).estudado });
  for (const mt of d.revisar || []) it.push({ txt: 'Revisar ' + MAT[mt].curto, m: mt, ok: tarefaFeita(d.data + '|rev|' + mt) });
  for (const mt of d.simulado || []) it.push({ txt: 'Simulado de ' + MAT[mt].curto, m: mt, ok: tarefaFeita(d.data + '|sim|' + mt) });
  for (const mt of d.vespera || []) it.push({ txt: 'Véspera: pontos-chave e erros de ' + MAT[mt].curto, m: mt, ok: tarefaFeita(d.data + '|vesp|' + mt) });
  return it;
}
function telaCalendario() {
  marcarAba('calendario');
  const hoje = hojeISO();
  let html = `<section class="blk"><h2>Calendário da VAT2</h2><p class="muted">Toque em “Hoje” para ver as tarefas com botões. <a href="#" id="baixar-ics">Baixar para o Google Agenda (.ics)</a></p>`;
  for (const d of PLANO.dias) {
    const prova = (d.provas || []).length > 0;
    const it = tarefasDoDia(d);
    html += `<div class="day ${d.data === hoje ? 'today' : ''} ${prova ? 'exam' : ''}" ${d.data === hoje ? 'id="hoje"' : ''}>
      <div class="date"><b>${parse(d.data).getDate()}</b><span>${DIAS_SEMANA[parse(d.data).getDay()]} ${String(parse(d.data).getMonth() + 1).padStart(2, '0')}</span></div>
      <ul>${it.map(i => `<li class="${i.ok ? 'ok' : ''}"><span class="pill" style="--c:${MAT[i.m].cor}">${MAT[i.m].emoji}</span>${i.prova ? '<b>' + h(i.txt) + '</b>' : h(i.txt)}</li>`).join('')}
      ${d.nota ? `<li class="muted">${h(d.nota)}</li>` : ''}</ul></div>`;
  }
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
  let html = '<section class="blk"><h2>Matérias</h2>';
  for (const m of PLANO.materias.slice().sort((a, b) => a.prova.localeCompare(b.prova))) {
    const d = diff(hoje, m.prova);
    const temBanco = Array.isArray(BANCOS[m.id]) && BANCOS[m.id].length;
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
      else if (!e.estudado) st = 'não estudado';
      else st = 'estudado ' + fmt(e.estudado) + (e.revisoes && e.revisoes.length ? ' · ' + e.revisoes.length + ' rev.' : '') + (e.proxima ? ' · próx. ' + fmt(e.proxima) : '');
      const ac = temBanco ? acertoAssunto(m.id, a.id) : null;
      const pct = ac && ac.feitas ? Math.round(100 * ac.certas / ac.feitas) : null;
      html += `<div class="topic"><button class="check ${e.estudado ? 'on' : ''}" style="--c:${m.cor};width:24px;height:24px;flex-basis:24px;font-size:.8rem" data-estudo="${a.id}">${e.estudado ? '✓' : ''}</button>
        <div class="grow"><div>${h(a.nome)}</div><div class="st">${st}${pct != null ? ` · acerto ${pct}% (${ac.feitas}/${ac.total})` : ac && ac.total ? ` · ${ac.total} questões` : ''}</div>
        ${pct != null ? `<div class="bar"><i style="width:${pct}%;--c:${pct >= 80 ? 'var(--correct)' : pct >= 60 ? '#C8962E' : 'var(--incorrect)'}"></i></div>` : ''}</div></div>`;
    }
    html += '</div>';
  }
  html += '</section>';
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
  let pool = todas.filter(x => !assuntos.length || assuntos.includes(x.assunto));
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
  $('#pos').innerHTML = `${q.clinicalPointers ? `<div class="pointer">🎯 ${h(q.clinicalPointers)}</div>` : ''}
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
  for (const d of PLANO.dias) {
    const it = tarefasDoDia(d).map(i => (i.prova ? '🔴 ' : MAT[i.m].emoji + ' ') + i.txt);
    const ini = d.data.replace(/-/g, ''), fim = addDias(d.data, 1).replace(/-/g, '');
    const prova = (d.provas || []).map(p => MAT[p].curto).join(' + ');
    linhas.push('BEGIN:VEVENT', 'UID:vat2-' + ini + '@vat2-estudos', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + ini, 'DTEND;VALUE=DATE:' + fim,
      'SUMMARY:' + esc(prova ? 'PROVA ' + prova : 'Estudo VAT2: ' + it.filter(x => !x.startsWith('🔴')).slice(0, 2).join(' / ')),
      'DESCRIPTION:' + esc(it.join('\\n') + (d.nota ? '\\n' + d.nota : '')),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Estudo VAT2', 'TRIGGER:PT8H', 'END:VALARM', 'END:VEVENT');
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
  const { partes, q } = rota();
  const [tela, arg] = partes;
  if (tela === 'calendario') telaCalendario();
  else if (tela === 'materias') await telaMaterias();
  else if (tela === 'ajustes') telaAjustes();
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
  $('#titulo-sub').textContent = PLANO.titulo;
  await render();
  if (Sync.cfg().token) { await Sync.agora(false); render(); }
})();
