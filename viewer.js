/* ════════════════════════════════════════════════════════════════════════════
 *  IN-SPACe 2026 — Team 003 view-only dashboard (index.html)
 *  Follows the mission the GCS is uploading: <root>/meta.missionId, then
 *  streams <root>/missions/<id>/<station> (last 900 packets + new ones).
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const { $, S, STATIONS, BY_KEY, mlog } = GCS;
const ROOT = (window.FIREBASE_ROOT || 'gcs/003').replace(/^\/+|\/+$/g, '');

let offset = 0, connected = false, missionId = null, lastAt = 0;
const subs = [];
const serverNow = () => Date.now() + offset;

function setBadge(text, on) {
  const b = $('connection-badge');
  b.classList.toggle('connected', on);
  b.querySelector('.dot').classList.toggle('online', on);
  b.querySelector('span:last-child').textContent = text;
}

function status() {
  const age = lastAt ? serverNow() - lastAt : Infinity;
  if (!connected) setBadge('OFFLINE', false);
  else if (age < 5000) setBadge('LIVE', true);
  else if (lastAt) setBadge(age < 60000 ? `LAST ${Math.round(age / 1000)} s AGO` : `LAST ${Math.round(age / 60000)} min AGO`, false);
  else setBadge('WAITING', false);
}
setInterval(status, 1000);

function follow(db, id) {
  subs.forEach(off => off()); subs.length = 0;
  missionId = id; lastAt = 0;
  for (const c of STATIONS) GCS.resetStation(S[c.id]);
  $('mission-bar').textContent = `Mission ${id}`;
  mlog(`Following mission ${id}`, 'log-ok');
  for (const c of STATIONS) {
    const ref = db.ref(`${ROOT}/missions/${id}/${c.key}`).limitToLast(900);
    const cb = ref.on('child_added', snap => {
      const r = snap.val(); if (!r) return;
      const at = typeof r.at === 'number' ? r.at : serverNow();
      GCS.ingest(c.id, GCS.fromRecord(r), r.rssi, r.snr, at);
      if (at > lastAt) lastAt = at;
    }, err => mlog(`${c.title}: ${err.message}`, 'log-err'));
    subs.push(() => ref.off('child_added', cb));
  }
}

function start() {
  GCS.initPages();
  GCS.startRenderLoop(serverNow);
  if (typeof firebase === 'undefined') { mlog('Could not load Firebase (offline?)', 'log-err'); setBadge('OFFLINE', false); return; }
  if (!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.databaseURL) {
    mlog('firebase-config.js has no databaseURL: fill it in and redeploy', 'log-err'); setBadge('NOT CONFIGURED', false); return;
  }
  const app = firebase.initializeApp(window.FIREBASE_CONFIG);
  const db = app.database();
  db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
  db.ref('.info/connected').on('value', s => {
    connected = !!s.val();
    const b = $('firebase-badge');
    b.textContent = connected ? '🔥 FIREBASE CONNECTED' : '🔥 FIREBASE OFFLINE';
    b.classList.toggle('connected', connected);
    status();
  });
  db.ref(`${ROOT}/meta`).on('value', s => {
    const m = s.val();
    if (m && m.updatedAt && m.updatedAt > lastAt) lastAt = m.updatedAt;
    if (m && m.missionId && m.missionId !== missionId) follow(db, m.missionId);
  }, err => { mlog(`Database: ${err.message}`, 'log-err'); setBadge('NO ACCESS', false); });
  db.ref(`${ROOT}/live/links`).on('value', s => {
    const links = s.val() || {};
    for (const [tag, v] of Object.entries(links)) { const c = GCS.BY_TAG[tag]; if (c) S[c.id].gs = v; }
  });
  mlog('Team 003 live viewer: read-only', 'log-ok');
}

document.addEventListener('DOMContentLoaded', start);
})();
