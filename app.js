/* Terveyspäiväkirja – lääkkeet, treenit ja lenkit.
   Tiedot tallennetaan selaimen localStorageen (laitekohtaisesti). */

'use strict';

/* ---------- Tallennus ---------- */
const DB = {
  read(key, fallback) {
    try { return JSON.parse(localStorage.getItem('thd_' + key)) ?? fallback; }
    catch { return fallback; }
  },
  write(key, value) { localStorage.setItem('thd_' + key, JSON.stringify(value)); }
};

const state = {
  meds: DB.read('meds', []),          // {id, name, dose, time: morning|evening|both}
  medLog: DB.read('medLog', {}),      // { 'YYYY-MM-DD': { 'medId_morning': true } }
  workouts: DB.read('workouts', []),  // {id, date, name, notes, exercises:[{name, sets:[{weight,reps}]}]}
  runs: DB.read('runs', []),          // {id, date, name, distanceKm, durationSec, source, elevation, notes}
  templates: DB.read('templates', []),// {id, name, gym, exercises:[{name, setCount}]}
  settings: DB.read('settings', { remEnabled: false, remMorning: '08:00', remEvening: '20:00', pushServerUrl: '', syncCode: '' }),
  meta: DB.read('meta', { updatedAt: 0 }),
  selectedDate: todayISO()
};

const SYNC_KEYS = ['meds', 'medLog', 'workouts', 'runs', 'templates'];
let applyingSync = false;

function save(key) {
  DB.write(key, state[key]);
  if (SYNC_KEYS.includes(key) && !applyingSync) {
    state.meta.updatedAt = Date.now();
    DB.write('meta', state.meta);
    scheduleSyncPush();
  }
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayISO() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }

/* ---------- Apufunktiot ---------- */
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });
}
function fmtDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
               : `${m}:${String(s).padStart(2, '0')}`;
}
function pace(distanceKm, durationSec) {
  if (!distanceKm || !durationSec) return '–';
  const sp = durationSec / distanceKm; // s/km
  return `${Math.floor(sp / 60)}:${String(Math.round(sp % 60)).padStart(2, '0')} /km`;
}
function esc(str) { return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/* ---------- Navigaatio ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

$$('.tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tab').forEach(t => t.classList.remove('active'));
  $$('.view').forEach(v => v.classList.remove('active'));
  tab.classList.add('active');
  $('#view-' + tab.dataset.view).classList.add('active');
  if (tab.dataset.view === 'stats') renderStats();
}));

const dateInput = $('#globalDate');
dateInput.value = state.selectedDate;
dateInput.addEventListener('change', () => {
  state.selectedDate = dateInput.value || todayISO();
  renderMeds();
});

/* ============================================================
   LÄÄKKEET
   ============================================================ */
function medKey(med, slot) { return med.id + '_' + slot; }

function isTaken(date, key) { return !!(state.medLog[date] && state.medLog[date][key]); }

function toggleMed(date, key) {
  if (!state.medLog[date]) state.medLog[date] = {};
  if (state.medLog[date][key]) delete state.medLog[date][key];
  else state.medLog[date][key] = true;
  save('medLog');
  renderMeds();
}

function medsForSlot(slot) {
  return state.meds.filter(m => m.time === slot || m.time === 'both');
}

function renderMeds() {
  const date = state.selectedDate;
  const slots = [['morning', '#medListMorning'], ['evening', '#medListEvening']];
  let total = 0, taken = 0;

  slots.forEach(([slot, sel]) => {
    const list = $(sel);
    const meds = medsForSlot(slot);
    list.innerHTML = '';
    if (!meds.length) {
      list.innerHTML = '<li class="empty-hint">Ei lääkkeitä. Lisää alta “Hallinnoi lääkkeitä”.</li>';
      return;
    }
    meds.forEach(med => {
      const key = medKey(med, slot);
      const done = isTaken(date, key);
      total++; if (done) taken++;
      const li = document.createElement('li');
      li.className = 'med-item' + (done ? ' taken' : '');
      li.innerHTML = `
        <div class="med-check">✓</div>
        <div class="med-info">
          <div class="name">${esc(med.name)}</div>
          ${med.dose ? `<div class="dose">${esc(med.dose)}</div>` : ''}
        </div>`;
      li.addEventListener('click', () => toggleMed(date, key));
      list.appendChild(li);
    });
  });

  const summary = $('#medSummary');
  if (total === 0) {
    summary.innerHTML = `Ei vielä lääkkeitä lisättynä.`;
  } else if (taken === total) {
    summary.innerHTML = `🎉 Kaikki <strong>${total}</strong> lääkettä otettu — hyvää työtä!`;
  } else {
    summary.innerHTML = `Otettu <strong>${taken}/${total}</strong> lääkettä päivälle ${esc(fmtDate(date))}.`;
  }
  renderMedManageList();
}

function renderMedManageList() {
  const list = $('#medManageList');
  list.innerHTML = '';
  if (!state.meds.length) { list.innerHTML = '<li class="empty-hint">Ei lääkkeitä.</li>'; return; }
  const labels = { morning: 'Aamu', evening: 'Ilta', both: 'Aamu & ilta' };
  state.meds.forEach(med => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="name">${esc(med.name)}${med.dose ? ` <span style="color:var(--muted)">· ${esc(med.dose)}</span>` : ''}</span>
      <span class="tag">${labels[med.time]}</span>
      <button class="icon-btn" title="Poista">🗑</button>`;
    li.querySelector('.icon-btn').addEventListener('click', () => {
      if (confirm(`Poistetaanko lääke “${med.name}”?`)) {
        state.meds = state.meds.filter(m => m.id !== med.id);
        save('meds'); renderMeds(); syncPush();
      }
    });
    list.appendChild(li);
  });
}

$('#medForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#medName').value.trim();
  if (!name) return;
  state.meds.push({ id: uid(), name, dose: $('#medDose').value.trim(), time: $('#medTime').value });
  save('meds');
  e.target.reset();
  renderMeds();
  toast('Lääke lisätty');
  syncPush();
});

/* ============================================================
   MODAALI (yhteinen)
   ============================================================ */
const modal = $('#modal');
function openModal(title, bodyEl) {
  $('#modalTitle').textContent = title;
  const body = $('#modalBody'); body.innerHTML = ''; body.appendChild(bodyEl);
  modal.hidden = false;
}
function closeModal() { modal.hidden = true; }
$('#modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

/* ============================================================
   TREENIT
   ============================================================ */
function renderWorkouts() {
  const list = $('#workoutList');
  list.innerHTML = '';
  const items = [...state.workouts].sort((a, b) => b.date.localeCompare(a.date));
  if (!items.length) { list.innerHTML = '<li class="empty-hint">Ei treenejä vielä. Lisää ensimmäinen “+ Uusi treeni”.</li>'; return; }
  items.forEach(w => {
    const totalSets = (w.exercises || []).reduce((n, e) => n + (e.sets ? e.sets.length : 0), 0);
    const li = document.createElement('li');
    li.className = 'entry-card';
    li.innerHTML = `
      <div class="ec-head">
        <span class="ec-title">${esc(w.name || 'Treeni')}</span>
        <span class="ec-date">${esc(fmtDate(w.date))}</span>
      </div>
      <div class="ec-meta">
        ${w.gym ? `<span>🏋️ ${esc(w.gym)}</span>` : ''}
        <span><b>${(w.exercises || []).length}</b> liikettä</span>
        <span><b>${totalSets}</b> sarjaa</span>
        ${w.notes ? `<span>📝 ${esc(w.notes.slice(0, 40))}${w.notes.length > 40 ? '…' : ''}</span>` : ''}
      </div>`;
    li.addEventListener('click', () => openWorkoutEditor(JSON.parse(JSON.stringify(w)), true));
    list.appendChild(li);
  });
}

/* Etsii saman liikkeen viimeisimmät sarjat aiemmista treeneistä.
   Suosii samaa ohjelmaa (templateId), muuten yleisesti viimeisin esiintymä. */
function prevSetsFor(name, templateId, excludeId) {
  if (!name) return null;
  const cands = state.workouts
    .filter(w => w.id !== excludeId && (w.exercises || []).some(e => e.name === name && e.sets && e.sets.length))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!cands.length) return null;
  const chosen = (templateId && cands.find(w => w.templateId === templateId)) || cands[0];
  const ex = chosen.exercises.find(e => e.name === name && e.sets && e.sets.length);
  return { date: chosen.date, sets: ex.sets };
}
function fmtSetsShort(sets) {
  return sets.filter(s => s.weight !== '' || s.reps !== '')
    .map(s => `${s.weight !== '' && s.weight != null ? s.weight + 'kg' : '–'}${s.reps !== '' && s.reps != null ? '×' + s.reps : ''}`)
    .join(', ');
}
function fmtDateShort(iso) { const d = new Date(iso + 'T00:00:00'); return `${d.getDate()}.${d.getMonth() + 1}.`; }

function blankWorkoutDraft() {
  return { id: uid(), date: state.selectedDate, name: '', gym: '', notes: '', templateId: null, exercises: [{ name: '', sets: [{ weight: '', reps: '' }] }] };
}

/* Rakentaa treeniluonnoksen ohjelmasta ja esitäyttää sarjat viime kerran arvoilla. */
function draftFromTemplate(tpl) {
  return {
    id: uid(), date: state.selectedDate, name: tpl.name, gym: tpl.gym || '',
    templateId: tpl.id, notes: '',
    exercises: (tpl.exercises || []).map(te => {
      const prev = prevSetsFor(te.name, tpl.id, null);
      const count = Math.max(1, te.setCount || (prev ? prev.sets.length : 1) || 1);
      const sets = Array.from({ length: count }, (_, i) =>
        prev && prev.sets[i] ? { weight: prev.sets[i].weight, reps: prev.sets[i].reps } : { weight: '', reps: '' });
      return { name: te.name, sets };
    })
  };
}

/* Ohjelmavalitsin uutta treeniä aloitettaessa */
function openWorkoutStarter() {
  const wrap = document.createElement('div');
  const tpls = state.templates;
  wrap.innerHTML = `
    <button class="btn primary full" id="startBlank" style="margin-bottom:14px;">Tyhjä treeni</button>
    ${tpls.length ? '<div class="rb-label" style="margin-bottom:8px;">Tai valitse oma ohjelma:</div>' : '<p class="empty-hint">Ei vielä omia ohjelmia. Luo sellainen alta.</p>'}
    <ul class="entry-list" id="tplPick"></ul>
    <button class="btn ghost full" id="goManage" style="margin-top:14px;">Hallinnoi ohjelmia</button>`;
  const list = wrap.querySelector('#tplPick');
  tpls.forEach(t => {
    const li = document.createElement('li');
    li.className = 'entry-card';
    li.innerHTML = `
      <div class="ec-head"><span class="ec-title">${esc(t.name)}</span>${t.gym ? `<span class="ec-date">${esc(t.gym)}</span>` : ''}</div>
      <div class="ec-meta"><span>${(t.exercises || []).map(e => esc(e.name)).join(' · ') || 'ei liikkeitä'}</span></div>`;
    li.addEventListener('click', () => openWorkoutEditor(draftFromTemplate(t), false));
    list.appendChild(li);
  });
  wrap.querySelector('#startBlank').addEventListener('click', () => openWorkoutEditor(blankWorkoutDraft(), false));
  wrap.querySelector('#goManage').addEventListener('click', openTemplateManager);
  openModal('Aloita treeni', wrap);
}

/* Treeniohjelmien hallinta */
function openTemplateManager() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <button class="btn primary full" id="newTpl" style="margin-bottom:14px;">+ Uusi ohjelma</button>
    <ul class="entry-list" id="tplList"></ul>`;
  const list = wrap.querySelector('#tplList');
  if (!state.templates.length) list.innerHTML = '<li class="empty-hint">Ei ohjelmia vielä. Luo salikohtainen oma ohjelma yltä.</li>';
  state.templates.forEach(t => {
    const li = document.createElement('li');
    li.className = 'entry-card';
    li.innerHTML = `
      <div class="ec-head"><span class="ec-title">${esc(t.name)}</span>${t.gym ? `<span class="ec-date">${esc(t.gym)}</span>` : ''}</div>
      <div class="ec-meta"><span><b>${(t.exercises || []).length}</b> liikettä</span><span>${(t.exercises || []).map(e => esc(e.name)).join(' · ')}</span></div>`;
    li.addEventListener('click', () => openTemplateEditor(t));
    list.appendChild(li);
  });
  wrap.querySelector('#newTpl').addEventListener('click', () => openTemplateEditor(null));
  openModal('Treeniohjelmat', wrap);
}

function openTemplateEditor(existing) {
  const t = existing ? JSON.parse(JSON.stringify(existing))
    : { id: uid(), name: '', gym: '', exercises: [{ name: '', setCount: 3 }] };
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="row two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <label>Ohjelman nimi<input type="text" id="tName" placeholder="esim. Työntö A" value="${esc(t.name)}"></label>
      <label>Sali<input type="text" id="tGym" placeholder="esim. Kotisali" value="${esc(t.gym)}"></label>
    </div>
    <div class="rb-label" style="margin-bottom:6px;">Liikkeet ja sarjamäärät</div>
    <div id="tExWrap"></div>
    <button class="mini-btn" id="tAddEx" style="width:100%;margin:4px 0 14px;">+ Lisää liike</button>
    <div class="modal-actions">
      ${existing ? '<button class="btn danger" id="tDel">Poista</button>' : ''}
      <button class="btn primary" id="tSave">Tallenna ohjelma</button>
    </div>`;
  const wrap = form.querySelector('#tExWrap');
  function renderEx() {
    wrap.innerHTML = '';
    t.exercises.forEach((ex, i) => {
      const row = document.createElement('div');
      row.className = 'tpl-ex-row';
      row.innerHTML = `
        <input type="text" class="t-name" data-i="${i}" placeholder="Liike (esim. Kyykky)" value="${esc(ex.name)}">
        <input type="number" class="t-sets" data-i="${i}" min="1" max="20" value="${ex.setCount || 3}" title="Sarjojen määrä">
        <span class="muted-x">sarjaa</span>
        <button class="mini-btn t-del" data-i="${i}" title="Poista">✕</button>`;
      wrap.appendChild(row);
    });
  }
  form.addEventListener('input', e => {
    const el = e.target;
    if (el.classList.contains('t-name')) t.exercises[+el.dataset.i].name = el.value;
    else if (el.classList.contains('t-sets')) t.exercises[+el.dataset.i].setCount = Math.max(1, parseInt(el.value) || 1);
  });
  form.addEventListener('click', e => {
    if (e.target.classList.contains('t-del')) { t.exercises.splice(+e.target.dataset.i, 1); renderEx(); }
  });
  form.querySelector('#tAddEx').addEventListener('click', () => { t.exercises.push({ name: '', setCount: 3 }); renderEx(); });
  form.querySelector('#tSave').addEventListener('click', () => {
    t.name = form.querySelector('#tName').value.trim();
    t.gym = form.querySelector('#tGym').value.trim();
    t.exercises = t.exercises.map(ex => ({ name: ex.name.trim(), setCount: Math.max(1, ex.setCount || 1) })).filter(ex => ex.name);
    if (!t.name) { toast('Anna ohjelmalle nimi'); return; }
    const idx = state.templates.findIndex(x => x.id === t.id);
    if (idx >= 0) state.templates[idx] = t; else state.templates.push(t);
    save('templates'); toast('Ohjelma tallennettu'); openTemplateManager();
  });
  if (existing) form.querySelector('#tDel').addEventListener('click', () => {
    if (confirm(`Poistetaanko ohjelma “${t.name}”?`)) {
      state.templates = state.templates.filter(x => x.id !== t.id);
      save('templates'); openTemplateManager();
    }
  });
  renderEx();
  openModal(existing ? 'Muokkaa ohjelmaa' : 'Uusi ohjelma', form);
}

function openWorkoutEditor(w, isExisting) {
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="row two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <label>Päivämäärä<input type="date" id="wDate" value="${w.date}"></label>
      <label>Treenin nimi<input type="text" id="wName" placeholder="esim. Jalkapäivä" value="${esc(w.name)}"></label>
    </div>
    <label style="margin-bottom:12px;display:block;">Sali (valinnainen)<input type="text" id="wGym" placeholder="esim. Kotisali" value="${esc(w.gym || '')}"></label>
    <div id="exWrap"></div>
    <button class="mini-btn" id="addEx" style="width:100%;margin:4px 0 14px;">+ Lisää liike</button>
    <label>Muistiinpanot<textarea id="wNotes" placeholder="Fiilis, kommentit…">${esc(w.notes)}</textarea></label>
    <div class="modal-actions">
      ${isExisting ? '<button class="btn danger" id="wDelete">Poista</button>' : ''}
      <button class="btn primary" id="wSave">Tallenna</button>
    </div>`;

  const exWrap = form.querySelector('#exWrap');

  function renderExercises() {
    exWrap.innerHTML = '';
    w.exercises.forEach((ex, ei) => {
      const prev = prevSetsFor(ex.name, w.templateId, w.id);
      const prevHtml = prev && fmtSetsShort(prev.sets)
        ? `<div class="prev-ref">📅 Viime kerralla ${fmtDateShort(prev.date)}: <b>${esc(fmtSetsShort(prev.sets))}</b>
             <button class="mini-btn prev-copy" data-ei="${ei}">↻ kopioi</button></div>`
        : '';
      const block = document.createElement('div');
      block.className = 'exercise';
      block.innerHTML = `
        <div class="ex-name-row">
          <input type="text" placeholder="Liike (esim. Penkkipunnerrus)" value="${esc(ex.name)}" data-ei="${ei}" class="ex-name">
          <button class="mini-btn ex-del" data-ei="${ei}" title="Poista liike">🗑</button>
        </div>
        ${prevHtml}
        <div class="sets" data-ei="${ei}"></div>
        <button class="mini-btn add-set" data-ei="${ei}" style="margin-top:8px;">+ Sarja</button>`;
      const setsBox = block.querySelector('.sets');
      ex.sets.forEach((set, si) => {
        const row = document.createElement('div');
        row.className = 'set-row';
        row.innerHTML = `
          <span class="set-no">${si + 1}.</span>
          <input type="number" inputmode="decimal" placeholder="Paino kg" value="${esc(set.weight)}" data-ei="${ei}" data-si="${si}" data-f="weight">
          <input type="number" inputmode="numeric" placeholder="Toistot" value="${esc(set.reps)}" data-ei="${ei}" data-si="${si}" data-f="reps">
          <button class="mini-btn set-del" data-ei="${ei}" data-si="${si}">✕</button>`;
        setsBox.appendChild(row);
      });
      exWrap.appendChild(block);
    });
  }

  // Tapahtumat (delegointi)
  form.addEventListener('input', e => {
    const t = e.target;
    if (t.classList.contains('ex-name')) w.exercises[+t.dataset.ei].name = t.value;
    else if (t.dataset.f) w.exercises[+t.dataset.ei].sets[+t.dataset.si][t.dataset.f] = t.value;
  });
  form.addEventListener('click', e => {
    const t = e.target;
    if (t.classList.contains('add-set')) { w.exercises[+t.dataset.ei].sets.push({ weight: '', reps: '' }); renderExercises(); }
    else if (t.classList.contains('set-del')) { w.exercises[+t.dataset.ei].sets.splice(+t.dataset.si, 1); renderExercises(); }
    else if (t.classList.contains('ex-del')) { w.exercises.splice(+t.dataset.ei, 1); renderExercises(); }
    else if (t.classList.contains('prev-copy')) {
      const ei = +t.dataset.ei;
      const prev = prevSetsFor(w.exercises[ei].name, w.templateId, w.id);
      if (prev) { w.exercises[ei].sets = prev.sets.map(s => ({ weight: s.weight, reps: s.reps })); renderExercises(); }
    }
  });
  form.querySelector('#addEx').addEventListener('click', () => { w.exercises.push({ name: '', sets: [{ weight: '', reps: '' }] }); renderExercises(); });

  form.querySelector('#wSave').addEventListener('click', () => {
    w.date = form.querySelector('#wDate').value || todayISO();
    w.name = form.querySelector('#wName').value.trim();
    w.gym = form.querySelector('#wGym').value.trim();
    w.notes = form.querySelector('#wNotes').value.trim();
    w.exercises = w.exercises
      .map(ex => ({ name: ex.name.trim(), sets: ex.sets.filter(s => s.weight !== '' || s.reps !== '') }))
      .filter(ex => ex.name || ex.sets.length);
    const idx = state.workouts.findIndex(x => x.id === w.id);
    if (idx >= 0) state.workouts[idx] = w; else state.workouts.push(w);
    save('workouts'); renderWorkouts(); closeModal(); toast('Treeni tallennettu');
  });
  if (isExisting) form.querySelector('#wDelete').addEventListener('click', () => {
    if (confirm('Poistetaanko treeni?')) {
      state.workouts = state.workouts.filter(x => x.id !== w.id);
      save('workouts'); renderWorkouts(); closeModal();
    }
  });

  renderExercises();
  openModal(isExisting ? 'Muokkaa treeniä' : 'Uusi treeni', form);
}

$('#addWorkoutBtn').addEventListener('click', openWorkoutStarter);
$('#manageTemplatesBtn').addEventListener('click', openTemplateManager);

/* ============================================================
   LENKIT
   ============================================================ */
function renderRuns() {
  const list = $('#runList');
  list.innerHTML = '';
  const items = [...state.runs].sort((a, b) => b.date.localeCompare(a.date));

  // Yhteenveto (kuluva kuukausi)
  const ym = state.selectedDate.slice(0, 7);
  const month = state.runs.filter(r => r.date.startsWith(ym));
  const km = month.reduce((s, r) => s + (r.distanceKm || 0), 0);
  const sec = month.reduce((s, r) => s + (r.durationSec || 0), 0);
  $('#runStats').innerHTML = `
    <div class="stat"><div class="v">${month.length}</div><div class="l">Lenkkiä / kk</div></div>
    <div class="stat"><div class="v">${km.toFixed(1)}</div><div class="l">km yhteensä</div></div>
    <div class="stat"><div class="v">${km ? pace(km, sec).replace(' /km', '') : '–'}</div><div class="l">keskivauhti</div></div>`;

  if (!items.length) { list.innerHTML = '<li class="empty-hint">Ei lenkkejä. Lisää käsin tai tuo GPX-tiedosto Sports Trackerista.</li>'; return; }
  items.forEach(r => {
    const li = document.createElement('li');
    li.className = 'entry-card';
    li.innerHTML = `
      <div class="ec-head">
        <span class="ec-title">${esc(r.name || 'Lenkki')}${r.source === 'gpx' ? '<span class="src-badge">GPX</span>' : ''}</span>
        <span class="ec-date">${esc(fmtDate(r.date))}</span>
      </div>
      <div class="ec-meta">
        <span><b>${(r.distanceKm || 0).toFixed(2)}</b> km</span>
        <span><b>${fmtDuration(r.durationSec || 0)}</b></span>
        <span>${pace(r.distanceKm, r.durationSec)}</span>
        ${r.elevation ? `<span>↑ <b>${Math.round(r.elevation)}</b> m</span>` : ''}
      </div>`;
    li.addEventListener('click', () => openRunEditor(r));
    list.appendChild(li);
  });
}

function openRunEditor(existing) {
  const r = existing ? { ...existing } : { id: uid(), date: state.selectedDate, name: '', distanceKm: '', durationSec: 0, source: 'manual', notes: '' };
  const mins = r.durationSec ? Math.floor(r.durationSec / 60) : '';
  const secs = r.durationSec ? r.durationSec % 60 : '';

  const form = document.createElement('div');
  form.innerHTML = `
    <div class="row two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <label>Päivämäärä<input type="date" id="rDate" value="${r.date}"></label>
      <label>Nimi<input type="text" id="rName" placeholder="esim. Aamulenkki" value="${esc(r.name)}"></label>
    </div>
    <div class="row two" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">
      <label>Matka (km)<input type="number" inputmode="decimal" id="rDist" value="${r.distanceKm}"></label>
      <label>Kesto min<input type="number" inputmode="numeric" id="rMin" value="${mins}"></label>
      <label>sek<input type="number" inputmode="numeric" id="rSec" value="${secs}"></label>
    </div>
    <label style="margin-bottom:12px;display:block;">Nousu (m, valinnainen)<input type="number" inputmode="numeric" id="rEle" value="${r.elevation ?? ''}"></label>
    <label>Muistiinpanot<textarea id="rNotes" placeholder="Reitti, fiilis…">${esc(r.notes)}</textarea></label>
    <div class="modal-actions">
      ${existing ? '<button class="btn danger" id="rDelete">Poista</button>' : ''}
      <button class="btn primary" id="rSave">Tallenna</button>
    </div>`;

  form.querySelector('#rSave').addEventListener('click', () => {
    r.date = form.querySelector('#rDate').value || todayISO();
    r.name = form.querySelector('#rName').value.trim();
    r.distanceKm = parseFloat(form.querySelector('#rDist').value) || 0;
    r.durationSec = (parseInt(form.querySelector('#rMin').value) || 0) * 60 + (parseInt(form.querySelector('#rSec').value) || 0);
    const ele = parseFloat(form.querySelector('#rEle').value);
    r.elevation = isNaN(ele) ? null : ele;
    r.notes = form.querySelector('#rNotes').value.trim();
    const idx = state.runs.findIndex(x => x.id === r.id);
    if (idx >= 0) state.runs[idx] = r; else state.runs.push(r);
    save('runs'); renderRuns(); closeModal(); toast('Lenkki tallennettu');
  });
  if (existing) form.querySelector('#rDelete').addEventListener('click', () => {
    if (confirm('Poistetaanko lenkki?')) {
      state.runs = state.runs.filter(x => x.id !== r.id);
      save('runs'); renderRuns(); closeModal();
    }
  });

  openModal(existing ? 'Muokkaa lenkkiä' : 'Uusi lenkki', form);
}

$('#addRunBtn').addEventListener('click', () => openRunEditor(null));

/* ---------- GPX-tuonti (esim. Sports Tracker -> Export GPX) ---------- */
function haversine(a, b) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function parseGpx(text, fallbackName) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Virheellinen GPX-tiedosto');
  const pts = [...doc.querySelectorAll('trkpt, rtept')].map(p => ({
    lat: parseFloat(p.getAttribute('lat')),
    lon: parseFloat(p.getAttribute('lon')),
    ele: parseFloat(p.querySelector('ele')?.textContent),
    time: p.querySelector('time')?.textContent
  })).filter(p => !isNaN(p.lat) && !isNaN(p.lon));
  if (pts.length < 2) throw new Error('GPX ei sisällä reittipisteitä');

  let dist = 0, gain = 0;
  for (let i = 1; i < pts.length; i++) {
    dist += haversine(pts[i - 1], pts[i]);
    if (!isNaN(pts[i].ele) && !isNaN(pts[i - 1].ele)) {
      const d = pts[i].ele - pts[i - 1].ele;
      if (d > 0) gain += d;
    }
  }
  const times = pts.map(p => p.time && Date.parse(p.time)).filter(Boolean);
  const durationSec = times.length >= 2 ? (Math.max(...times) - Math.min(...times)) / 1000 : 0;
  const name = doc.querySelector('trk > name, metadata > name')?.textContent?.trim() || fallbackName;
  const startDate = times.length ? new Date(Math.min(...times)) : new Date();
  startDate.setMinutes(startDate.getMinutes() - startDate.getTimezoneOffset());

  return {
    id: uid(),
    date: startDate.toISOString().slice(0, 10),
    name,
    distanceKm: dist / 1000,
    durationSec,
    elevation: gain || null,
    source: 'gpx',
    notes: ''
  };
}

$('#gpxInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  let ok = 0, fail = 0;
  for (const file of files) {
    try {
      const text = await file.text();
      state.runs.push(parseGpx(text, file.name.replace(/\.gpx$/i, '')));
      ok++;
    } catch (err) { console.error(err); fail++; }
  }
  if (ok) save('runs');
  renderRuns();
  e.target.value = '';
  toast(`${ok} lenkki(ä) tuotu${fail ? `, ${fail} epäonnistui` : ''}`);
});

/* ============================================================
   MUISTUTUKSET (lääkkeet)
   Selaimen Notification-API. Toimii kun sovellus on auki / taustalla
   laitteella; ajastus uusitaan aina sivun avautuessa.
   ============================================================ */
let reminderTimers = [];
const REM_SLOTS = [
  ['morning', () => state.settings.remMorning, 'Aamulääkkeet 🌅'],
  ['evening', () => state.settings.remEvening, 'Iltalääkkeet 🌙']
];
const MED_ICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💊</text></svg>";

function notifSupported() { return 'Notification' in window; }

function untakenMeds(slot) {
  return medsForSlot(slot).filter(m => !isTaken(todayISO(), medKey(m, slot)));
}

/* Näytä ilmoitus ensisijaisesti service workerin kautta (näkyy myös kun
   sovellus on taustalla / lisätty aloitusnäyttöön); muuten suoraan. */
function showNotification(title, body) {
  if (!notifSupported() || Notification.permission !== 'granted') return;
  const opts = { body, icon: MED_ICON, badge: MED_ICON, tag: 'med-reminder', renotify: true };
  if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts)).catch(() => {
      try { new Notification(title, opts); } catch {}
    });
  } else {
    try { new Notification(title, opts); } catch {}
  }
}

function markNotified(slot) {
  const today = todayISO();
  state.settings.notified = state.settings.notified || {};
  // Säilytä vain tämän päivän merkinnät
  Object.keys(state.settings.notified).forEach(k => { if (!k.startsWith(today)) delete state.settings.notified[k]; });
  state.settings.notified[today + '_' + slot] = true;
  save('settings');
}
function wasNotified(slot) {
  return !!(state.settings.notified && state.settings.notified[todayISO() + '_' + slot]);
}

function fireReminder(slot, title) {
  const left = untakenMeds(slot);
  if (left.length) {
    showNotification(title, 'Muista ottaa: ' + left.map(m => m.name).join(', '));
    markNotified(slot);
  }
}

function scheduleReminders() {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];
  if (!state.settings.remEnabled || !notifSupported() || Notification.permission !== 'granted') return;

  REM_SLOTS.forEach(([slot, getTime, title]) => {
    const hhmm = getTime();
    if (!hhmm) return;
    const [h, m] = hhmm.split(':').map(Number);
    const next = new Date();
    next.setHours(h, m, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    const delay = next - Date.now();
    if (delay > 2 ** 31 - 1) return; // setTimeout-yläraja n. 24 vrk
    reminderTimers.push(setTimeout(() => {
      fireReminder(slot, title);
      scheduleReminders(); // ajasta seuraava päivä
    }, delay));
  });
}

/* Jos muistutusaika on jo mennyt tänään eikä lääkkeitä ole otettu, näytä
   ilmoitus heti kun sovellus avataan/palaa etualalle. */
function checkMissedReminders() {
  if (!state.settings.remEnabled || !notifSupported() || Notification.permission !== 'granted') return;
  const now = new Date();
  REM_SLOTS.forEach(([slot, getTime, title]) => {
    const hhmm = getTime();
    if (!hhmm || wasNotified(slot)) return;
    const [h, m] = hhmm.split(':').map(Number);
    const t = new Date(); t.setHours(h, m, 0, 0);
    if (now >= t) fireReminder(slot, title);
  });
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkMissedReminders(); syncPull(); } });

/* ---------- Web Push (taustapalvelu) ----------
   Jos käyttäjä on antanut push-palvelimen osoitteen, tilataan push-ilmoitukset,
   jolloin muistutukset tulevat myös sovellus suljettuna. */
function pushBase() { return (state.settings.pushServerUrl || '').trim().replace(/\/+$/, ''); }
function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window; }

function urlB64ToUint8Array(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function medNamesBySlot() {
  return { morning: medsForSlot('morning').map(m => m.name), evening: medsForSlot('evening').map(m => m.name) };
}

let pushSyncing = false;
async function syncPush(opts = {}) {
  const base = pushBase();
  if (!base || !pushSupported() || pushSyncing) return;
  pushSyncing = true;
  try {
    const reg = await navigator.serviceWorker.ready;

    // Muistutukset pois -> peru tilaus palvelimelta
    if (!state.settings.remEnabled) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) await fetch(base + '/api/unsubscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint })
      }).catch(() => {});
      return;
    }
    if (!notifSupported() || Notification.permission !== 'granted') return;

    const r = await fetch(base + '/api/vapidPublicKey');
    if (!r.ok) throw new Error('vapid');
    const { key } = await r.json();

    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });

    const resp = await fetch(base + '/api/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub,
        settings: {
          remEnabled: true,
          remMorning: state.settings.remMorning,
          remEvening: state.settings.remEvening,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          meds: medNamesBySlot()
        }
      })
    });
    if (!resp.ok) throw new Error('subscribe');
    if (opts.announce) toast('Push-muistutukset käytössä ✅');
  } catch (e) {
    console.error('syncPush', e);
    if (opts.announce) toast('Push-palvelimeen ei saatu yhteyttä');
  } finally {
    pushSyncing = false;
    updateReminderHint();
  }
}

async function sendTestPush() {
  const base = pushBase();
  if (!base) { toast('Anna ensin palvelimen osoite'); return; }
  if (!pushSupported()) { toast('Selain ei tue push-ilmoituksia'); return; }
  if (!state.settings.remEnabled || Notification.permission !== 'granted') { toast('Kytke muistutukset ensin päälle'); return; }
  try {
    await syncPush();
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) { toast('Tilaus puuttuu'); return; }
    const r = await fetch(base + '/api/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
    toast(r.ok ? 'Testimuistutus lähetetty 📨' : 'Testi epäonnistui');
  } catch (e) { console.error(e); toast('Testi epäonnistui'); }
}

/* ============================================================
   SYNKRONOINTI (laitteiden välillä, sama palvelin kuin push)
   Koko datan synkronointi synkronointikoodilla. Uusin voittaa
   (aikaleima koko datasta). ============================================ */
function syncCode() { return (state.settings.syncCode || '').trim(); }
function syncEnabled() { return !!(pushBase() && syncCode().length >= 4); }
function syncBundle() {
  const b = {};
  SYNC_KEYS.forEach(k => { b[k] = state[k]; });
  return b;
}
function applySync(data) {
  applyingSync = true;
  SYNC_KEYS.forEach(k => { if (data[k] !== undefined) { state[k] = data[k]; DB.write(k, state[k]); } });
  applyingSync = false;
  renderMeds(); renderWorkouts(); renderRuns();
}

async function syncPushNow() {
  if (!syncEnabled()) return;
  try {
    await fetch(pushBase() + '/api/sync/push', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: syncCode(), data: syncBundle(), updatedAt: state.meta.updatedAt || Date.now() })
    });
    updateSyncHint('Synkronoitu äsken');
  } catch (e) { console.error('syncPush', e); updateSyncHint('Synkronointi epäonnistui (palvelin?)'); }
}

let syncTimer = null;
function scheduleSyncPush() {
  if (applyingSync || !syncEnabled()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncPushNow().catch(() => {}), 1500);
}

async function syncPull(opts = {}) {
  if (!syncEnabled()) return;
  try {
    const r = await fetch(pushBase() + '/api/sync/pull', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: syncCode() })
    });
    if (!r.ok) throw new Error('pull ' + r.status);
    const { data, updatedAt } = await r.json();
    if (data && updatedAt > (state.meta.updatedAt || 0)) {
      applySync(data);
      state.meta.updatedAt = updatedAt; DB.write('meta', state.meta);
      if (opts.announce) toast('Tiedot synkronoitu tältä palvelimelta');
      updateSyncHint('Tiedot päivitetty palvelimelta');
    } else if (!data) {
      await syncPushNow(); // palvelin tyhjä -> vie omat tiedot
    } else {
      updateSyncHint('Ajan tasalla');
    }
  } catch (e) { console.error('syncPull', e); updateSyncHint('Synkronointi epäonnistui (palvelin?)'); }
}

/* Ensimmäinen synkronointi kun koodi asetetaan: kysy suunta jos palvelimella on jo tietoja. */
async function syncFirstTime() {
  if (!syncEnabled()) return;
  try {
    const r = await fetch(pushBase() + '/api/sync/pull', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: syncCode() })
    });
    const { data, updatedAt } = await r.json();
    const localHasData = SYNC_KEYS.some(k => Array.isArray(state[k]) ? state[k].length : Object.keys(state[k] || {}).length);
    if (data && localHasData) {
      const download = confirm('Tällä synkronointikoodilla on jo tietoja palvelimella.\n\nOK = LATAA ne tähän laitteeseen (tämän laitteen nykyiset tiedot korvataan).\nPeruuta = LÄHETÄ tämän laitteen tiedot palvelimelle (palvelimen tiedot korvataan).');
      if (download) { applySync(data); state.meta.updatedAt = updatedAt; DB.write('meta', state.meta); toast('Ladattu palvelimelta'); }
      else { state.meta.updatedAt = Date.now(); DB.write('meta', state.meta); await syncPushNow(); toast('Lähetetty palvelimelle'); }
    } else if (data) {
      applySync(data); state.meta.updatedAt = updatedAt; DB.write('meta', state.meta); toast('Ladattu palvelimelta');
    } else {
      state.meta.updatedAt = Date.now(); DB.write('meta', state.meta); await syncPushNow(); toast('Synkronointi käytössä ✅');
    }
  } catch (e) { console.error(e); updateSyncHint('Palvelimeen ei saatu yhteyttä'); }
  updateSyncHint();
}

function updateSyncHint(msg) {
  const hint = $('#syncHint');
  if (!hint) return;
  if (msg) { hint.textContent = msg; return; }
  if (!pushBase()) { hint.textContent = 'Aseta ensin palvelimen osoite Muistutukset-osiossa.'; return; }
  if (syncCode().length < 4) { hint.textContent = 'Synkronointi pois päältä.'; return; }
  hint.textContent = 'Synkronointi päällä. Käytä samaa koodia muillakin laitteilla.';
}

function initSyncUI() {
  const code = $('#syncCode');
  code.value = state.settings.syncCode || '';
  code.addEventListener('change', () => {
    state.settings.syncCode = code.value.trim();
    DB.write('settings', state.settings);
    updateSyncHint();
    if (syncEnabled()) syncFirstTime();
  });
  $('#syncNow').addEventListener('click', () => {
    if (!syncEnabled()) { toast('Aseta palvelin ja koodi ensin'); return; }
    syncPull({ announce: true });
  });
  updateSyncHint();
}

function updateReminderHint() {
  const hint = $('#remHint');
  if (!('Notification' in window)) { hint.textContent = 'Tämä selain ei tue muistutuksia.'; return; }
  if (!state.settings.remEnabled) { hint.textContent = 'Muistutukset pois päältä.'; return; }
  if (Notification.permission === 'denied') { hint.textContent = '⚠️ Ilmoitukset on estetty selaimen asetuksissa.'; return; }
  if (Notification.permission === 'granted') {
    const push = pushBase()
      ? ' Push-palvelin asetettu – muistutukset tulevat myös sovellus suljettuna.'
      : ' Pidä sovellus auki tai lisättynä aloitusnäyttöön. (Lisää push-palvelin saadaksesi muistutukset myös suljettuna.)';
    hint.textContent = `Muistutukset päällä – aamu ${state.settings.remMorning}, ilta ${state.settings.remEvening}.` + push;
  } else hint.textContent = 'Napauta kytkintä salliaksesi ilmoitukset.';
}

function initReminderUI() {
  const enabled = $('#remEnabled'), mor = $('#remMorning'), eve = $('#remEvening'), purl = $('#pushUrl');
  enabled.checked = state.settings.remEnabled;
  mor.value = state.settings.remMorning;
  eve.value = state.settings.remEvening;
  purl.value = state.settings.pushServerUrl || '';

  enabled.addEventListener('change', async () => {
    if (enabled.checked && 'Notification' in window && Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { enabled.checked = false; updateReminderHint(); return; }
    }
    state.settings.remEnabled = enabled.checked;
    save('settings'); scheduleReminders(); updateReminderHint();
    if (enabled.checked) showNotification('Muistutukset päällä ✅', 'Saat jatkossa muistutuksen lääkkeistä.');
    syncPush({ announce: !!pushBase() });
  });
  [mor, eve].forEach(el => el.addEventListener('change', () => {
    state.settings.remMorning = mor.value;
    state.settings.remEvening = eve.value;
    save('settings'); scheduleReminders(); updateReminderHint(); syncPush();
  }));
  purl.addEventListener('change', () => {
    state.settings.pushServerUrl = purl.value.trim();
    save('settings'); updateReminderHint(); updateSyncHint(); syncPush({ announce: true });
  });
  $('#pushTest').addEventListener('click', sendTestPush);
  updateReminderHint();
}

/* ============================================================
   TILASTOT / GRAAFIT (kevyt SVG, ei kirjastoja)
   ============================================================ */
function isoWeekStart(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // ma=0
  x.setDate(x.getDate() - day);
  return x;
}

function barChart(data, unit) {
  // data: [{label, value}]
  if (!data.length || data.every(d => d.value === 0))
    return '<div class="chart-empty">Ei vielä dataa.</div>';
  const W = 640, H = 220, padL = 34, padB = 28, padT = 14, padR = 8;
  const max = Math.max(...data.map(d => d.value)) || 1;
  const niceMax = Math.ceil(max * 1.1);
  const cw = (W - padL - padR) / data.length;
  const bw = Math.min(cw * 0.6, 42);
  const y = v => padT + (H - padT - padB) * (1 - v / niceMax);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  for (let i = 0; i <= 4; i++) {
    const v = niceMax * i / 4, yy = y(v);
    svg += `<line class="grid-line" x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}"/>`;
    svg += `<text class="axis-label" x="${padL - 5}" y="${yy + 3}" text-anchor="end">${v % 1 ? v.toFixed(1) : v}</text>`;
  }
  data.forEach((d, i) => {
    const x = padL + i * cw + (cw - bw) / 2;
    const yy = y(d.value), h = (H - padT - padB) - (yy - padT);
    svg += `<rect class="bar" x="${x}" y="${yy}" width="${bw}" height="${Math.max(0, h)}" rx="3"><title>${esc(d.label)}: ${d.value}${unit}</title></rect>`;
    if (d.value > 0) svg += `<text class="val-label" x="${x + bw / 2}" y="${yy - 4}">${d.value % 1 ? d.value.toFixed(1) : d.value}</text>`;
    svg += `<text class="axis-label" x="${x + bw / 2}" y="${H - padB + 14}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  return svg + '</svg>';
}

function lineChart(points, unit) {
  // points: [{label, value}]
  if (points.length < 1) return '<div class="chart-empty">Ei vielä dataa tälle liikkeelle.</div>';
  if (points.length === 1) return `<div class="chart-empty">${esc(points[0].label)}: <b>${points[0].value}${unit}</b> (tarvitaan vähintään 2 treeniä käyrää varten).</div>`;
  const W = 640, H = 220, padL = 34, padB = 30, padT = 16, padR = 12;
  const max = Math.max(...points.map(p => p.value)), min = Math.min(...points.map(p => p.value));
  const top = Math.ceil(max * 1.1), bottom = Math.max(0, Math.floor(min * 0.9));
  const span = (top - bottom) || 1;
  const x = i => padL + (W - padL - padR) * (points.length === 1 ? 0.5 : i / (points.length - 1));
  const y = v => padT + (H - padT - padB) * (1 - (v - bottom) / span);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  for (let i = 0; i <= 4; i++) {
    const v = bottom + span * i / 4, yy = y(v);
    svg += `<line class="grid-line" x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}"/>`;
    svg += `<text class="axis-label" x="${padL - 5}" y="${yy + 3}" text-anchor="end">${Math.round(v)}</text>`;
  }
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  svg += `<path class="line-path" d="${path}"/>`;
  points.forEach((p, i) => {
    svg += `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5"><title>${esc(p.label)}: ${p.value}${unit}</title></circle>`;
    if (i === 0 || i === points.length - 1 || p.value === max)
      svg += `<text class="val-label" x="${x(i).toFixed(1)}" y="${(y(p.value) - 7).toFixed(1)}">${p.value}</text>`;
    if (i % Math.ceil(points.length / 6) === 0 || i === points.length - 1)
      svg += `<text class="axis-label" x="${x(i).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle">${esc(p.label)}</text>`;
  });
  return svg + '</svg>';
}

function renderRunChart() {
  const weeks = 8;
  const buckets = [];
  const now = isoWeekStart(new Date());
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(now); start.setDate(start.getDate() - i * 7);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    const km = state.runs
      .filter(r => { const d = new Date(r.date + 'T00:00:00'); return d >= start && d < end; })
      .reduce((s, r) => s + (r.distanceKm || 0), 0);
    buckets.push({ label: `${start.getDate()}.${start.getMonth() + 1}.`, value: Math.round(km * 10) / 10 });
  }
  $('#chartRuns').innerHTML = barChart(buckets, ' km');
}

function exerciseNames() {
  const set = new Set();
  state.workouts.forEach(w => (w.exercises || []).forEach(e => { if (e.name) set.add(e.name); }));
  return [...set].sort((a, b) => a.localeCompare(b, 'fi'));
}

function renderExerciseChart(name) {
  if (!name) { $('#chartExercise').innerHTML = '<div class="chart-empty">Ei treeniliikkeitä vielä.</div>'; return; }
  const points = state.workouts
    .filter(w => (w.exercises || []).some(e => e.name === name))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(w => {
      const sets = w.exercises.filter(e => e.name === name).flatMap(e => e.sets);
      const topWeight = Math.max(0, ...sets.map(s => parseFloat(s.weight) || 0));
      const d = new Date(w.date + 'T00:00:00');
      return { label: `${d.getDate()}.${d.getMonth() + 1}.`, value: Math.round(topWeight * 10) / 10 };
    })
    .filter(p => p.value > 0);
  $('#chartExercise').innerHTML = lineChart(points, ' kg');
}

function renderStats() {
  renderRunChart();
  const sel = $('#exSelect');
  const names = exerciseNames();
  const prev = sel.value;
  sel.innerHTML = names.length
    ? names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
    : '<option value="">— ei liikkeitä —</option>';
  if (names.includes(prev)) sel.value = prev;
  renderExerciseChart(sel.value);
}
$('#exSelect').addEventListener('change', e => renderExerciseChart(e.target.value));

/* ---------- Käynnistys ---------- */
renderMeds();
renderWorkouts();
renderRuns();
initReminderUI();
initSyncUI();
scheduleReminders();

if ('serviceWorker' in navigator) {
  // Auto-päivitys: kun uusi service worker ottaa ohjat, ladataan sivu kerran,
  // jottei kotivalikkoon asennettu sovellus jää vanhaan välimuistiin jumiin.
  let refreshing = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return; // ei uudelleenlatausta ensiasennuksessa
    refreshing = true;
    window.location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.update();
    setInterval(() => reg.update(), 60 * 60 * 1000); // tarkista päivitys tunnin välein
  }).catch(() => {});
}

// Näytä mahdollinen ohitettu muistutus + synkronoi kun SW on valmis.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(() => { checkMissedReminders(); syncPush(); syncPull(); }).catch(() => { checkMissedReminders(); syncPull(); });
} else {
  checkMissedReminders();
  syncPull();
}
