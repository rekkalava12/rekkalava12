'use strict';

/* Kevyt Web Push -palvelin Terveyspäiväkirjan lääkemuistutuksille.
   - Tallentaa selainten push-tilaukset + muistutusajat tiedostoon (data.json).
   - Lähettää muistutuksen aamulla/illalla, vaikka sovellus olisi suljettu.
   - Ajastus: sisäinen ajastin (1 min) JA /api/tick-päätepiste ulkoiselle cronille
     (esim. cron-job.org), jotta toimii myös "nukkuvilla" ilmaishosteilla. */

const express = require('express');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const TICK_SECRET = process.env.TICK_SECRET || '';
const WINDOW_MIN = 15; // kuinka monta minuuttia muistutusajan jälkeen lähetys vielä sallitaan

/* ---- VAPID-avaimet ---- */
let publicKey = process.env.VAPID_PUBLIC_KEY;
let privateKey = process.env.VAPID_PRIVATE_KEY;
if (!publicKey || !privateKey) {
  const keys = webpush.generateVAPIDKeys();
  publicKey = keys.publicKey;
  privateKey = keys.privateKey;
  console.log('\n⚠️  VAPID-avaimia ei ollut ympäristömuuttujissa – generoitiin väliaikaiset.');
  console.log('    Aseta nämä pysyviksi ympäristömuuttujiksi (muuten tilaukset katkeavat uudelleenkäynnistyksessä):');
  console.log('    VAPID_PUBLIC_KEY=' + publicKey);
  console.log('    VAPID_PRIVATE_KEY=' + privateKey + '\n');
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:terveys@example.com', publicKey, privateKey);

/* ---- Tallennus (yksinkertainen JSON-tiedosto) ---- */
function load() {
  let d;
  try { d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { d = {}; }
  if (!d.subs) d.subs = {};
  if (!d.sync) d.sync = {};
  return d;
}
function store() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
  catch (e) { console.error('Tallennus epäonnistui:', e.message); }
}
let db = load();

/* ---- HTTP ---- */
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (req, res) => res.type('text').send('Terveyspäiväkirja push-palvelin käynnissä.'));
app.get('/api/health', (req, res) => res.json({ ok: true, subs: Object.keys(db.subs).length }));
app.get('/api/vapidPublicKey', (req, res) => res.json({ key: publicKey }));

app.post('/api/subscribe', (req, res) => {
  const { subscription, settings } = req.body || {};
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'subscription puuttuu' });
  const prev = db.subs[subscription.endpoint];
  db.subs[subscription.endpoint] = { subscription, settings: settings || {}, sent: prev ? prev.sent : {} };
  store();
  res.json({ ok: true });
});

app.post('/api/unsubscribe', (req, res) => {
  const endpoint = (req.body && req.body.endpoint) || (req.body && req.body.subscription && req.body.subscription.endpoint);
  if (endpoint && db.subs[endpoint]) { delete db.subs[endpoint]; store(); }
  res.json({ ok: true });
});

// Lähetä testi-ilmoitus kaikkiin tämän tilauksen laitteisiin
app.post('/api/test', async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  const rec = endpoint && db.subs[endpoint];
  if (!rec) return res.status(404).json({ error: 'tuntematon tilaus' });
  try {
    await webpush.sendNotification(rec.subscription, JSON.stringify({ title: 'Testimuistutus 💊', body: 'Push-muistutukset toimivat!' }));
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: String(e && e.statusCode || e) }); }
});

/* ---- Synkronointi (laitteiden välillä) ----
   Koko datan tallennus synkronointikoodilla. Koodista lasketaan hash, jota
   käytetään avaimena (raakaa koodia ei tallenneta). */
function codeKey(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }

app.post('/api/sync/pull', (req, res) => {
  const code = req.body && req.body.code;
  if (!code || String(code).length < 4) return res.status(400).json({ error: 'koodi puuttuu (väh. 4 merkkiä)' });
  const rec = db.sync[codeKey(code)];
  res.json({ data: rec ? rec.data : null, updatedAt: rec ? rec.updatedAt : 0 });
});

app.post('/api/sync/push', (req, res) => {
  const { code, data, updatedAt } = req.body || {};
  if (!code || String(code).length < 4) return res.status(400).json({ error: 'koodi puuttuu (väh. 4 merkkiä)' });
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data puuttuu' });
  db.sync[codeKey(code)] = { data, updatedAt: updatedAt || Date.now() };
  store();
  res.json({ ok: true });
});

app.post('/api/tick', (req, res) => {
  if (TICK_SECRET && req.query.secret !== TICK_SECRET) return res.status(403).json({ error: 'forbidden' });
  runTick().then(n => res.json({ ok: true, sent: n })).catch(e => res.status(500).json({ error: String(e) }));
});

/* ---- Ajastuslogiikka ---- */
function inTz(fmtOpts, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { ...fmtOpts, timeZone: tz || 'UTC' }).format(new Date()); }
  catch { return new Intl.DateTimeFormat('en-CA', fmtOpts).format(new Date()); }
}
function nowMinutes(tz) {
  const hm = inTz({ hour: '2-digit', minute: '2-digit', hour12: false }, tz); // "HH:MM"
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}
function todayStr(tz) { return inTz({ year: 'numeric', month: '2-digit', day: '2-digit' }, tz); } // YYYY-MM-DD
function toMinutes(hhmm) { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; }

const SLOTS = [
  ['morning', 'remMorning', 'Aamulääkkeet 🌅'],
  ['evening', 'remEvening', 'Iltalääkkeet 🌙']
];

async function runTick() {
  let changed = false, sentCount = 0;
  for (const endpoint of Object.keys(db.subs)) {
    const rec = db.subs[endpoint];
    const s = rec.settings || {};
    if (!s.remEnabled) continue;
    const tz = s.tz;
    const cur = nowMinutes(tz);
    const day = todayStr(tz);

    // Siivoa eilisten merkinnät
    for (const k of Object.keys(rec.sent)) {
      if (!k.startsWith(day)) { delete rec.sent[k]; changed = true; }
    }

    for (const [slot, field, title] of SLOTS) {
      const time = s[field];
      if (!time) continue;
      const t = toMinutes(time);
      const due = cur >= t && cur < t + WINDOW_MIN;
      const key = day + '_' + slot;
      if (!due || rec.sent[key]) continue;

      const names = (s.meds && s.meds[slot]) || [];
      const body = names.length ? 'Muista ottaa: ' + names.join(', ') : 'Muista ottaa lääkkeet.';
      try {
        await webpush.sendNotification(rec.subscription, JSON.stringify({ title, body }));
        rec.sent[key] = true; changed = true; sentCount++;
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) { delete db.subs[endpoint]; changed = true; break; } // tilaus vanhentunut
        else console.error('Lähetys epäonnistui:', code || err.message);
      }
    }
  }
  if (changed) store();
  return sentCount;
}

setInterval(() => runTick().catch(e => console.error('tick-virhe:', e.message)), 60 * 1000);

app.listen(PORT, () => console.log('Push-palvelin kuuntelee portissa ' + PORT));
