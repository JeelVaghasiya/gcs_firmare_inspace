/* ════════════════════════════════════════════════════════════════════════════
 *  IN-SPACe 2026 — Team 003 GCS core (shared by index.html and viewer.html)
 *
 *  Three stations, one per radio link of the Team 003 ground station:
 *    pl  Payload over LoRa 868   (ground line tag PL)
 *    px  Payload over XBee 2.4   (ground line tag PX)
 *    cx  CanSat  over XBee 2.4   (ground line tag CX)
 *
 *  Each station page is generated from one template: metrics rows covering all
 *  29 telemetry fields, flight-state track, health flags, link quality, map,
 *  3D trajectory, 3D attitude, and 7 Plotly charts.
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const TEAM_ID = '2026-INSPACe-ROCKETRY-003';
const MAX_PTS = 1800;
const STATES = ['BOOT','TEST_MODE','LAUNCH_PAD','ASCENT','ROCKET_DEPLOY','DESCENT','AEROBREAK_RELEASE','IMPACT'];
const STATE_SHORT = { BOOT:'BOOT', TEST_MODE:'TEST', LAUNCH_PAD:'PAD', ASCENT:'ASCENT', ROCKET_DEPLOY:'SEPARATION',
  DESCENT:'DESCENT', AEROBREAK_RELEASE:'LEGS OUT', IMPACT:'LANDED' };
const FLAGS = [['IMU',0],['BARO',1],['INA',2],['GNSS',3],['FIX',4],['RTC',5],['SD',6],['LORA',7],['XBEE',8],
  ['CX',9],['SIM',10],['DEPLOYED',11],['LEGS LOCKED',12],['RESUMED',13],['RF CUTOFF',14],['LOW BATT',15]];
const PROBLEM_FLAGS = new Set(['RESUMED','RF CUTOFF','LOW BATT']);
const INFO_FLAGS = new Set(['SIM','DEPLOYED','LEGS LOCKED','CX']);

const STATIONS = [
  { id:'pl', tag:'PL', key:'payload_lora', vehicle:'PAYLOAD', title:'PAYLOAD · LoRa', tab:'📡 PAYLOAD (LoRa)',
    color:'#38bdf8', radio:'LoRa 868 MHz', lora:true, cansat:false },
  { id:'px', tag:'PX', key:'payload_xbee', vehicle:'PAYLOAD', title:'PAYLOAD · XBee', tab:'📶 PAYLOAD (XBee)',
    color:'#a855f7', radio:'XBee 2.4 GHz', lora:false, cansat:false },
  { id:'cx', tag:'CX', key:'cansat', vehicle:'CANSAT', title:'CANSAT · XBee', tab:'🛰 CANSAT (XBee)',
    color:'#f59e0b', radio:'XBee 2.4 GHz', lora:false, cansat:true },
];
const BY_TAG = Object.fromEntries(STATIONS.map(s => [s.tag, s]));
const BY_KEY = Object.fromEntries(STATIONS.map(s => [s.key, s]));

const $ = (id) => document.getElementById(id);
const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '--');
const sgn = (v, d = 1) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(d) : '--');

// ───────────────────────────────── logging ──────────────────────────────────
function mlog(m, c = 'log-info') {
  const con = $('console-output'); if (!con) return;
  const stick = con.scrollHeight - con.scrollTop - con.clientHeight < 40;
  const d = document.createElement('div'); d.className = c;
  d.textContent = `[${new Date().toLocaleTimeString('en-GB')}] ${m}`;
  con.appendChild(d);
  while (con.children.length > 600) con.removeChild(con.firstChild);
  if (stick) con.scrollTop = con.scrollHeight;
}

// ───────────────────────────────── parsing ──────────────────────────────────
function xor(s) { let c = 0; for (let i = 0; i < s.length; i++) c ^= s.charCodeAt(i); return c; }

// 29-field Team 003 packet -> object
function parsePacket(line) {
  const f = line.split(',');
  if (f.length < 29 || f[0].indexOf('INSPACe') < 0) return null;
  const ck = parseInt(f[28], 16);
  const n = (i) => { const v = parseFloat(f[i]); return Number.isFinite(v) ? v : 0; };
  return {
    team: f[0], t: n(1), n: parseInt(f[2], 10) || 0, alt: n(3), press: n(4), temp: n(5), volt: n(6),
    gt: f[7], lat: n(8), lon: n(9), galt: n(10), sats: parseInt(f[11], 10) || 0,
    ax: n(12), ay: n(13), az: n(14), roll: n(15), pitch: n(16), gw: n(17), st: (f[18] || '').trim(),
    vz: n(19), cur: n(20), spin: n(21), cpm: parseInt(f[22], 10) || 0, sw: parseInt(f[23], 10) || 0,
    links: f[24], chans: f[25], cmd: f[26], flags: parseInt(f[27], 16) || 0,
    ckOk: Number.isFinite(ck) && xor(line.slice(0, line.lastIndexOf(','))) === ck, raw: line,
  };
}

// One USB line from the ground station (see inspace_ground_modular/PacketProcessor.h)
function parseGroundLine(line) {
  line = line.trim(); if (!line) return null;
  let m;
  if (line.startsWith('TLM,')) {
    const p = line.split(',');
    const pkt = parsePacket(p.slice(4).join(','));
    return pkt ? { kind:'tlm', tag:p[1], rssi:parseFloat(p[2]), snr:parseFloat(p[3]), pkt }
               : { kind:'text', cls:'log-warn', text:line };
  }
  if (line.startsWith('LNK,')) {
    const p = line.split(',');
    return { kind:'lnk', tag:p[1], online:p[2] === '1', ch:p[3], good:+p[4], bad:+p[5], dropped:+p[6],
             age:+p[7], rssi:parseFloat(p[8]), snr:parseFloat(p[9]) };
  }
  if ((m = line.match(/^RX,(\w+),([-\d.]+),([-\d.]+),(.*)$/))) {
    const t = m[4];
    return { kind:'rx', tag:m[1], text:t,
             cls: /^ACK,.*,ERR/.test(t) ? 'log-err' : /^ACK,/.test(t) ? 'log-ok' : t.startsWith('#') ? 'log-warn' : 'log-info' };
  }
  if (line.startsWith('BAD,')) return { kind:'bad', tag:line.split(',')[1], text:line };
  if (line.startsWith('[UPLINK')) return { kind:'text', cls:'log-cmd', text:line };
  const pkt = parsePacket(line);                    // untagged packet (vehicle on USB / old GS firmware)
  if (pkt) return { kind:'tlm', tag: /^L1/.test(pkt.links) ? 'PX' : 'CX', rssi:NaN, snr:NaN, pkt, untagged:true };
  if (line.startsWith('ACK,')) return { kind:'rx', tag:'', text:line, cls: line.endsWith('ERR') ? 'log-err' : 'log-ok' };
  return { kind:'text', cls: /fail|error|warn/i.test(line) ? 'log-warn' : 'log-info', text:line };
}

// Compact record for Firebase  <->  packet
const REC = ['t','n','alt','press','temp','volt','gt','lat','lon','galt','sats','ax','ay','az','roll','pitch','gw',
  'st','vz','cur','spin','cpm','sw','links','chans','cmd','flags'];
function toRecord(pkt, rssi, snr) {
  const r = {}; for (const k of REC) r[k] = pkt[k];
  if (Number.isFinite(rssi) && rssi !== 0) r.rssi = rssi;
  if (Number.isFinite(snr) && snr !== 0) r.snr = snr;
  return r;
}
function fromRecord(r) {
  const p = {}; for (const k of REC) p[k] = r[k];
  p.flags = r.flags || 0; p.ckOk = true; p.team = TEAM_ID;
  p.raw = packetLine(p);
  return p;
}
function packetLine(p) {
  const body = [TEAM_ID, num(p.t,2), p.n, num(p.alt,1), num(p.press,0), num(p.temp,1), num(p.volt,2), p.gt || '00:00:00',
    num(p.lat,5), num(p.lon,5), num(p.galt,1), p.sats, num(p.ax,2), num(p.ay,2), num(p.az,2), num(p.roll,1), num(p.pitch,1),
    num(p.gw,1), p.st, num(p.vz,1), num(p.cur,3), num(p.spin,1), p.cpm, p.sw, p.links, p.chans, p.cmd,
    (p.flags >>> 0).toString(16).toUpperCase().padStart(4, '0')].join(',');
  return body + ',' + xor(body).toString(16).toUpperCase().padStart(2, '0');
}

// ───────────────────────────── station state ────────────────────────────────
function newData() {
  return { t:[], alt:[], vz:[], press:[], temp:[], volt:[], cur:[], ax:[], ay:[], az:[], roll:[], pitch:[], spin:[],
           ex:[], ny:[], tz:[], lat:[], lon:[] };
}
const S = {};
for (const cfg of STATIONS) {
  S[cfg.id] = { cfg, d:newData(), latest:null, maxAlt:0, maxVz:0, good:0, bad:0, dropped:0, lastN:-1, lastAt:0,
    rssi:NaN, snr:NaN, raw:[], origin:null, yaw:0, lastT:null, gs:null, rate:0, rateCnt:0, dirty:true,
    map:null, marker:null, poly:null, autoCenter:true, charts:false };
}
function resetStation(st) {
  Object.assign(st, { d:newData(), latest:null, maxAlt:0, maxVz:0, good:0, bad:0, dropped:0, lastN:-1, lastAt:0,
    raw:[], origin:null, yaw:0, lastT:null, dirty:true });
  if (st.poly) st.poly.setLatLngs([]);
}

// Returns true when stored (new packet for this link)
function ingest(id, pkt, rssi, snr, at = Date.now()) {
  const st = S[id];
  if (Number.isFinite(rssi)) st.rssi = rssi;
  if (Number.isFinite(snr)) st.snr = snr;
  if (!pkt.ckOk) { st.bad++; st.dirty = true; return false; }
  if (st.latest && pkt.n === st.lastN && Math.abs(pkt.t - st.latest.t) < 0.5) return false;
  if (st.latest && pkt.n + 3 < st.lastN && pkt.t + 5 < st.latest.t) {          // RESET / new mission
    mlog(`${st.cfg.title}: packet counter restarted, new data set`, 'log-warn');
    resetStation(st);
  }
  if (st.lastN >= 0 && pkt.n > st.lastN + 1 && pkt.n - st.lastN < 100000) st.dropped += pkt.n - st.lastN - 1;
  const prev = st.latest;
  st.lastN = pkt.n; st.good++; st.rateCnt++; st.lastAt = at;
  st.latest = pkt;
  if (prev && prev.st !== pkt.st) mlog(`${st.cfg.title}: ${prev.st} → ${pkt.st} at ${num(pkt.alt,1)} m`, 'log-warn');
  if (prev && prev.cmd !== pkt.cmd && pkt.cmd !== 'NONE') mlog(`${st.cfg.title}: command echo ${pkt.cmd}`, 'log-cmd');
  if (pkt.alt > st.maxAlt) st.maxAlt = pkt.alt;
  if (pkt.vz > st.maxVz) st.maxVz = pkt.vz;

  // Yaw for the 3D view: integrate Z spin rate (roll/pitch come from the onboard AHRS)
  if (st.lastT !== null) { const dt = pkt.t - st.lastT; if (dt > 0 && dt < 3) st.yaw += pkt.spin * dt; }
  st.lastT = pkt.t;

  const d = st.d, push = (a, v) => { a.push(v); if (a.length > MAX_PTS) a.shift(); };
  push(d.t, pkt.t); push(d.alt, pkt.alt); push(d.vz, pkt.vz); push(d.press, pkt.press); push(d.temp, pkt.temp);
  push(d.volt, pkt.volt); push(d.cur, pkt.cur * 1000); push(d.ax, pkt.ax); push(d.ay, pkt.ay); push(d.az, pkt.az);
  push(d.roll, pkt.roll); push(d.pitch, pkt.pitch); push(d.spin, pkt.spin);
  if (pkt.lat || pkt.lon) {
    if (!st.origin) { st.origin = [pkt.lat, pkt.lon]; mlog(`${st.cfg.title}: first fix ${pkt.lat.toFixed(6)}, ${pkt.lon.toFixed(6)}`, 'log-ok'); }
    push(d.lat, pkt.lat); push(d.lon, pkt.lon);
    push(d.ny, (pkt.lat - st.origin[0]) * 111320);
    push(d.ex, (pkt.lon - st.origin[1]) * 111320 * Math.cos(st.origin[0] * Math.PI / 180));
    push(d.tz, pkt.alt);
  }
  st.raw.push(pkt.raw); if (st.raw.length > 50000) st.raw.shift();
  st.dirty = true;
  return true;
}

// ───────────────────────────── page template ────────────────────────────────
function card(id, label, unit, cls = '') {
  return `<div class="metric-card ${cls}"><span class="metric-label">${label}</span><span class="metric-value" id="${id}">--</span><span class="metric-unit">${unit}</span></div>`;
}
function small(id, label, unit, cls = '') {
  return `<div class="metric-card ${cls}"><span class="metric-label">${label}</span><span class="metric-value small" id="${id}">--</span><span class="metric-unit">${unit}</span></div>`;
}

function buildPages(container, tabsEl) {
  tabsEl.innerHTML = STATIONS.map((c, i) =>
    `<button class="tab-btn${i === 0 ? ' active' : ''}" id="tab-${c.id}" data-tab="${c.id}" style="--st:${c.color}">
       <span class="tab-dot" id="${c.id}-tabdot"></span>${c.tab}</button>`).join('');
  container.innerHTML = STATIONS.map((c, i) => {
    const p = c.id;
    return `
  <main id="page-${p}" class="tab-page${i === 0 ? '' : ' hidden'}" style="--st:${c.color}">
    <div class="station-head">
      <h2>${c.title}</h2>
      <span class="station-sub">${c.radio}</span>
      <span class="card-badge" id="${p}-age">NO DATA</span>
      <span class="station-state" id="${p}-state">—</span>
    </div>

    <div class="state-track" id="${p}-track">
      ${STATES.slice(1).map(s => `<div class="st-step" data-st="${s}">${STATE_SHORT[s]}</div>`).join('')}
    </div>

    <div class="metrics-row">
      ${card(p + '-alt', 'ALTITUDE', 'm AGL', 'highlight')}
      ${card(p + '-maxalt', 'MAX ALT', 'm')}
      ${card(p + '-vz', 'VERT SPEED', 'm/s')}
      ${card(p + '-press', 'PRESSURE', 'Pa')}
      ${card(p + '-volt', 'VOLTAGE', 'V')}
      ${card(p + '-temp', 'TEMP', '°C')}
      ${card(p + '-pkts', 'PACKET #', 'count')}
    </div>

    <div class="metrics-row metrics-row-2">
      ${small(p + '-gt', 'GNSS TIME', 'UTC')}
      ${small(p + '-lat', 'LATITUDE', '°N')}
      ${small(p + '-lon', 'LONGITUDE', '°E')}
      ${small(p + '-galt', 'GNSS ALT', 'm MSL')}
      ${small(p + '-sats', 'SATS', 'tracked')}
      ${small(p + '-ax', 'ACCEL X', 'm/s²')}
      ${small(p + '-ay', 'ACCEL Y', 'm/s²')}
      ${small(p + '-az', 'ACCEL Z', 'm/s²')}
      ${small(p + '-amag', '|ACCEL|', 'g')}
      ${small(p + '-cur', 'CURRENT', 'mA')}
    </div>

    <div class="metrics-row metrics-row-2">
      ${small(p + '-met', 'MISSION TIME', 's')}
      ${small(p + '-roll', 'ROLL', '°')}
      ${small(p + '-pitch', 'PITCH', '°')}
      ${small(p + '-spin', 'SPIN RATE', '°/s')}
      ${small(p + '-sw', 'LEG SWITCH', 'J4')}
      ${c.cansat ? small(p + '-cpm', 'GEIGER', 'CPM') : small(p + '-gw', 'GYRO WHEEL', '°/s')}
      ${small(p + '-cmd', 'CMD ECHO', 'last')}
      ${small(p + '-links', 'LINKS', 'L / X')}
      ${small(p + '-chans', 'CHANNELS', 'M / B')}
      ${small(p + '-flags', 'FLAGS', 'hex')}
    </div>

    <div class="health-strip">
      <div class="flag-chips" id="${p}-flagchips"></div>
      <div class="link-stats">
        <span>GOOD <b id="${p}-good">0</b></span>
        <span>BAD CRC <b id="${p}-bad">0</b></span>
        <span>DROPPED <b id="${p}-drop">0</b></span>
        <span>PLR <b id="${p}-plr">0.0%</b></span>
        <span>RATE <b id="${p}-rate">0</b> pkt/s</span>
        ${c.lora ? `<span>RSSI <b id="${p}-rssi">--</b> dBm</span><span>SNR <b id="${p}-snr">--</b> dB</span>` : ''}
        <span>GS RADIO <b id="${p}-gs">--</b></span>
      </div>
    </div>

    <div class="main-content">
      <section class="column col-left">
        <div class="card card-map">
          <div class="card-header">
            <h2>📡 LIVE TRACKING</h2>
            <div class="hdr-tools">
              <button class="btn-secondary btn-mini active" id="${p}-auto">🎯 AUTO: ON</button>
              <span class="card-badge" id="${p}-gps">NO FIX</span>
            </div>
          </div>
          <div class="map" id="${p}-map"></div>
          <div class="map-foot" id="${p}-mapfoot">Waiting for GNSS fix</div>
        </div>
        <div class="card"><div class="card-header"><h2>🌐 3D TRAJECTORY (EAST / NORTH / ALT)</h2></div><div id="${p}-p3d" class="chart-container-3d"></div></div>
        <div class="card"><div class="card-header"><h2>${c.cansat ? '🛰' : '📦'} 3D ATTITUDE</h2><span class="card-badge fix" id="${p}-att">R 0° P 0°</span></div><div id="${p}-patt" class="chart-container-3d"></div></div>
      </section>
      <section class="column col-right">
        <div class="card"><div class="card-header"><h2>📈 ALTITUDE</h2></div><div id="${p}-palt" class="chart-container"></div></div>
        <div class="card"><div class="card-header"><h2>⚡ VERTICAL VELOCITY</h2></div><div id="${p}-pvz" class="chart-container"></div></div>
        <div class="card"><div class="card-header"><h2>💥 ACCELERATION</h2></div><div id="${p}-pacc" class="chart-container"></div></div>
        <div class="card"><div class="card-header"><h2>🔄 ATTITUDE &amp; SPIN</h2></div><div id="${p}-patti" class="chart-container"></div></div>
        <div class="card"><div class="card-header"><h2>🌡️ TEMPERATURE</h2></div><div id="${p}-ptemp" class="chart-container"></div></div>
        <div class="card"><div class="card-header"><h2>📊 PRESSURE</h2></div><div id="${p}-ppress" class="chart-container"></div></div>
        <div class="card"><div class="card-header"><h2>🔋 POWER</h2></div><div id="${p}-ppow" class="chart-container"></div></div>
      </section>
    </div>
  </main>`;
  }).join('');

  for (const c of STATIONS) {
    $(`${c.id}-flagchips`).innerHTML = FLAGS.filter(([n]) => !(c.cansat && n === 'LORA'))
      .map(([n]) => `<span class="flag" data-flag="${n}">${n}</span>`).join('');
    $(`${c.id}-auto`).addEventListener('click', () => {
      const st = S[c.id]; st.autoCenter = !st.autoCenter;
      const b = $(`${c.id}-auto`); b.textContent = st.autoCenter ? '🎯 AUTO: ON' : '🎯 AUTO: OFF';
      b.classList.toggle('active', st.autoCenter);
      if (st.autoCenter && st.latest && st.map) st.map.panTo([st.latest.lat, st.latest.lon]);
    });
  }
  tabsEl.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
}

// ───────────────────────────── maps & charts ────────────────────────────────
function initMap(st) {
  if (st.map || typeof L === 'undefined') return;
  const el = $(`${st.cfg.id}-map`);
  st.map = L.map(el, { zoomControl:true }).setView([13.0685, 77.5033], 15);
  const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution:'© CARTO © OSM', maxZoom:19 });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution:'© Esri', maxZoom:19 });
  dark.addTo(st.map);
  L.control.layers({ 'Dark': dark, 'Satellite': sat }, null, { position:'topright' }).addTo(st.map);
  st.poly = L.polyline([], { color:st.cfg.color, weight:2.5, opacity:.8 }).addTo(st.map);
  st.pad = L.circleMarker([0, 0], { radius:5, color:'#22c55e', fillColor:'#22c55e', fillOpacity:.9 });
  st.marker = L.circleMarker([0, 0], { radius:7, color:'#fff', weight:2, fillColor:st.cfg.color, fillOpacity:1 });
  st.map.on('dragstart', () => { if (st.autoCenter) $(`${st.cfg.id}-auto`).click(); });
}

const PL = { paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
  font:{ color:'#6b7280', size:10, family:'JetBrains Mono' }, margin:{ t:8, b:30, l:46, r:10 },
  xaxis:{ gridcolor:'rgba(56,189,248,0.06)', zeroline:false, title:{ text:'Mission time (s)', font:{ size:9 } } },
  yaxis:{ gridcolor:'rgba(56,189,248,0.06)', zeroline:false }, showlegend:false, hovermode:'x unified' };
const PC = { displayModeBar:true, responsive:true, scrollZoom:true, displaylogo:false,
  modeBarButtonsToRemove:['lasso2d','select2d'] };
const tr = (n, c, extra = {}) => ({ x:[], y:[], name:n, mode:'lines', line:{ color:c, width:1.6 }, ...extra });
const yax = (t) => ({ ...PL.yaxis, title:{ text:t, font:{ size:9 } } });
const LEG = { showlegend:true, legend:{ font:{ size:9 }, orientation:'h', x:1, xanchor:'right', y:1.12 } };

function meshFor(cansat) {
  // CanSat: plain cylinder with lid. Payload: cylinder + nose cone + 4 fins
  const h = cansat ? 2.4 : 3.2, r = cansat ? 0.9 : 0.45, n = 16, x = [], y = [], z = [], I = [], J = [], K = [];
  const z0 = -h / 2;
  for (let i = 0; i <= n; i++) { const a = i / n * 2 * Math.PI; x.push(r * Math.cos(a), r * Math.cos(a)); y.push(r * Math.sin(a), r * Math.sin(a)); z.push(z0, z0 + h); }
  for (let i = 0; i < n; i++) { const b = i * 2; I.push(b, b + 1); J.push(b + 1, b + 3); K.push(b + 2, b + 2); }
  const top = x.length; x.push(0); y.push(0); z.push(cansat ? z0 + h : z0 + h + 1.1);
  const bot = x.length; x.push(0); y.push(0); z.push(z0);
  for (let i = 0; i < n; i++) { I.push(i * 2 + 1, i * 2); J.push(((i + 1) % n) * 2 + 1, ((i + 1) % n) * 2); K.push(top, bot); }
  if (!cansat) for (let i = 0; i < 4; i++) {
    const a = i / 4 * 2 * Math.PI, b = x.length;
    x.push(r * Math.cos(a), 1.3 * Math.cos(a), r * Math.cos(a)); y.push(r * Math.sin(a), 1.3 * Math.sin(a), r * Math.sin(a)); z.push(z0, z0 - 0.3, z0 + 0.9);
    I.push(b); J.push(b + 1); K.push(b + 2);
  }
  return { x, y, z, i:I, j:J, k:K };
}

function initCharts(st) {
  if (st.charts || typeof Plotly === 'undefined') return;
  const p = st.cfg.id, c = st.cfg.color;
  Plotly.newPlot(`${p}-palt`, [tr('Altitude', c, { fill:'tozeroy', fillcolor:c + '14' })], { ...PL, yaxis:yax('m') }, PC);
  Plotly.newPlot(`${p}-pvz`, [tr('Vz', '#22c55e')], { ...PL, yaxis:{ ...yax('m/s'), zeroline:true, zerolinecolor:'rgba(255,255,255,.15)' } }, PC);
  Plotly.newPlot(`${p}-pacc`, [tr('X', '#ef4444'), tr('Y', '#22c55e'), tr('Z', '#38bdf8')], { ...PL, ...LEG, yaxis:yax('m/s²') }, PC);
  Plotly.newPlot(`${p}-patti`, [tr('Roll', '#ef4444'), tr('Pitch', '#22c55e'), tr('Spin °/s', '#a855f7', { yaxis:'y2', line:{ color:'#a855f7', width:1.2, dash:'dot' } })],
    { ...PL, ...LEG, yaxis:yax('deg'), yaxis2:{ overlaying:'y', side:'right', showgrid:false, title:{ text:'°/s', font:{ size:9 } } }, margin:{ ...PL.margin, r:42 } }, PC);
  Plotly.newPlot(`${p}-ptemp`, [tr('Temp', '#ef4444')], { ...PL, yaxis:yax('°C') }, PC);
  Plotly.newPlot(`${p}-ppress`, [tr('Pressure', '#ec4899')], { ...PL, yaxis:yax('Pa') }, PC);
  Plotly.newPlot(`${p}-ppow`, [tr('Voltage', '#22c55e'), tr('Current mA', '#f97316', { yaxis:'y2' })],
    { ...PL, ...LEG, yaxis:yax('V'), yaxis2:{ overlaying:'y', side:'right', showgrid:false, title:{ text:'mA', font:{ size:9 } } }, margin:{ ...PL.margin, r:46 } }, PC);
  const sceneAx = (t) => ({ title:t, gridcolor:'#1a2333', color:'#556', zerolinecolor:'#334' });
  Plotly.newPlot(`${p}-p3d`, [{ x:[], y:[], z:[], type:'scatter3d', mode:'lines', line:{ color:c, width:5 } },
    { x:[], y:[], z:[], type:'scatter3d', mode:'markers', marker:{ size:5, color:'#fff' } }],
    { paper_bgcolor:'rgba(0,0,0,0)', margin:{ t:0, b:0, l:0, r:0 }, showlegend:false, font:{ color:'#6b7280', size:9 },
      scene:{ xaxis:sceneAx('East (m)'), yaxis:sceneAx('North (m)'), zaxis:sceneAx('Alt (m)'), bgcolor:'rgba(0,0,0,0)', aspectmode:'manual', aspectratio:{ x:1, y:1, z:1.2 } } }, PC);
  st.mesh = meshFor(st.cfg.cansat);
  Plotly.newPlot(`${p}-patt`, [{ type:'mesh3d', ...st.mesh, color:c, opacity:.9, flatshading:true }],
    { paper_bgcolor:'rgba(0,0,0,0)', margin:{ t:0, b:0, l:0, r:0 },
      scene:{ xaxis:{ range:[-3, 3], ...sceneAx('') }, yaxis:{ range:[-3, 3], ...sceneAx('') }, zaxis:{ range:[-3, 3], ...sceneAx('') },
        bgcolor:'rgba(0,0,0,0)', aspectmode:'cube', camera:{ eye:{ x:1.6, y:1.6, z:0.9 } } } }, PC);
  st.charts = true;
}

function rotate(mesh, rollDeg, pitchDeg, yawDeg) {
  const r = rollDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180, y = yawDeg * Math.PI / 180;
  const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
  // R = Rz(yaw) * Ry(pitch) * Rx(roll)   (body -> world, Z up)
  const R = [[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
             [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
             [-sp, cp * sr, cp * cr]];
  const X = [], Y = [], Z = [];
  for (let i = 0; i < mesh.x.length; i++) {
    const a = mesh.x[i], b = mesh.y[i], c = mesh.z[i];
    X.push(R[0][0] * a + R[0][1] * b + R[0][2] * c);
    Y.push(R[1][0] * a + R[1][1] * b + R[1][2] * c);
    Z.push(R[2][0] * a + R[2][1] * b + R[2][2] * c);
  }
  return { X, Y, Z };
}

// ───────────────────────────────── render ───────────────────────────────────
let activeTab = 'pl';
function setText(id, v) { const e = $(id); if (e && e.textContent !== v) e.textContent = v; }
function ago(ms) { return !Number.isFinite(ms) ? 'NEVER' : ms < 1500 ? 'LIVE' : ms < 60000 ? `${Math.round(ms / 1000)} s AGO` : `${Math.round(ms / 60000)} min AGO`; }

function renderStation(st, now) {
  const p = st.cfg.id, d = st.latest;
  const age = st.lastAt ? now - st.lastAt : Infinity;
  const ageEl = $(`${p}-age`);
  if (ageEl) { ageEl.textContent = d ? ago(age) : 'NO DATA'; ageEl.className = 'card-badge' + (age < 3000 ? ' fix' : d ? ' warn' : ''); }
  const dot = $(`${p}-tabdot`); if (dot) dot.className = 'tab-dot' + (age < 3000 ? ' on' : d ? ' stale' : '');
  setText(`${p}-good`, String(st.good)); setText(`${p}-bad`, String(st.bad)); setText(`${p}-drop`, String(st.dropped));
  const exp = st.good + st.dropped; setText(`${p}-plr`, (exp ? 100 * st.dropped / exp : 0).toFixed(1) + '%');
  setText(`${p}-rate`, String(st.rate));
  if (st.cfg.lora) { setText(`${p}-rssi`, num(st.rssi, 0)); setText(`${p}-snr`, num(st.snr, 1)); }
  if (st.gs) setText(`${p}-gs`, `${st.gs.online ? 'ONLINE' : 'OFFLINE'} ${st.gs.ch === 'B' ? 'BACKUP' : 'MAIN'}`);
  if (!d || !st.dirty) return;
  st.dirty = false;

  setText(`${p}-alt`, num(d.alt, 1)); setText(`${p}-maxalt`, num(st.maxAlt, 1));
  setText(`${p}-vz`, sgn(d.vz, 1)); setText(`${p}-press`, num(d.press, 0)); setText(`${p}-volt`, num(d.volt, 2));
  setText(`${p}-temp`, num(d.temp, 1)); setText(`${p}-pkts`, String(d.n));
  const vzEl = $(`${p}-vz`); if (vzEl) vzEl.style.color = d.vz > 0.5 ? 'var(--green)' : d.vz < -0.5 ? 'var(--amber)' : '';
  const vEl = $(`${p}-volt`); if (vEl) vEl.style.color = (d.flags & 0x8000) ? 'var(--red)' : d.volt > 2 && d.volt < 7.2 ? 'var(--amber)' : '';
  setText(`${p}-gt`, d.gt || '--'); setText(`${p}-lat`, d.lat ? d.lat.toFixed(6) : '--'); setText(`${p}-lon`, d.lon ? d.lon.toFixed(6) : '--');
  setText(`${p}-galt`, d.lat ? num(d.galt, 1) : '--'); setText(`${p}-sats`, String(d.sats));
  setText(`${p}-ax`, sgn(d.ax, 2)); setText(`${p}-ay`, sgn(d.ay, 2)); setText(`${p}-az`, sgn(d.az, 2));
  setText(`${p}-amag`, num(Math.hypot(d.ax, d.ay, d.az) / 9.80665, 2)); setText(`${p}-cur`, num(d.cur * 1000, 0));
  setText(`${p}-met`, num(d.t, 1)); setText(`${p}-roll`, sgn(d.roll, 1)); setText(`${p}-pitch`, sgn(d.pitch, 1));
  setText(`${p}-spin`, sgn(d.spin, 1)); setText(`${p}-sw`, d.sw ? 'CLOSED' : 'OPEN');
  if (st.cfg.cansat) setText(`${p}-cpm`, String(d.cpm)); else setText(`${p}-gw`, num(d.gw, 1));
  setText(`${p}-cmd`, d.cmd || '--'); setText(`${p}-links`, d.links || '--'); setText(`${p}-chans`, d.chans || '--');
  setText(`${p}-flags`, (d.flags >>> 0).toString(16).toUpperCase().padStart(4, '0'));
  setText(`${p}-state`, d.st || '—');
  const stEl = $(`${p}-state`); if (stEl) stEl.className = 'station-state st-' + d.st;

  const idx = STATES.indexOf(d.st);
  document.querySelectorAll(`#${p}-track .st-step`).forEach(e => {
    const i = STATES.indexOf(e.dataset.st);
    e.classList.toggle('now', i === idx);
    e.classList.toggle('done', d.st !== 'TEST_MODE' && i > 1 && i < idx);
  });
  document.querySelectorAll(`#${p}-flagchips .flag`).forEach(e => {
    const bit = FLAGS.find(f => f[0] === e.dataset.flag)[1], on = !!(d.flags & (1 << bit)), n = e.dataset.flag;
    e.className = 'flag ' + (PROBLEM_FLAGS.has(n) ? (on ? 'bad' : 'off') : INFO_FLAGS.has(n) ? (on ? 'info' : 'off') : (on ? 'ok' : 'bad'));
  });
  const gps = $(`${p}-gps`);
  if (gps) { const fix = !!(d.flags & 0x10); gps.textContent = fix ? `${d.sats} SATS · FIX` : `${d.sats} SATS · NO FIX`; gps.className = 'card-badge' + (fix ? ' fix' : ''); }

  // Map
  if (st.map && (d.lat || d.lon)) {
    const ll = [d.lat, d.lon];
    st.marker.setLatLng(ll); if (!st.map.hasLayer(st.marker)) st.marker.addTo(st.map);
    st.pad.setLatLng(st.origin); if (!st.map.hasLayer(st.pad)) st.pad.addTo(st.map);
    st.poly.setLatLngs(st.d.lat.map((a, i) => [a, st.d.lon[i]]));
    if (st.autoCenter) st.map.setView(ll, Math.max(st.map.getZoom(), 16), { animate:false });
    const dx = st.d.ex[st.d.ex.length - 1] || 0, dy = st.d.ny[st.d.ny.length - 1] || 0;
    setText(`${p}-mapfoot`, `${d.lat.toFixed(6)}, ${d.lon.toFixed(6)}  ·  ${Math.hypot(dx, dy).toFixed(0)} m from first fix, bearing ${((Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360).toFixed(0)}°`);
  }
  setText(`${p}-att`, `R ${num(d.roll, 0)}° P ${num(d.pitch, 0)}° Y ${num(((st.yaw % 360) + 540) % 360 - 180, 0)}°`);

  if (p === activeTab) renderCharts(st);
}

function renderCharts(st) {
  if (!st.charts || typeof Plotly === 'undefined') return;
  const p = st.cfg.id, D = st.d, t = D.t;
  Plotly.update(`${p}-palt`, { x:[t], y:[D.alt] }, {}, [0]);
  Plotly.update(`${p}-pvz`, { x:[t], y:[D.vz] }, {}, [0]);
  Plotly.update(`${p}-pacc`, { x:[t, t, t], y:[D.ax, D.ay, D.az] }, {}, [0, 1, 2]);
  Plotly.update(`${p}-patti`, { x:[t, t, t], y:[D.roll, D.pitch, D.spin] }, {}, [0, 1, 2]);
  Plotly.update(`${p}-ptemp`, { x:[t], y:[D.temp] }, {}, [0]);
  Plotly.update(`${p}-ppress`, { x:[t], y:[D.press] }, {}, [0]);
  Plotly.update(`${p}-ppow`, { x:[t, t], y:[D.volt, D.cur] }, {}, [0, 1]);
  if (D.ex.length) {
    const k = D.ex.length - 1;
    Plotly.update(`${p}-p3d`, { x:[D.ex, [D.ex[k]]], y:[D.ny, [D.ny[k]]], z:[D.tz, [D.tz[k]]] }, {}, [0, 1]);
  }
  if (st.latest && st.mesh) {
    const r = rotate(st.mesh, st.latest.roll, st.latest.pitch, st.yaw);
    Plotly.restyle(`${p}-patt`, { x:[r.X], y:[r.Y], z:[r.Z] }, [0]);
  }
}

function switchTab(id) {
  activeTab = id;
  for (const c of STATIONS) {
    $(`page-${c.id}`).classList.toggle('hidden', c.id !== id);
    $(`tab-${c.id}`).classList.toggle('active', c.id === id);
  }
  const st = S[id];
  initMap(st); initCharts(st);
  setTimeout(() => {
    if (st.map) st.map.invalidateSize();
    if (typeof Plotly !== 'undefined') document.querySelectorAll(`#page-${id} .js-plotly-plot`).forEach(e => Plotly.Plots.resize(e));
    st.dirty = true; renderCharts(st);
  }, 60);
  try { localStorage.setItem('gcs.tab', id); } catch (e) { /* private mode */ }
  updateHeader();
}

function updateHeader() {
  const st = S[activeTab], d = st.latest;
  const fs = $('flight-state');
  if (fs) { fs.textContent = d ? d.st.replace('_', ' ') : 'PRE-FLIGHT'; fs.className = 'flight-state st-' + (d ? d.st : ''); }
  const met = $('met-display');
  if (met) {
    const s = d ? Math.max(0, d.t) : 0;
    met.textContent = `T+ ${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }
  const tid = $('team-id-display'); if (tid) tid.textContent = 'TEAM 003';
}

let renderNow = () => Date.now();
function renderLoop() {
  const now = renderNow();
  for (const c of STATIONS) renderStation(S[c.id], now);
  updateHeader();
}
setInterval(() => { for (const c of STATIONS) { const st = S[c.id]; st.rate = st.rateCnt; st.rateCnt = 0; } }, 1000);

function startRenderLoop(nowFn) {
  if (nowFn) renderNow = nowFn;
  setInterval(renderLoop, 250);
}

function initPages() {
  buildPages($('pages'), $('page-tabs'));
  let t = 'pl'; try { t = localStorage.getItem('gcs.tab') || 'pl'; } catch (e) { /* ignore */ }
  if (!S[t]) t = 'pl';
  switchTab(t);
  window.addEventListener('resize', () => { const st = S[activeTab]; if (st.map) st.map.invalidateSize(); });
}

// ─────────────────────────────── simulator ──────────────────────────────────
// Emits the exact ground-station USB lines (TLM / LNK / RX) for both vehicles
function Simulator(emit) {
  const G = 9.80665;
  function Veh(o) {
    return { o, n:0, h:0, v:0, t:0, st:'LAUNCH_PAD', dep:false, lat:o.lat, lon:o.lon, volt:o.volt, yawRate:0 };
  }
  function step(V, dt, T) {
    const o = V.o; let a = 0; V.t += dt;
    if (T < o.pad) V.st = 'LAUNCH_PAD';
    else if (T < o.pad + o.burn) { V.st = 'ASCENT'; a = o.thrust - G; }
    else if (V.st === 'ASCENT' || V.st === 'LAUNCH_PAD') { a = -G - 0.0006 * V.v * Math.abs(V.v); if (V.v < -1) { V.st = 'ROCKET_DEPLOY'; V.sep = T; } }
    else if (V.st === 'ROCKET_DEPLOY') { a = (o.drogue - V.v) * 1.5; if (T - V.sep > 2) V.st = 'DESCENT'; }
    else if (V.st === 'DESCENT') { a = (o.drogue - V.v) * 1.5; if (V.h <= 500) { V.st = 'AEROBREAK_RELEASE'; V.dep = true; V.depT = T; } }
    else if (V.st === 'AEROBREAK_RELEASE') { a = (o.legs - V.v) * 1.2; }
    if (V.st !== 'IMPACT' && V.st !== 'LAUNCH_PAD') {
      V.v += a * dt; V.h = Math.max(0, V.h + V.v * dt);
      if (V.h <= 0 && V.st === 'AEROBREAK_RELEASE') { V.st = 'IMPACT'; V.v = 0; }
    }
    V.a = a;
    const fly = V.st !== 'LAUNCH_PAD' && V.st !== 'IMPACT';
    if (fly) { V.lat += o.drift[0] * dt * (1 + V.h / 800); V.lon += o.drift[1] * dt * (1 + V.h / 800); }
    const sway = fly && V.st !== 'ASCENT' ? 1 : 0.08;
    V.roll = Math.sin(T * 0.9 + o.ph) * 16 * sway; V.pitch = Math.cos(T * 0.7 + o.ph) * 10 * sway;
    V.spin = V.st === 'ASCENT' ? 25 : fly ? 30 * Math.sin(T * 0.3 + o.ph) + (V.dep ? 20 : 0) : 0;
    V.volt = Math.max(7.0, V.volt - 0.0004 * dt * (V.dep ? 4 : 1));
  }
  function packet(V, T) {
    V.n++; const o = V.o;
    const press = 100950 * Math.pow(1 - V.h / 44330, 5.255) + (Math.random() - 0.5) * 3;
    const fix = V.n > 3, sats = fix ? 9 + (V.n % 3) : 0;
    let flags = 0x1 | 0x2 | 0x4 | 0x8 | 0x20 | 0x40 | 0x100 | 0x200;
    if (fix) flags |= 0x10; if (o.lora) flags |= 0x80; if (V.dep) flags |= 0x800 | 0x1000;
    const accZ = V.st === 'ASCENT' ? o.thrust : (V.st === 'LAUNCH_PAD' || V.st === 'IMPACT') ? G : G + V.a * 0.3;
    const body = [TEAM_ID, V.t.toFixed(2), V.n, V.h.toFixed(1), press.toFixed(0), (29.5 - V.h * 0.0065 + Math.random() * 0.1).toFixed(1),
      V.volt.toFixed(2), new Date().toISOString().slice(11, 19), fix ? V.lat.toFixed(5) : '0.00000', fix ? V.lon.toFixed(5) : '0.00000',
      fix ? (921 + V.h).toFixed(1) : '0.0', sats, ((Math.random() - 0.5) * 0.6).toFixed(2), ((Math.random() - 0.5) * 0.6).toFixed(2),
      (accZ + (Math.random() - 0.5) * 0.3).toFixed(2), V.roll.toFixed(1), V.pitch.toFixed(1), '0.0', V.st, V.v.toFixed(1),
      ((V.dep && T - V.depT < 2 ? 0.95 : 0.21) + Math.random() * 0.01).toFixed(3), V.spin.toFixed(1),
      o.lora ? 0 : Math.round(22 + V.h / 40 + Math.random() * 6), V.dep ? 1 : 0, o.lora ? 'L1X1' : 'L0X1', o.lora ? 'MM' : '-M',
      V.n < 3 ? 'NONE' : 'CX_ON', flags.toString(16).toUpperCase().padStart(4, '0')].join(',');
    return body + ',' + xor(body).toString(16).toUpperCase().padStart(2, '0');
  }
  let timer = null, T = 0, can, pay, acc = 0, cnt = { CX:0, PX:0, PL:0 };
  this.running = () => !!timer;
  this.start = () => {
    const base = { lat:13.06842, lon:77.50325, volt:8.25, pad:6, burn:2.5, thrust:52, ph:0 };
    can = Veh({ ...base, drogue:-14, legs:-6.5, drift:[0.0000032, 0.0000041], lora:false });
    pay = Veh({ ...base, lat:13.06838, thrust:47, burn:2.3, drogue:-11, legs:-7.5, drift:[0.0000021, 0.0000056], lora:true, ph:1.3, volt:8.1 });
    T = 0; acc = 0; cnt = { CX:0, PX:0, PL:0 };
    timer = setInterval(() => {
      T += 0.1; acc += 0.1; step(can, 0.1, T); step(pay, 0.1, T);
      if (acc < 0.999) return; acc = 0;
      emit(`TLM,CX,0,0.0,${packet(can, T)}`); cnt.CX++;
      const pp = packet(pay, T);
      if (Math.random() > 0.04) { emit(`TLM,PX,0,0.0,${pp}`); cnt.PX++; }
      const rssi = (-62 - pay.h / 16 - Math.random() * 4).toFixed(0), snr = (9.5 - pay.h / 110 + Math.random()).toFixed(1);
      setTimeout(() => {
        if (!timer) return;
        if (Math.random() > 0.07) { emit(`TLM,PL,${rssi},${snr},${pp}`); cnt.PL++; }
        for (const k of ['CX', 'PX', 'PL']) emit(`LNK,${k},1,M,${cnt[k]},0,0,400,${k === 'PL' ? rssi : 0},${k === 'PL' ? snr : 0}`);
      }, 560);
    }, 100);
  };
  this.stop = () => { clearInterval(timer); timer = null; };
}

// ─────────────────────────────── CSV export ─────────────────────────────────
const CSV_HEADER = 'TEAM_ID,MISSION_TIME_S,PACKET_COUNT,ALTITUDE_M,PRESSURE_PA,TEMP_C,VOLTAGE_V,GNSS_TIME,GNSS_LAT_DEG,GNSS_LON_DEG,GNSS_ALT_M,GNSS_SATS,ACC_X_MS2,ACC_Y_MS2,ACC_Z_MS2,ROLL_DEG,PITCH_DEG,GW_SPIN_RATE_DPS,FSW_STATE,VVEL_MS,CURRENT_A,CAN_SPIN_DPS,GEIGER_CPM,DEPLOY_SW,LINKS,CHANNELS,CMD_ECHO,FLAGS,CHECKSUM';
function exportCSV() {
  let any = false;
  for (const c of STATIONS) {
    const st = S[c.id]; if (!st.raw.length) continue; any = true;
    const b = new Blob([CSV_HEADER + '\n' + st.raw.join('\n') + '\n'], { type:'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    a.download = `T003_${c.key}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    mlog(`Exported ${st.raw.length} packets: ${a.download}`, 'log-ok');
  }
  if (!any) mlog('No telemetry to export yet', 'log-warn');
}

// ─────────────────────────────── firebase ───────────────────────────────────
// Layout under <root> (default "gcs/003"):
//   meta                       { missionId, startedAt, updatedAt }
//   live/<station>             latest record (+ at = server time)
//   live/links                 ground link stats
//   missions/<id>/<station>/<pushId>   every packet received on that link
function parseFirebaseConfig(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No { ... } config object found');
  const src = m[0].replace(/^\s*\/\/.*$/gm, '').replace(/,\s*\/\/.*$/gm, ',')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}');
  const cfg = JSON.parse(src);
  if (!cfg.databaseURL) throw new Error('Config has no databaseURL (create the Realtime Database first)');
  if (!cfg.apiKey) throw new Error('Config has no apiKey');
  return cfg;
}
function firebaseApp(cfg) {
  const name = 't003-' + Math.random().toString(36).slice(2);
  return firebase.initializeApp(cfg, name);
}

window.GCS = { TEAM_ID, STATIONS, BY_TAG, BY_KEY, S, $, mlog, parsePacket, parseGroundLine, toRecord, fromRecord,
  ingest, resetStation, initPages, switchTab, startRenderLoop, Simulator, exportCSV, parseFirebaseConfig, firebaseApp,
  get activeTab() { return activeTab; } };
})();
