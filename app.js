/* ════════════════════════════════════════════════════════════════════════════
 *  IN-SPACe 2026 — Team 003 GCS controller (gcs.html)
 *  Web Serial <-> Teensy ground station (inspace_ground_modular), commands,
 *  CSV export, Firebase live upload. Rendering lives in core.js.
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const { $, S, BY_TAG, mlog } = GCS;

// ───────────────────────────── ingest pipeline ──────────────────────────────
let rateCnt = 0;
const stationOf = (tag) => BY_TAG[tag];

function handleLine(line) {
  const ev = GCS.parseGroundLine(line);
  if (!ev) return;
  switch (ev.kind) {
    case 'tlm': {
      const cfg = stationOf(ev.tag); if (!cfg) return;
      const fresh = GCS.ingest(cfg.id, ev.pkt, ev.rssi, ev.snr);
      rateCnt++;
      if ($('chk-raw').checked) mlog(`${ev.tag} ${ev.pkt.raw}`, 'log-data');
      if (!ev.pkt.ckOk) mlog(`${cfg.title}: checksum mismatch on packet ${ev.pkt.n}`, 'log-err');
      if (fresh) { fbPacket(cfg, ev.pkt, ev.rssi, ev.snr); legWatch(cfg, ev.pkt); }
      break;
    }
    case 'lnk': {
      const cfg = stationOf(ev.tag); if (cfg) S[cfg.id].gs = ev;
      lastLinks[ev.tag] = { online:ev.online, ch:ev.ch, good:ev.good, bad:ev.bad, dropped:ev.dropped,
        rssi:Number.isFinite(ev.rssi) ? ev.rssi : 0, snr:Number.isFinite(ev.snr) ? ev.snr : 0 };
      break;
    }
    case 'bad': {
      const cfg = stationOf(ev.tag); if (cfg) { S[cfg.id].bad++; S[cfg.id].dirty = true; }
      mlog(`${ev.tag}: checksum failure`, 'log-err');
      break;
    }
    case 'rx': mlog(`${ev.tag ? ev.tag + ' ← ' : ''}${ev.text}`, ev.cls); break;
    default: mlog(ev.text, ev.cls);
  }
}
setInterval(() => { $('cmd-pkt-rate').textContent = `${rateCnt} pkt/s`; rateCnt = 0; }, 1000);

// ─────────────────────────────── Web Serial ─────────────────────────────────
let port = null, reader = null, reading = false;
function setConn(on, label) {
  const b = $('connection-badge');
  b.classList.toggle('connected', on);
  b.querySelector('.dot').classList.toggle('online', on);
  b.querySelector('span:last-child').textContent = label || (on ? 'CONNECTED' : 'DISCONNECTED');
  $('btn-connect').textContent = on && port ? 'Disconnect' : 'Connect GCS';
}

async function connect() {
  if (!('serial' in navigator)) {
    mlog('Web Serial is not available in this browser. Use Chrome or Edge on a laptop (http://localhost or https).', 'log-err');
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200, bufferSize: 65536 });
  } catch (e) { port = null; mlog(`Serial: ${e.message}`, 'log-warn'); return; }
  if (sim.running()) stopDemo();
  setConn(true, 'USB CONNECTED');
  mlog('Ground station connected (USB 115200)', 'log-ok');
  reading = true; readLoop();
}

async function readLoop() {
  const dec = new TextDecoder(); let buf = '';
  while (port && port.readable && reading) {
    reader = port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
        if (buf.length > 8192) buf = '';
      }
    } catch (e) { mlog(`Serial read stopped: ${e.message}`, 'log-err'); break; }
    finally { reader.releaseLock(); }
  }
  if (reading) disconnect();
}

async function disconnect() {
  reading = false;
  try { if (reader) await reader.cancel(); } catch (e) { /* closed */ }
  try { if (port) await port.close(); } catch (e) { /* closed */ }
  port = null; setConn(false); mlog('Ground station disconnected', 'log-warn');
}
navigator.serial && navigator.serial.addEventListener('disconnect', (e) => { if (port && e.target === port) disconnect(); });

async function writeLine(text) {
  if (sim.running()) { simAck(text); return true; }
  if (!port || !port.writable) { $('cmd-log').textContent = 'NOT CONNECTED'; mlog(`Not sent (no ground station): ${text}`, 'log-err'); return false; }
  const w = port.writable.getWriter();
  try { await w.write(new TextEncoder().encode(text + '\n')); } finally { w.releaseLock(); }
  return true;
}

// ──────────────────────────────── commands ──────────────────────────────────
// Ground station prefixes: CAN:<cmd> -> CanSat XBee, PAY:<cmd> -> payload (LoRa+XBee), ALL:<cmd>
let target = 'PAY';
const tgtName = { PAY:'PAYLOAD', CAN:'CANSAT', ALL:'BOTH' };
async function sendCmd(cmd, tgt = target) {
  const line = `${tgt}:${cmd}`;
  if (await writeLine(line)) { $('cmd-log').textContent = `TX → ${tgtName[tgt]}: CMD,003,${cmd}`; mlog(`CMD → ${tgtName[tgt]}: CMD,003,${cmd}`, 'log-cmd'); }
}
async function sendLocal(cmd) {
  if (await writeLine(cmd)) { $('cmd-log').textContent = `GS: ${cmd}`; mlog(`GS ← ${cmd}`, 'log-cmd'); }
}

document.querySelectorAll('#cmd-seg [data-t]').forEach(b => b.addEventListener('click', () => {
  target = b.dataset.t;
  document.querySelectorAll('#cmd-seg [data-t]').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('[data-pay]').forEach(x => { x.disabled = target === 'CAN'; });
  $('cmd-target').value = target;
}));
document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.confirm && !confirm(`${b.dataset.confirm}\nTarget: ${tgtName[target]}`)) return;
  sendCmd(b.dataset.cmd);
}));
document.querySelectorAll('[data-local]').forEach(b => b.addEventListener('click', () => sendLocal(b.dataset.local)));

function sendConsole() {
  const v = $('cmd-input').value.trim(); if (!v) return;
  const t = $('cmd-target').value;
  if (t === 'GS') sendLocal(v);
  else if (/^(CAN|PAY|ALL):/i.test(v)) writeLine(v).then(ok => ok && mlog(`CMD ${v}`, 'log-cmd'));
  else sendCmd(v.replace(/^CMD,003,/i, ''), t);
  $('cmd-input').value = '';
}
$('btn-send-cmd').addEventListener('click', sendConsole);
$('cmd-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendConsole(); });
$('btn-clear-console').addEventListener('click', () => { $('console-output').innerHTML = ''; });

// Automatic leg-deployment test on the selected vehicle
let legTest = null;
function legWatch(cfg, pkt) { if (legTest && legTest.watch && legTest.vehicle === cfg.vehicle && pkt.sw) legTest.closed = true; }
$('btn-legtest').addEventListener('click', async () => {
  if (legTest) { legTest = null; mlog('Leg test cancelled', 'log-warn'); $('btn-legtest').textContent = 'AUTO TEST'; return; }
  const tgt = target === 'ALL' ? 'CAN' : target;
  legTest = { vehicle: tgt === 'CAN' ? 'CANSAT' : 'PAYLOAD', closed: false, watch: false };
  $('btn-legtest').textContent = 'CANCEL';
  mlog(`Leg test on ${legTest.vehicle} started`, 'log-warn');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (const [c, ms] of [['CX,ON', 1500], ['MODE,TEST', 1500], ['ACT,DEPLOY', 3500], ['ACT,STOW', 2000], ['MODE,FLIGHT', 300]]) {
    if (!legTest) return;
    legTest.watch = c === 'ACT,DEPLOY' ? true : c === 'ACT,STOW' ? false : legTest.watch;
    await sendCmd(c, tgt); await wait(ms);
  }
  if (!legTest) return;
  mlog(`Leg test ${legTest.vehicle}: ${legTest.closed ? 'PASS, leg switch closed after DEPLOY' : 'FAIL, leg switch never closed'}`, legTest.closed ? 'log-ok' : 'log-err');
  legTest = null; $('btn-legtest').textContent = 'AUTO TEST';
});

// ──────────────────────────────── demo mode ─────────────────────────────────
const sim = new GCS.Simulator(handleLine);
function startDemo() {
  if (port) { mlog('Disconnect the ground station before running the demo', 'log-warn'); return; }
  for (const id in S) GCS.resetStation(S[id]);
  sim.start(); setConn(true, 'DEMO');
  $('btn-demo').textContent = 'STOP DEMO';
  mlog('════════ DEMO FLIGHT: CanSat + Payload, all 3 links ════════', 'log-warn');
}
function stopDemo() { sim.stop(); setConn(false); $('btn-demo').textContent = 'DEMO'; mlog('Demo stopped', 'log-info'); }
function simAck(text) {
  const m = text.match(/^(CAN|PAY|ALL):(.*)$/i);
  mlog(`(demo) ${text}`, 'log-cmd');
  if (!m) return;
  const cmd = m[2].replace(/^CMD,003,/i, '').split(',')[0];
  setTimeout(() => handleLine(`RX,${m[1].toUpperCase() === 'CAN' ? 'CX' : 'PL'},0,0.0,ACK,003,${cmd},OK`), 300);
}
$('btn-demo').addEventListener('click', () => (sim.running() ? stopDemo() : startDemo()));
document.addEventListener('keydown', e => { if (e.shiftKey && e.key.toLowerCase() === 'd' && document.activeElement.tagName !== 'INPUT') sim.running() ? stopDemo() : startDemo(); });

$('btn-connect').addEventListener('click', () => (port ? disconnect() : connect()));
$('btn-csv').addEventListener('click', GCS.exportCSV);

// ──────────────────────────────── firebase ──────────────────────────────────
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
             set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private */ } } };
let fb = null;               // { app, db, root, missionId, sent, errors, connected }
const lastLinks = {};

function fbBadge() {
  const b = $('firebase-badge');
  if (!fb) { b.textContent = '🔥 FIREBASE OFF'; b.classList.remove('connected', 'warn'); return; }
  b.classList.toggle('connected', fb.connected);
  b.classList.toggle('warn', !fb.connected);
  b.textContent = fb.connected ? `🔥 LIVE · ${fb.sent} SENT` : '🔥 RECONNECTING';
  b.title = fb.lastError ? `Last error: ${fb.lastError}` : `Uploading to ${fb.root}/missions/${fb.missionId}`;
}

function fbPacket(cfg, pkt, rssi, snr) {
  if (!fb) return;
  const rec = GCS.toRecord(pkt, rssi, snr);
  const ts = firebase.database.ServerValue.TIMESTAMP;
  const key = fb.db.ref(`${fb.root}/missions/${fb.missionId}/${cfg.key}`).push().key;
  const upd = {};
  upd[`missions/${fb.missionId}/${cfg.key}/${key}`] = { ...rec, at: ts };
  upd[`live/${cfg.key}`] = { ...rec, at: ts };
  upd['meta/updatedAt'] = ts;
  fb.db.ref(fb.root).update(upd)
    .then(() => { fb && fb.sent++; fbBadge(); })
    .catch(e => { if (!fb) return; fb.errors++; fb.lastError = e.message; fbBadge(); if (fb.errors < 4) mlog(`Firebase write failed: ${e.message}`, 'log-err'); });
}
setInterval(() => { if (fb && Object.keys(lastLinks).length) fb.db.ref(`${fb.root}/live/links`).set(lastLinks).catch(() => {}); }, 5000);

function fbStatus(msg, cls = '') { const s = $('fb-status'); s.textContent = msg; s.className = 'dlg-status ' + cls; }

async function fbStart() {
  let cfg;
  try { cfg = GCS.parseFirebaseConfig($('fb-config').value); } catch (e) { fbStatus(e.message, 'err'); return false; }
  const root = ($('fb-root').value.trim() || 'gcs/003').replace(/^\/+|\/+$/g, '');
  const missionId = ($('fb-mission').value.trim() || new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')).replace(/[.#$\[\]/]/g, '_');
  ls.set('fb.config', $('fb-config').value); ls.set('fb.root', root); ls.set('fb.email', $('fb-email').value.trim());
  fbStatus('Connecting…');
  try {
    await fbStop(true);
    const app = GCS.firebaseApp(cfg);
    if ($('fb-email').value.trim()) await app.auth().signInWithEmailAndPassword($('fb-email').value.trim(), $('fb-pass').value);
    const db = app.database();
    const state = { app, db, root, missionId, sent: 0, errors: 0, connected: false, lastError: '' };
    db.ref('.info/connected').on('value', s => { state.connected = !!s.val(); fbBadge(); });
    await db.ref(`${root}/meta`).set({ missionId, team: GCS.TEAM_ID, startedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedAt: firebase.database.ServerValue.TIMESTAMP });
    fb = state; fbBadge();
    fbStatus(`Uploading to ${root}/missions/${missionId}. Viewers switch to this mission automatically.`, 'ok');
    mlog(`Firebase upload started → ${root}/missions/${missionId}`, 'log-ok');
    return true;
  } catch (e) {
    fbStatus(`Could not start: ${e.code || ''} ${e.message}`, 'err');
    mlog(`Firebase: ${e.message}`, 'log-err');
    return false;
  }
}
async function fbStop(silent) {
  if (!fb) return;
  const app = fb.app; fb = null; fbBadge();
  try { await app.delete(); } catch (e) { /* ignore */ }
  if (!silent) { fbStatus('Upload stopped.'); mlog('Firebase upload stopped', 'log-warn'); }
}

const defaultCfg = window.FIREBASE_CONFIG ? 'const firebaseConfig = ' + JSON.stringify(window.FIREBASE_CONFIG, null, 2) + ';' : '';
$('fb-config').value = ls.get('fb.config') || defaultCfg;
$('fb-root').value = ls.get('fb.root') || window.FIREBASE_ROOT || 'gcs/003';
$('fb-email').value = ls.get('fb.email') || '';
$('fb-auto').checked = ls.get('fb.auto') === '1';
$('fb-auto').addEventListener('change', () => ls.set('fb.auto', $('fb-auto').checked ? '1' : '0'));
$('firebase-badge').addEventListener('click', () => $('fb-dialog').showModal());
$('fb-start').addEventListener('click', fbStart);
$('fb-stop').addEventListener('click', () => fbStop(false));

// ─────────────────────────────────── init ───────────────────────────────────
GCS.initPages();
GCS.startRenderLoop();
mlog('IN-SPACe 2026 GCS — Team 003 · Payload (LoRa + XBee) · CanSat (XBee) · Firebase', 'log-ok');
mlog('Connect GCS = Teensy ground station over USB (Chrome/Edge). DEMO or Shift+D = simulated flight.', 'log-info');
mlog('Commands go to the TARGET selected in the command bar; ground station adds CMD,003, and routes them.', 'log-info');
if (!('serial' in navigator)) mlog('This browser has no Web Serial: live USB link unavailable here (index.html viewer works anywhere).', 'log-warn');
if (typeof firebase === 'undefined') mlog('Firebase SDK not loaded (offline?): upload disabled', 'log-warn');
else if ($('fb-auto').checked) fbStart();
})();
