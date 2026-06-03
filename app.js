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
  selectedDate: todayISO()
};

function save(key) { DB.write(key, state[key]); }
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
        save('meds'); renderMeds();
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
        <span><b>${(w.exercises || []).length}</b> liikettä</span>
        <span><b>${totalSets}</b> sarjaa</span>
        ${w.notes ? `<span>📝 ${esc(w.notes.slice(0, 40))}${w.notes.length > 40 ? '…' : ''}</span>` : ''}
      </div>`;
    li.addEventListener('click', () => openWorkoutEditor(w));
    list.appendChild(li);
  });
}

function openWorkoutEditor(existing) {
  const w = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid(), date: state.selectedDate, name: '', notes: '', exercises: [{ name: '', sets: [{ weight: '', reps: '' }] }] };

  const form = document.createElement('div');
  form.innerHTML = `
    <div class="row two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <label>Päivämäärä<input type="date" id="wDate" value="${w.date}"></label>
      <label>Treenin nimi<input type="text" id="wName" placeholder="esim. Jalkapäivä" value="${esc(w.name)}"></label>
    </div>
    <div id="exWrap"></div>
    <button class="mini-btn" id="addEx" style="width:100%;margin:4px 0 14px;">+ Lisää liike</button>
    <label>Muistiinpanot<textarea id="wNotes" placeholder="Fiilis, kommentit…">${esc(w.notes)}</textarea></label>
    <div class="modal-actions">
      ${existing ? '<button class="btn danger" id="wDelete">Poista</button>' : ''}
      <button class="btn primary" id="wSave">Tallenna</button>
    </div>`;

  const exWrap = form.querySelector('#exWrap');

  function renderExercises() {
    exWrap.innerHTML = '';
    w.exercises.forEach((ex, ei) => {
      const block = document.createElement('div');
      block.className = 'exercise';
      block.innerHTML = `
        <div class="ex-name-row">
          <input type="text" placeholder="Liike (esim. Penkkipunnerrus)" value="${esc(ex.name)}" data-ei="${ei}" class="ex-name">
          <button class="mini-btn ex-del" data-ei="${ei}" title="Poista liike">🗑</button>
        </div>
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
  });
  form.querySelector('#addEx').addEventListener('click', () => { w.exercises.push({ name: '', sets: [{ weight: '', reps: '' }] }); renderExercises(); });

  form.querySelector('#wSave').addEventListener('click', () => {
    w.date = form.querySelector('#wDate').value || todayISO();
    w.name = form.querySelector('#wName').value.trim();
    w.notes = form.querySelector('#wNotes').value.trim();
    w.exercises = w.exercises
      .map(ex => ({ name: ex.name.trim(), sets: ex.sets.filter(s => s.weight !== '' || s.reps !== '') }))
      .filter(ex => ex.name || ex.sets.length);
    const idx = state.workouts.findIndex(x => x.id === w.id);
    if (idx >= 0) state.workouts[idx] = w; else state.workouts.push(w);
    save('workouts'); renderWorkouts(); closeModal(); toast('Treeni tallennettu');
  });
  if (existing) form.querySelector('#wDelete').addEventListener('click', () => {
    if (confirm('Poistetaanko treeni?')) {
      state.workouts = state.workouts.filter(x => x.id !== w.id);
      save('workouts'); renderWorkouts(); closeModal();
    }
  });

  renderExercises();
  openModal(existing ? 'Muokkaa treeniä' : 'Uusi treeni', form);
}

$('#addWorkoutBtn').addEventListener('click', () => openWorkoutEditor(null));

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

/* ---------- Käynnistys ---------- */
renderMeds();
renderWorkouts();
renderRuns();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
