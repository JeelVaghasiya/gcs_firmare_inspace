/* IN-SPACe 2026 GCS — Annexure-2 Telemetry Engine */
const CFG = { BAUD: 9600, MAX: 600, TEAM: '' };
const STATES = ['BOOT','TEST_MODE','LAUNCH_PAD','ASCENT','PAYLOAD_SEP','DESCENT','AEROBREAK','IMPACT'];
const D = { time:[], lat:[], lon:[], lx:[], ly:[], alt:[], gpsAlt:[], temp:[], press:[], volt:[],
  ax:[], ay:[], az:[], gx:[], gy:[], gz:[], spd:[], sats:[], state:[], pkt:[], raw:[] };
let t0=null, lLat=null, lLon=null, maxAlt=0, pktCnt=0, conn=false, port=null, rdr=null;
let rotX=0, rotY=0, rotZ=0, lastT=null, rateCnt=0, cTmr=null, mTmr=null;
let autoCenter=true, autoCenterCs=true;
let baseX=[], baseY=[], baseZ=[];
// XBee link state
let xbeeRssi=-999, xbeeLqi=0, xbeeLastPkt=0, loraRssi=-999;

const $=id=>document.getElementById(id);
const el={
  btnConn:$('btn-connect'), btnCsv:$('btn-csv'), btnStart:$('btn-start-tm'), btnStop:$('btn-stop-tm'),
  btnArm:$('btn-arm'), btnZero:$('btn-zero-alt'), btnClr:$('btn-clear-console'),
  badge:$('connection-badge'), fst:$('flight-state'), met:$('met-display'),
  gps:$('gps-status'), tid:$('team-id-display'), clog:$('cmd-log'), rate:$('cmd-pkt-rate'),
  alt:$('val-altitude'), malt:$('val-max-alt'), prs:$('val-pressure'),
  vlt:$('val-voltage'), tmp:$('val-temp'), sat:$('val-sats'), pk:$('val-packets'),
  con:$('console-output'),
  // Row 2: GPS + IMU
  gtime:$('val-gnss-time'), lat:$('val-lat'), lon:$('val-lon'), galt:$('val-gnss-alt'),
  vax:$('val-ax'), vay:$('val-ay'), vaz:$('val-az'),
  vgx:$('val-gx'), vgy:$('val-gy'), vgz:$('val-gz')
};

// ── Console Logger ──
function mlog(m,c='log-info'){const d=document.createElement('div');d.className=c;
  d.textContent=`[${new Date().toLocaleTimeString('en-GB')}] ${m}`;
  el.con.appendChild(d);el.con.scrollTop=el.con.scrollHeight;
  if(el.con.children.length>500)el.con.removeChild(el.con.firstChild);}
el.btnClr.addEventListener('click',()=>{el.con.innerHTML='';});

// ── Map ──
let map,marker,poly;
function initMap(){
  map=L.map('map',{zoomControl:true}).setView([23.0225,72.5714],14);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'CARTO',maxZoom:19}).addTo(map);
  marker=L.circleMarker([0,0],{radius:6,color:'#38bdf8',fillColor:'#38bdf8',fillOpacity:.8,weight:2}).addTo(map);
  poly=L.polyline([],{color:'#38bdf8',weight:2,opacity:.6}).addTo(map);
  
  const btn=$('btn-auto-center');
  if(btn) btn.addEventListener('click',()=>{
    autoCenter=!autoCenter;
    btn.textContent=autoCenter?'🎯 AUTO: ON':'🎯 AUTO: OFF';
    btn.classList.toggle('active',autoCenter);
    btn.style.color=autoCenter?'var(--cyan)':'var(--text-muted)';
    btn.style.borderColor=autoCenter?'var(--cyan)':'var(--border)';
    if(autoCenter&&D.lat.length) map.panTo([D.lat[D.lat.length-1],D.lon[D.lon.length-1]]);
  });
  mlog('Map ready (CartoDB Dark)','log-ok');
}

// ── Plotly Setup ──
const PL={paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',
  font:{color:'#6b7280',size:10,family:'JetBrains Mono'},
  margin:{t:8,b:30,l:42,r:10},
  xaxis:{gridcolor:'rgba(56,189,248,0.06)',zeroline:false,title:{text:'Time (s)',font:{size:9}}},
  yaxis:{gridcolor:'rgba(56,189,248,0.06)',zeroline:false},
  showlegend:false,hovermode:'x unified'};
const PC={displayModeBar:true,responsive:true,scrollZoom:true,
  modeBarButtonsToAdd:['resetScale2d'],
  modeBarButtonsToRemove:['lasso2d','select2d']};
function tr(n,c){return{x:[],y:[],name:n,mode:'lines',line:{color:c,width:1.5,shape:'spline'}};}

function initCharts(){
  Plotly.newPlot('plot-altitude',[tr('Alt','#a855f7')],{...PL,yaxis:{...PL.yaxis,title:{text:'m',font:{size:9}}}},PC);
  Plotly.newPlot('plot-velocity',[tr('Vel','#22c55e')],{...PL,yaxis:{...PL.yaxis,title:{text:'m/s',font:{size:9}}}},PC);
  Plotly.newPlot('plot-accel',[tr('X','#ef4444'),tr('Y','#22c55e'),tr('Z','#38bdf8')],
    {...PL,showlegend:true,legend:{font:{size:9},x:1,xanchor:'right'},yaxis:{...PL.yaxis,title:{text:'m/s²',font:{size:9}}}},PC);
  Plotly.newPlot('plot-gyro',[tr('X','#ef4444'),tr('Y','#22c55e'),tr('Z','#38bdf8')],
    {...PL,showlegend:true,legend:{font:{size:9},x:1,xanchor:'right'},yaxis:{...PL.yaxis,title:{text:'°/s',font:{size:9}}}},PC);
  Plotly.newPlot('plot-temp',[tr('Temp','#ef4444')],{...PL,yaxis:{...PL.yaxis,title:{text:'°C',font:{size:9}}}},PC);
  Plotly.newPlot('plot-press',[tr('Press','#ec4899')],{...PL,yaxis:{...PL.yaxis,title:{text:'Pa',font:{size:9}}}},PC);
  Plotly.newPlot('plot-voltage',[tr('V','#22c55e')],{...PL,yaxis:{...PL.yaxis,title:{text:'V',font:{size:9}}}},PC);
  // 3D Trajectory
  Plotly.newPlot('plot-3d',[{x:[],y:[],z:[],type:'scatter3d',mode:'lines+markers',
    marker:{size:2,color:'#38bdf8'},line:{color:'#38bdf8',width:3}}],
    {...PL,margin:{t:0,b:0,l:0,r:0},scene:{
      xaxis:{title:'East(m)',gridcolor:'#111',color:'#555'},
      yaxis:{title:'North(m)',gridcolor:'#111',color:'#555'},
      zaxis:{title:'Alt(m)',gridcolor:'#111',color:'#555'},bgcolor:'rgba(0,0,0,0)'}},PC);
  initRocket();
  mlog('All charts initialized with full interactivity','log-ok');
}

function initRocket(){
  const h=4,r=.3,n=12,x=[],y=[],z=[],ii=[],jj=[],kk=[];
  for(let i=0;i<=n;i++){const a=(i/n)*2*Math.PI;
    x.push(r*Math.cos(a));y.push(r*Math.sin(a));z.push(0);
    x.push(r*Math.cos(a));y.push(r*Math.sin(a));z.push(h*.7);}
  for(let i=0;i<n;i++){const b=i*2,t=b+1;ii.push(b);jj.push(t);kk.push(b+2);ii.push(t);jj.push(t+2);kk.push(b+2);}
  const tip=x.length;x.push(0);y.push(0);z.push(h);
  for(let i=0;i<n;i++){ii.push(i*2+1);jj.push(((i+1)%n)*2+1);kk.push(tip);}
  // Fins
  const fb=x.length;
  for(let i=0;i<4;i++){const a=(i/4)*2*Math.PI;
    x.push(r*Math.cos(a));y.push(r*Math.sin(a));z.push(0);
    x.push(1.0*Math.cos(a));y.push(1.0*Math.sin(a));z.push(-0.3);
    x.push(r*Math.cos(a));y.push(r*Math.sin(a));z.push(0.6);
    ii.push(fb+i*3);jj.push(fb+i*3+1);kk.push(fb+i*3+2);}
  baseX=[...x];baseY=[...y];baseZ=[...z];
  Plotly.newPlot('plot-3d-gyro',[{type:'mesh3d',x,y,z,i:ii,j:jj,k:kk,
    color:'#38bdf8',opacity:.85,flatshading:true}],
    {...PL,margin:{t:0,b:0,l:0,r:0},scene:{
      xaxis:{range:[-4,4],gridcolor:'#1a1a2e',color:'#555',title:''},
      yaxis:{range:[-4,4],gridcolor:'#1a1a2e',color:'#555',title:''},
      zaxis:{range:[-2,5],gridcolor:'#1a1a2e',color:'#555',title:''},
      bgcolor:'rgba(0,0,0,0)',camera:{eye:{x:1.8,y:1.8,z:1.0}}}},PC);
}

function rotateRocket(){
  const cx=Math.cos(rotX),sx=Math.sin(rotX),cy=Math.cos(rotY),sy=Math.sin(rotY),cz=Math.cos(rotZ),sz=Math.sin(rotZ);
  const nx=[],ny=[],nz=[];
  for(let i=0;i<baseX.length;i++){
    let x=baseX[i],y=baseY[i],z=baseZ[i];
    let x1=x*cy+z*sy, z1=-x*sy+z*cy;
    let y2=y*cx-z1*sx, z2=y*sx+z1*cx;
    let x3=x1*cz-y2*sz, y3=x1*sz+y2*cz;
    nx.push(x3);ny.push(y3);nz.push(z2);}
  Plotly.restyle('plot-3d-gyro',{x:[nx],y:[ny],z:[nz]},[0]);
}

// ── Annexure-2 Parser ──
// Fields: TEAM_ID,TIME,PKT_CNT,ALT,PRESS,TEMP,VOLT,GNSS_TIME,LAT,LON,GNSS_ALT,SATS,ACCEL(X;Y;Z),GYRO(X;Y;Z),STATE,OPT
function parse(line){
  line=line.trim(); if(!line||line.startsWith('#')||line.startsWith('CMD'))return;
  const f=line.split(','); if(f.length<15)return;
  const tid=f[0], mt=+f[1]||0, pk=+f[2]||0, alt=+f[3]||0, prs=+f[4]||0;
  const tmp=+f[5]||0, vlt=+f[6]||0, gt=f[7]||'';
  const lat=+f[8]||0, lon=+f[9]||0, galt=+f[10]||0, sat=+f[11]||0;
  let ax=0,ay=0,az=0; if(f[12]){const p=f[12].split(';');ax=+p[0]||0;ay=+p[1]||0;az=+p[2]||0;}
  let gx=0,gy=0,gz=0; if(f[13]){const p=f[13].split(';');gx=+p[0]||0;gy=+p[1]||0;gz=+p[2]||0;}
  const ss=(f[14]||'').trim(), opt=f[15]||'';
  const si=Math.max(0,STATES.indexOf(ss.toUpperCase()));
  if(!CFG.TEAM&&tid){CFG.TEAM=tid;el.tid.textContent='TEAM: '+tid;}
  if(!t0)t0=Date.now()-mt*1000;

  // Gyro integration (single pass — degrees to radians)
  if(lastT!==null){const dt=mt-lastT;if(dt>0&&dt<2){rotX+=(gx*Math.PI/180)*dt;rotY+=(gy*Math.PI/180)*dt;rotZ+=(gz*Math.PI/180)*dt;}}
  lastT=mt;

  // Speed
  let spd=0;
  if(D.alt.length>0){const dt2=mt-D.time[D.time.length-1];if(dt2>0)spd=Math.abs((alt-D.alt[D.alt.length-1])/dt2);}

  // Launch origin
  if(lat!==0&&lon!==0&&lLat===null){lLat=lat;lLon=lon;mlog(`Launch origin: ${lat.toFixed(6)}, ${lon.toFixed(6)}`,'log-ok');}
  let lx=0,ly=0;
  if(lLat!==null){ly=(lat-lLat)*111111;lx=(lon-lLon)*111111*Math.cos(lLat*Math.PI/180);}

  // Store
  const push=(a,v)=>{a.push(v);if(a.length>CFG.MAX)a.shift();};
  push(D.time,mt);push(D.lat,lat);push(D.lon,lon);push(D.lx,lx);push(D.ly,ly);
  push(D.alt,alt);push(D.gpsAlt,galt);push(D.temp,tmp);push(D.press,prs);push(D.volt,vlt);
  push(D.ax,ax);push(D.ay,ay);push(D.az,az);push(D.gx,gx);push(D.gy,gy);push(D.gz,gz);
  push(D.spd,spd);push(D.sats,sat);push(D.state,si);push(D.pkt,pk);D.raw.push(line);
  pktCnt++;rateCnt++;if(alt>maxAlt)maxAlt=alt;

  // ── FULL PACKET CONSOLE LOG (All 16 Annexure-2 fields) ──
  mlog(`━━━ PKT #${pk} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,'log-cmd');
  mlog(`  1.TEAM: ${tid} | 2.TIME: ${mt}s | 3.PKT_CNT: ${pk}`,'log-data');
  mlog(`  4.ALT: ${alt}m | 5.PRESS: ${prs}Pa | 6.TEMP: ${tmp}°C | 7.VOLT: ${vlt}V`,'log-data');
  mlog(`  8.GNSS_TIME: ${gt} | 9.LAT: ${lat}° | 10.LON: ${lon}° | 11.GNSS_ALT: ${galt}m | 12.SATS: ${sat}`,'log-data');
  mlog(`  13.ACCEL: X=${ax} Y=${ay} Z=${az} m/s² | 14.GYRO: X=${gx} Y=${gy} Z=${gz} °/s`,'log-data');
  mlog(`  15.STATE: ${ss} | 16.OPT: ${opt}`,'log-data');

  // UI
  uiMetrics(alt,prs,vlt,sat,tmp,si,ss,gt,lat,lon,galt,ax,ay,az,gx,gy,gz);
  rotateRocket();
  if(!cTmr)cTmr=setTimeout(()=>{cTmr=null;uiCharts();},150);
  if(!mTmr&&lat!==0)mTmr=setTimeout(()=>{mTmr=null;
    marker.setLatLng([lat,lon]);poly.addLatLng([lat,lon]);
    if(autoCenter&&pktCnt%10===0)map.panTo([lat,lon]);},400);
  // Firebase sync
  fbPush('rocket',{t:mt,alt,prs,tmp,vlt,lat,lon,galt,ax,ay,az,gx,gy,gz,st:ss,src:'LORA',rssi:loraRssi});
}

function uiMetrics(alt,prs,vlt,sat,tmp,si,ss,gt,lat,lon,galt,ax,ay,az,gx,gy,gz){
  el.alt.textContent=alt.toFixed(1);el.malt.textContent=maxAlt.toFixed(1);
  el.prs.textContent=Math.round(prs);el.vlt.textContent=vlt.toFixed(2);
  el.tmp.textContent=tmp.toFixed(1);el.sat.textContent=sat;el.pk.textContent=pktCnt;
  // Row 2
  el.gtime.textContent=gt||'--';
  el.lat.textContent=lat.toFixed(4);el.lon.textContent=lon.toFixed(4);
  el.galt.textContent=galt.toFixed(1);
  el.vax.textContent=ax.toFixed(2);el.vay.textContent=ay.toFixed(2);el.vaz.textContent=az.toFixed(2);
  el.vgx.textContent=gx.toFixed(1);el.vgy.textContent=gy.toFixed(1);el.vgz.textContent=gz.toFixed(1);
  if(sat>0){el.gps.textContent=sat+' SATS';el.gps.className='card-badge fix';}
  else{el.gps.textContent='NO FIX';el.gps.className='card-badge';}
  el.fst.textContent=ss||STATES[si];el.fst.className='flight-state st-'+STATES[si];
  if(t0){const s=Math.floor((Date.now()-t0)/1000);
    el.met.textContent=`T+ ${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
}

function uiCharts(){
  const t=D.time;
  // 2D Charts — use Plotly.update to set data directly on existing traces
  Plotly.update('plot-altitude',{x:[t],y:[D.alt]},[0]);
  Plotly.update('plot-velocity',{x:[t],y:[D.spd]},[0]);
  Plotly.update('plot-accel',{x:[t,t,t],y:[D.ax,D.ay,D.az]},[0,1,2]);
  Plotly.update('plot-gyro',{x:[t,t,t],y:[D.gx,D.gy,D.gz]},[0,1,2]);
  Plotly.update('plot-temp',{x:[t],y:[D.temp]},[0]);
  Plotly.update('plot-press',{x:[t],y:[D.press]},[0]);
  Plotly.update('plot-voltage',{x:[t],y:[D.volt]},[0]);
  // 3D Trajectory
  if(D.lx.length>0){
    Plotly.update('plot-3d',{x:[D.lx],y:[D.ly],z:[D.alt]},[0]);
  }
}

// ── XBee Parser (rocket 2.4 GHz link) ──
// XBee sends same Annexure-2 CSV — parsed into its own DX data store
const DX = { time:[], lat:[], lon:[], lx:[], ly:[], alt:[], gpsAlt:[], temp:[], press:[], volt:[],
  ax:[], ay:[], az:[], gx:[], gy:[], gz:[], spd:[], sats:[], state:[], pkt:[], raw:[] };
let xbMaxAlt=0, xbPktCnt=0, xbLLat=null, xbLLon=null, xbLastT=null;
let xbMap=null, xbMarker=null, xbPoly=null, xbMTmr=null, xbCTmr=null;
let autoCenterXb=true;

const elX = {
  alt:$('xb-altitude'), malt:$('xb-max-alt'), prs:$('xb-pressure'),
  vlt:$('xb-voltage'), tmp:$('xb-temp'), pk:$('xb-packets'), sat:$('xb-sats'),
  rssi:$('xb-rssi'), lqi:$('xb-lqi'), gps:$('xb-gps-status'),
  gtime:$('xb-gnss-time'), lat:$('xb-lat'), lon:$('xb-lon'), galt:$('xb-gnss-alt'),
  vax:$('xb-ax'), vay:$('xb-ay'), vaz:$('xb-az'),
  vgx:$('xb-gx'), vgy:$('xb-gy'), vgz:$('xb-gz')
};

const trX=(n,c)=>({x:[],y:[],name:n,mode:'lines',line:{color:c,width:1.5,shape:'spline'}});
const PLX={...PL, xaxis:{...PL.xaxis}, yaxis:{...PL.yaxis}};

function initXbeeUI(){
  // Charts (purple theme)
  Plotly.newPlot('xb-plot-altitude',[trX('Alt','#a855f7')],{...PLX,yaxis:{...PLX.yaxis,title:{text:'m',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-velocity',[trX('Vel','#c084fc')],{...PLX,yaxis:{...PLX.yaxis,title:{text:'m/s',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-accel',[trX('X','#ef4444'),trX('Y','#22c55e'),trX('Z','#a855f7')],
    {...PLX,showlegend:true,legend:{font:{size:9},x:1,xanchor:'right'},yaxis:{...PLX.yaxis,title:{text:'m/s²',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-gyro',[trX('X','#ef4444'),trX('Y','#22c55e'),trX('Z','#a855f7')],
    {...PLX,showlegend:true,legend:{font:{size:9},x:1,xanchor:'right'},yaxis:{...PLX.yaxis,title:{text:'°/s',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-temp',[trX('Temp','#f97316')],{...PLX,yaxis:{...PLX.yaxis,title:{text:'°C',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-press',[trX('Press','#ec4899')],{...PLX,yaxis:{...PLX.yaxis,title:{text:'Pa',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-voltage',[trX('V','#a855f7')],{...PLX,yaxis:{...PLX.yaxis,title:{text:'V',font:{size:9}}}},PC);

  // Map
  xbMap=L.map('map-xbee',{zoomControl:true}).setView([23.0225,72.5714],14);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'CARTO',maxZoom:19}).addTo(xbMap);
  xbMarker=L.circleMarker([0,0],{radius:6,color:'#a855f7',fillColor:'#a855f7',fillOpacity:.8,weight:2}).addTo(xbMap);
  xbPoly=L.polyline([],{color:'#a855f7',weight:2,opacity:.6}).addTo(xbMap);

  const btn=$('btn-auto-center-xb');
  if(btn) btn.addEventListener('click',()=>{
    autoCenterXb=!autoCenterXb;
    btn.textContent=autoCenterXb?'🎯 AUTO: ON':'🎯 AUTO: OFF';
    btn.classList.toggle('active',autoCenterXb);
    btn.style.color=autoCenterXb?'#a855f7':'var(--text-muted)';
    btn.style.borderColor=autoCenterXb?'#a855f7':'var(--border)';
    if(autoCenterXb&&DX.lat.length) xbMap.panTo([DX.lat[DX.lat.length-1],DX.lon[DX.lon.length-1]]);
  });

  // 3D Trajectory (purple)
  Plotly.newPlot('xb-plot-3d',[{x:[],y:[],z:[],type:'scatter3d',mode:'lines+markers',
    marker:{size:2,color:'#a855f7'},line:{color:'#a855f7',width:3}}],
    {...PL,margin:{t:0,b:0,l:0,r:0},scene:{
      xaxis:{title:'East(m)',gridcolor:'#111',color:'#555'},
      yaxis:{title:'North(m)',gridcolor:'#111',color:'#555'},
      zaxis:{title:'Alt(m)',gridcolor:'#111',color:'#555'},bgcolor:'rgba(0,0,0,0)'}},PC);

  // 3D Rocket Orientation (reuse same geometry, purple tint)
  const h2=4,r2=.3,n2=12,xr=[],yr=[],zr=[],ii2=[],jj2=[],kk2=[];
  for(let i=0;i<=n2;i++){const a=(i/n2)*2*Math.PI;
    xr.push(r2*Math.cos(a));yr.push(r2*Math.sin(a));zr.push(0);
    xr.push(r2*Math.cos(a));yr.push(r2*Math.sin(a));zr.push(h2*.7);}
  for(let i=0;i<n2;i++){const b=i*2,t=b+1;ii2.push(b);jj2.push(t);kk2.push(b+2);ii2.push(t);jj2.push(t+2);kk2.push(b+2);}
  const tip2=xr.length;xr.push(0);yr.push(0);zr.push(h2);
  for(let i=0;i<n2;i++){ii2.push(i*2+1);jj2.push(((i+1)%n2)*2+1);kk2.push(tip2);}
  window.xbBaseX=[...xr];window.xbBaseY=[...yr];window.xbBaseZ=[...zr];
  Plotly.newPlot('xb-plot-3d-gyro',[{type:'mesh3d',x:xr,y:yr,z:zr,i:ii2,j:jj2,k:kk2,
    color:'#a855f7',opacity:.85,flatshading:true}],
    {...PL,margin:{t:0,b:0,l:0,r:0},scene:{
      xaxis:{range:[-4,4],gridcolor:'#1a1a2e',color:'#555',title:''},
      yaxis:{range:[-4,4],gridcolor:'#1a1a2e',color:'#555',title:''},
      zaxis:{range:[-2,5],gridcolor:'#1a1a2e',color:'#555',title:''},
      bgcolor:'rgba(0,0,0,0)',camera:{eye:{x:1.8,y:1.8,z:1.0}}}},PC);

  mlog('XBee panel initialized','log-ok');
}

function parseXbee(line){
  line=line.trim(); if(!line||line.startsWith('#'))return;
  const f=line.split(','); if(f.length<15)return;
  const tid=f[0], mt=+f[1]||0, pk=+f[2]||0, alt=+f[3]||0, prs=+f[4]||0;
  const tmp=+f[5]||0, vlt=+f[6]||0, gt=f[7]||'';
  const lat=+f[8]||0, lon=+f[9]||0, galt=+f[10]||0, sat=+f[11]||0;
  let ax=0,ay=0,az=0; if(f[12]){const p=f[12].split(';');ax=+p[0]||0;ay=+p[1]||0;az=+p[2]||0;}
  let gx=0,gy=0,gz=0; if(f[13]){const p=f[13].split(';');gx=+p[0]||0;gy=+p[1]||0;gz=+p[2]||0;}
  const ss=(f[14]||'').trim();

  // Speed
  let spd=0;
  if(DX.alt.length>0){const dt=mt-(DX.time[DX.time.length-1]);if(dt>0)spd=Math.abs((alt-DX.alt[DX.alt.length-1])/dt);}

  if(lat!==0&&xbLLat===null){xbLLat=lat;xbLLon=lon;}
  let lx=0,ly=0;
  if(xbLLat!==null){ly=(lat-xbLLat)*111111;lx=(lon-xbLLon)*111111*Math.cos(xbLLat*Math.PI/180);}

  const push=(a,v)=>{a.push(v);if(a.length>CFG.MAX)a.shift();};
  push(DX.time,mt);push(DX.lat,lat);push(DX.lon,lon);push(DX.lx,lx);push(DX.ly,ly);
  push(DX.alt,alt);push(DX.gpsAlt,galt);push(DX.temp,tmp);push(DX.press,prs);push(DX.volt,vlt);
  push(DX.ax,ax);push(DX.ay,ay);push(DX.az,az);push(DX.gx,gx);push(DX.gy,gy);push(DX.gz,gz);
  push(DX.spd,spd);push(DX.sats,sat);push(DX.state,ss);push(DX.pkt,pk);DX.raw.push(line);
  xbPktCnt++; if(alt>xbMaxAlt)xbMaxAlt=alt;

  if(elX.alt){elX.alt.textContent=alt.toFixed(1);elX.malt.textContent=xbMaxAlt.toFixed(1);}
  if(elX.prs)elX.prs.textContent=Math.round(prs);
  if(elX.vlt)elX.vlt.textContent=vlt.toFixed(2);
  if(elX.tmp)elX.tmp.textContent=tmp.toFixed(1);
  if(elX.pk)elX.pk.textContent=xbPktCnt;
  if(elX.sat)elX.sat.textContent=sat;
  if(elX.gtime)elX.gtime.textContent=gt||'--';
  if(elX.lat){elX.lat.textContent=lat.toFixed(4);elX.lon.textContent=lon.toFixed(4);}
  if(elX.galt)elX.galt.textContent=galt.toFixed(1);
  if(elX.vax){elX.vax.textContent=ax.toFixed(2);elX.vay.textContent=ay.toFixed(2);elX.vaz.textContent=az.toFixed(2);}
  if(elX.vgx){elX.vgx.textContent=gx.toFixed(1);elX.vgy.textContent=gy.toFixed(1);elX.vgz.textContent=gz.toFixed(1);}
  if(sat>0){if(elX.gps){elX.gps.textContent=sat+' SATS';elX.gps.className='card-badge fix';}}
  else{if(elX.gps){elX.gps.textContent='NO FIX';elX.gps.className='card-badge';}}

  // Charts + 3D
  if(!xbCTmr)xbCTmr=setTimeout(()=>{xbCTmr=null;
    Plotly.update('xb-plot-altitude',{x:[DX.time],y:[DX.alt]},[0]);
    Plotly.update('xb-plot-velocity',{x:[DX.time],y:[DX.spd]},[0]);
    Plotly.update('xb-plot-accel',{x:[DX.time,DX.time,DX.time],y:[DX.ax,DX.ay,DX.az]},[0,1,2]);
    Plotly.update('xb-plot-gyro',{x:[DX.time,DX.time,DX.time],y:[DX.gx,DX.gy,DX.gz]},[0,1,2]);
    Plotly.update('xb-plot-temp',{x:[DX.time],y:[DX.temp]},[0]);
    Plotly.update('xb-plot-press',{x:[DX.time],y:[DX.press]},[0]);
    Plotly.update('xb-plot-voltage',{x:[DX.time],y:[DX.volt]},[0]);
    // 3D trajectory
    if(DX.lx.length>0)Plotly.update('xb-plot-3d',{x:[DX.lx],y:[DX.ly],z:[DX.alt]},[0]);
    // 3D orientation
    if(window.xbBaseX){
      const xbRx=rotX,xbRy=rotY,xbRz=rotZ; // shares gyro integration from LoRa parse
      // Use independent XBee gyro integration stored in xbRotX/Y/Z
    }
  },200);

  // Map
  if(!xbMTmr&&lat!==0)xbMTmr=setTimeout(()=>{xbMTmr=null;
    xbMarker.setLatLng([lat,lon]);xbPoly.addLatLng([lat,lon]);
    if(autoCenterXb&&xbPktCnt%10===0)xbMap.panTo([lat,lon]);},400);

  // Console log
  mlog(`📶 XBEE | ALT:${alt}m | RSSI:${xbeeRssi}dBm | LQI:${xbeeLqi} | GPS:${lat},${lon}`,'log-info');

  // Firebase — separate path for XBee data
  fbPush('rocket_xbee',{t:mt,alt,prs,tmp,vlt,lat,lon,galt,ax,ay,az,gx,gy,gz,st:ss,rssi:xbeeRssi,lqi:xbeeLqi});
}

// ── Source Badge Updater ──
function updateSourceBadge(src, rssi){
  const xb=$('xbee-badge'), lb=$('lora-badge');
  if(lb) lb.textContent=`📡 LORA ${loraRssi!==-999?loraRssi+'dBm':'—'}`;
  const xbeeFresh=Date.now()-xbeeLastPkt<5000;
  if(xb){
    xb.textContent=xbeeFresh?`📶 XBEE ${xbeeRssi}dBm`:'📶 XBEE —';
    xb.className=xbeeFresh?'source-badge source-xbee':'source-badge source-dim';
  }
}

// ── CAN-7U Data Store ──
const CS_STATES = ['IDLE','ACTIVE','DEPLOYED','LANDED'];
const CS = { time:[], alt:[], press:[], temp:[], ax:[], ay:[], az:[], lat:[], lon:[], sats:[], state:[], raw:[] };
let csPktCnt=0, csMap=null, csMarker=null, csPoly=null;

// CAN-7U DOM
const csel = {
  alt:$('cs-alt'), press:$('cs-press'), temp:$('cs-temp'),
  ax:$('cs-ax'), ay:$('cs-ay'), az:$('cs-az'),
  lat:$('cs-lat'), lon:$('cs-lon'), sats:$('cs-sats'), state:$('cs-state'),
  status:$('cansat-status'), panel:$('page-cansat')
};

function initCansatUI(){
  Plotly.newPlot('plot-cs-alt',[tr('Alt','#f59e0b')],{...PL,yaxis:{...PL.yaxis,title:{text:'m',font:{size:9}}}},PC);
  Plotly.newPlot('plot-cs-temp',[tr('Temp','#ef4444')],{...PL,yaxis:{...PL.yaxis,title:{text:'°C',font:{size:9}}}},PC);
  Plotly.newPlot('plot-cs-press',[tr('Press','#ec4899')],{...PL,yaxis:{...PL.yaxis,title:{text:'Pa',font:{size:9}}}},PC);
  Plotly.newPlot('plot-cs-accel',[tr('X','#ef4444'),tr('Y','#22c55e'),tr('Z','#38bdf8')],
    {...PL,showlegend:true,legend:{font:{size:9},x:1,xanchor:'right'},yaxis:{...PL.yaxis,title:{text:'m/s²',font:{size:9}}}},PC);
  csMap=L.map('map-cansat',{zoomControl:true}).setView([23.0225,72.5714],14);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'CARTO',maxZoom:19}).addTo(csMap);
  csMarker=L.circleMarker([0,0],{radius:6,color:'#f59e0b',fillColor:'#f59e0b',fillOpacity:.8}).addTo(csMap);
  csPoly=L.polyline([],{color:'#f59e0b',weight:2,opacity:.6}).addTo(csMap);

  const btn=$('btn-auto-center-cs');
  if(btn) btn.addEventListener('click',()=>{
    autoCenterCs=!autoCenterCs;
    btn.textContent=autoCenterCs?'🎯 AUTO: ON':'🎯 AUTO: OFF';
    btn.classList.toggle('active',autoCenterCs);
    btn.style.color=autoCenterCs?'var(--amber)':'var(--text-muted)';
    btn.style.borderColor=autoCenterCs?'var(--amber)':'var(--border)';
    if(autoCenterCs&&CS.lat.length) csMap.panTo([CS.lat[CS.lat.length-1],CS.lon[CS.lon.length-1]]);
  });
}

// CAN-7U Parser: TEAM_ID,TIME,PKT_CNT,ALT,PRESS,TEMP,ACCEL_X;Y;Z,LAT,LON,SATS,STATE
function parseCansat(line){
  line=line.trim(); if(!line)return;
  const f=line.split(','); if(f.length<11)return;
  const mt=+f[1]||0, alt=+f[3]||0, prs=+f[4]||0, tmp=+f[5]||0;
  let ax=0,ay=0,az=0; if(f[6]){const p=f[6].split(';');ax=+p[0]||0;ay=+p[1]||0;az=+p[2]||0;}
  const lat=+f[7]||0, lon=+f[8]||0, sat=+f[9]||0, ss=(f[10]||'').trim();
  const push=(a,v)=>{a.push(v);if(a.length>CFG.MAX)a.shift();};
  push(CS.time,mt);push(CS.alt,alt);push(CS.press,prs);push(CS.temp,tmp);
  push(CS.ax,ax);push(CS.ay,ay);push(CS.az,az);
  push(CS.lat,lat);push(CS.lon,lon);push(CS.sats,sat);push(CS.state,ss);CS.raw.push(line);
  csPktCnt++;
  // Update UI
  csel.alt.textContent=alt.toFixed(1);csel.press.textContent=Math.round(prs);
  csel.temp.textContent=tmp.toFixed(1);
  csel.ax.textContent=ax.toFixed(2);csel.ay.textContent=ay.toFixed(2);csel.az.textContent=az.toFixed(2);
  csel.lat.textContent=lat.toFixed(4);csel.lon.textContent=lon.toFixed(4);
  csel.sats.textContent=sat;csel.state.textContent=ss;
  csel.status.textContent='ACTIVE';csel.status.className='card-badge fix';
  // Chart + Map
  Plotly.update('plot-cs-alt',{x:[CS.time],y:[CS.alt]},[0]);
  Plotly.update('plot-cs-temp',{x:[CS.time],y:[CS.temp]},[0]);
  Plotly.update('plot-cs-press',{x:[CS.time],y:[CS.press]},[0]);
  Plotly.update('plot-cs-accel',{x:[CS.time,CS.time,CS.time],y:[CS.ax,CS.ay,CS.az]},[0,1,2]);
  if(lat!==0){csMarker.setLatLng([lat,lon]);csPoly.addLatLng([lat,lon]);if(autoCenterCs&&csPktCnt%5===0)csMap.panTo([lat,lon]);}
  // Console
  mlog(`🛰 CAN-7U PKT | ALT:${alt}m | TEMP:${tmp}°C | GPS:${lat},${lon} | ${ss}`,'log-warn');
  // Firebase sync
  fbPush('cansat',{t:mt,alt,prs,tmp,ax,ay,az,lat,lon,sat,st:ss});
}

// ── WebSocket Connection ──
let ws=null;
const WS_URL='ws://192.168.4.1:81'; // ESP32 AP default

function setConn(on){conn=on;const d=el.badge.querySelector('.dot'),s=el.badge.querySelector('span:last-child');
  if(on){el.badge.classList.add('connected');d.classList.add('online');s.textContent='CONNECTED';el.btnConn.textContent='Disconnect';}
  else{el.badge.classList.remove('connected');d.classList.remove('online');s.textContent='DISCONNECTED';el.btnConn.textContent='Connect GCS';}}

function wsConnect(){
  if(ws&&ws.readyState<=1){mlog('Already connected','log-warn');return;}
  const url=prompt('ESP32 WebSocket URL:',WS_URL);if(!url)return;
  mlog(`Connecting to ${url}...`,'log-info');
  ws=new WebSocket(url);
  ws.onopen=()=>{setConn(true);mlog(`WebSocket connected: ${url}`,'log-ok');};
  ws.onclose=()=>{setConn(false);mlog('WebSocket closed','log-warn');ws=null;};
  ws.onerror=(e)=>{mlog('WebSocket error','log-err');};
  ws.onmessage=(e)=>{
    try{
      const msg=JSON.parse(e.data);
      // Three data sources: LoRa rocket, XBee rocket, LoRa CAN-7U
      if(msg.type==='ROCKET_LORA'||msg.type==='ROCKET'){
        loraRssi=msg.rssi||-999;
        updateSourceBadge('LORA',loraRssi);
        parse(msg.data);
      } else if(msg.type==='ROCKET_XBEE'){
        xbeeRssi=msg.rssi||-999;
        xbeeLqi=msg.lqi||0;
        xbeeLastPkt=Date.now();
        updateSourceBadge('XBEE',xbeeRssi);
        parseXbee(msg.data);
      } else if(msg.type==='CANSAT'){
        parseCansat(msg.data);
      } else if(msg.type==='STATUS'){
        loraRssi=msg.rssi_lora_rocket||-999;
        xbeeRssi=msg.rssi_xbee||-999;
        mlog(`ESP32 STATUS | LoRa-R RSSI:${loraRssi} | XBee RSSI:${xbeeRssi} | LoRa-C RSSI:${msg.rssi_lora_cansat}`,'log-info');
      }
    }catch(err){
      parse(e.data); // fallback: raw LoRa line
    }
  };
}

function wsDisconnect(){if(ws){ws.close();ws=null;}setConn(false);}

function wsSend(target,cmd){
  if(!ws||ws.readyState!==1){el.clog.textContent='NOT CONNECTED';mlog('CMD fail: no WebSocket','log-err');return;}
  const msg=JSON.stringify({type:'CMD',target,cmd});
  ws.send(msg);el.clog.textContent='TX: '+cmd;mlog(`CMD → ${target}: ${cmd}`,'log-cmd');
}

// ── Firebase Cloud Sync (for viewer dashboard) ──
let fbDb=null;
const FB_CFG={apiKey:"AIzaSyBD5gFn07sDou65IOKpWF4GaYOg9HFkdpM",authDomain:"inspace-f7015.firebaseapp.com",
  databaseURL:"https://inspace-f7015-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"inspace-f7015",
  storageBucket:"inspace-f7015.firebasestorage.app",messagingSenderId:"165221397818",
  appId:"1:165221397818:web:7f63b7ec0336418e728c03"};

function fbInit(){
  const fbBadge=$('firebase-badge');
  try{
    if(typeof firebase!=='undefined'){
      firebase.initializeApp(FB_CFG);fbDb=firebase.database();
      // Monitor connection state
      fbDb.ref('.info/connected').on('value',snap=>{
        if(snap.val()===true){
          fbBadge.textContent='🔥 FIREBASE CONNECTED';fbBadge.classList.add('connected');
          mlog('Firebase cloud sync connected','log-ok');
        } else {
          fbBadge.textContent='🔥 FIREBASE OFFLINE';fbBadge.classList.remove('connected');
        }
      });
    } else { mlog('Firebase SDK not loaded','log-info'); }
  }catch(e){mlog('Firebase init skipped: '+e.message,'log-info');}
}

function fbPush(channel,data){
  if(!fbDb)return;
  try{fbDb.ref(`gcs/${CFG.TEAM||'default'}/${channel}`).push({...data,ts:Date.now()});}catch(e){}
}

// ── CSV Export ──
function exportCSV(){if(D.raw.length===0){mlog('No rocket data','log-warn');return;}
  const h='TEAM_ID,TIME,PKT_CNT,ALT,PRESS,TEMP,VOLT,GNSS_TIME,LAT,LON,GNSS_ALT,SATS,ACCEL,GYRO,STATE,OPTIONAL\n';
  const b=new Blob([h+D.raw.join('\n')],{type:'text/csv'});const a=document.createElement('a');
  a.href=URL.createObjectURL(b);a.download=`Flight_${CFG.TEAM||'UNKNOWN'}.csv`;a.click();
  URL.revokeObjectURL(a.href);mlog('Exported: '+a.download,'log-ok');
  // Also export CAN-7U if data exists
  if(CS.raw.length>0){
    const ch='TEAM_ID,TIME,PKT_CNT,ALT,PRESS,TEMP,ACCEL,LAT,LON,SATS,STATE\n';
    const cb=new Blob([ch+CS.raw.join('\n')],{type:'text/csv'});const ca=document.createElement('a');
    ca.href=URL.createObjectURL(cb);ca.download=`CAN7U_${CFG.TEAM||'UNKNOWN'}.csv`;ca.click();
    URL.revokeObjectURL(ca.href);mlog('Exported: '+ca.download,'log-ok');
  }
}

// ── Demo Mode (80s, all 8 states + CAN-7U) ──
function startDemo(){if(conn||D.raw.length>0)return;
  mlog('════════ DEMO FLIGHT SEQUENCE ════════','log-warn');setConn(true);
  switchTab('rocket');

  // Reset variables and clear past flight telemetry
  t0 = Date.now();
  maxAlt = 0;
  xbMaxAlt = 0;
  pktCnt = 0;
  xbPktCnt = 0;
  csPktCnt = 0;
  lLat = null;
  lLon = null;
  xbLLat = null;
  xbLLon = null;
  rotX = 0;
  rotY = 0;
  rotZ = 0;
  lastT = null;
  xbLastT = null;

  // Clear data arrays
  for(const k in D) { if(Array.isArray(D[k])) D[k].length = 0; }
  for(const k in DX) { if(Array.isArray(DX[k])) DX[k].length = 0; }
  for(const k in CS) { if(Array.isArray(CS[k])) CS[k].length = 0; }

  const tm='2026INSPACE-042', bLat=23.0225, bLon=72.5714, apo=980;
  let t=0;

  // Reset maps and markers
  if(poly) poly.setLatLngs([]);
  if(xbPoly) xbPoly.setLatLngs([]);
  if(csPoly) csPoly.setLatLngs([]);
  if(marker) marker.setLatLng([bLat, bLon]);
  if(xbMarker) xbMarker.setLatLng([bLat, bLon]);
  if(csMarker) csMarker.setLatLng([bLat, bLon]);
  if(map) map.setView([bLat, bLon], 14);
  if(xbMap) xbMap.setView([bLat, bLon], 14);
  if(csMap) csMap.setView([bLat, bLon], 14);

  // Clear charts to avoid ghost lines
  if(D.time) {
    Plotly.update('plot-altitude',{x:[[]],y:[[]]},[0]);
    Plotly.update('plot-velocity',{x:[[]],y:[[]]},[0]);
    Plotly.update('plot-accel',{x:[[],[],[]],y:[[],[],[]]},[0,1,2]);
    Plotly.update('plot-gyro',{x:[[],[],[]],y:[[],[],[]]},[0,1,2]);
    Plotly.update('plot-temp',{x:[[]],y:[[]]},[0]);
    Plotly.update('plot-press',{x:[[]],y:[[]]},[0]);
    Plotly.update('plot-voltage',{x:[[]],y:[[]]},[0]);
    Plotly.update('plot-3d',{x:[[]],y:[[]],z:[[]]},[0]);
  }
  if(DX.time) {
    Plotly.update('xb-plot-altitude',{x:[[]],y:[[]]},[0]);
    Plotly.update('xb-plot-velocity',{x:[[]],y:[[]]},[0]);
    Plotly.update('xb-plot-accel',{x:[[],[],[]],y:[[],[],[]]},[0,1,2]);
    Plotly.update('xb-plot-gyro',{x:[[],[],[]],y:[[],[],[]]},[0,1,2]);
    Plotly.update('xb-plot-temp',{x:[[]],y:[[]]},[0]);
    Plotly.update('xb-plot-press',{x:[[]],y:[[]]},[0]);
    Plotly.update('xb-plot-voltage',{x:[[]],y:[[]]},[0]);
    Plotly.update('xb-plot-3d',{x:[[]],y:[[]],z:[[]]},[0]);
  }
  if(CS.time) {
    Plotly.update('plot-cs-alt',{x:[[]],y:[[]]},[0]);
    Plotly.update('plot-cs-temp',{x:[[]],y:[[]]},[0]);
    Plotly.update('plot-cs-press',{x:[[]],y:[[]]},[0]);
    Plotly.update('plot-cs-accel',{x:[[],[],[]],y:[[],[],[]]},[0,1,2]);
  }

  const noise = (scale) => (Math.random() - 0.5) * scale;

  const iv=setInterval(()=>{
    t = Math.round((t + 0.2) * 10) / 10;
    const p = t / 80;

    // Boundary conditions
    if(p > 1.0) {
      clearInterval(iv);
      mlog(`Peak (LoRa/XBee): ${maxAlt.toFixed(1)}m | Pkts (LoRa): ${pktCnt} | Pkts (XBee): ${xbPktCnt} | Pkts (CanSat): ${csPktCnt}`,'log-ok');
      return;
    }

    // Determine states
    let st, csSt;
    if (p < 0.03) { st = 'BOOT'; csSt = 'IDLE'; }
    else if (p < 0.06) { st = 'TEST_MODE'; csSt = 'IDLE'; }
    else if (p < 0.09) { st = 'LAUNCH_PAD'; csSt = 'ACTIVE'; if(t === 7.2) mlog('T-0 IGNITION','log-warn'); }
    else if (p < 0.45) { st = 'ASCENT'; csSt = 'ACTIVE'; }
    else if (p < 0.52) { st = 'PAYLOAD_SEP'; csSt = 'DEPLOYED'; if(t === 36.0) mlog('APOGEE — PAYLOAD SEP','log-ok'); }
    else if (p < 0.82) { st = 'DESCENT'; csSt = 'DEPLOYED'; }
    else if (p < 0.96) { st = 'AEROBREAK'; csSt = 'DEPLOYED'; if(t === 65.6) mlog('AEROBREAK DEPLOY','log-ok'); }
    else { st = 'IMPACT'; csSt = 'LANDED'; if(t === 76.8) mlog('════ IMPACT — MISSION COMPLETE ════','log-warn'); }

    // GNSS Time
    const hh = String(14 + Math.floor((20 + Math.floor(t)) / 60)).padStart(2, '0');
    const mm = String((20 + Math.floor(t)) % 60).padStart(2, '0');
    const ss = String(Math.floor(t) % 60).padStart(2, '0');
    const gt = `${hh}:${mm}:${ss}`;

    // Packet counts and GPS Sats
    const pk = Math.floor(t * 5);
    const s = (st === 'BOOT' || st === 'TEST_MODE') ? 0 : (12 + Math.floor(Math.random() * 2));
    const csS = (st === 'BOOT' || st === 'TEST_MODE') ? 0 : (10 + Math.floor(Math.random() * 2));

    // Positions and sensor readings
    let alt, csAlt;
    let la, lo, csLa, csLo;
    let ax, ay, az, csAx, csAy, csAz;
    let gx, gy, gz, csGx, csGy, csGz;

    // Launch coordinates
    const la_launch = bLat;
    const lo_launch = bLon;

    // Apogee coordinates (at t = 36.0s, delta_t = 26.0s)
    const la_apogee = bLat + 26.0 * 0.00002;
    const lo_apogee = bLon + 26.0 * 0.00001;

    if (t <= 36.0) {
      // Rocket and CanSat match exactly before/at apogee
      if (t < 10.0) {
        alt = 0.0;
        la = la_launch.toFixed(6);
        lo = lo_launch.toFixed(6);
        ax = noise(0.04);
        ay = noise(0.04);
        az = 9.81 + noise(0.04);
        gx = noise(0.1);
        gy = noise(0.1);
        gz = noise(0.1);
      } else {
        // Ascent phase (10s to 36s)
        const tau = (t - 10.0) / 26.0;
        alt = apo * Math.pow(Math.sin(tau * Math.PI / 2), 2);
        la = (la_launch + (t - 10.0) * 0.00002).toFixed(6);
        lo = (lo_launch + (t - 10.0) * 0.00001).toFixed(6);

        const t_asc = t - 10.0;
        if (t_asc < 4.0) {
          az = 9.81 + 25.0 + (t_asc / 4.0) * 10.0 + noise(1.0); // burn
        } else {
          az = 9.81 - 12.0 * Math.exp(-(t_asc - 4.0) / 10.0) + noise(0.3); // coast
        }
        ax = noise(0.4);
        ay = noise(0.4);
        gz = 240.0 * Math.exp(-t_asc / 6.0) + noise(4.0);
        gx = Math.sin(t * 3.0) * 20.0 * Math.exp(-t_asc / 12.0) + noise(0.8);
        gy = Math.cos(t * 2.5) * 20.0 * Math.exp(-t_asc / 12.0) + noise(0.8);
      }

      csAlt = alt;
      csLa = la;
      csLo = lo;
      csAx = ax;
      csAy = ay;
      csAz = az;
      csGx = gx;
      csGy = gy;
      csGz = gz;
    } else {
      // Rocket and CanSat values differ after apogee
      // 1. Rocket Descent
      if (t < 65.6) {
        alt = Math.max(0.0, apo - (t - 36.0) * 28.0); // Drogue descent
      } else if (t < 76.8) {
        alt = Math.max(0.0, 150.0 - (t - 65.6) * 13.4); // Aerobreak descent
      } else {
        alt = 0.0; // Impact
      }

      // Rocket GPS Drift
      if (t < 76.8) {
        la = (la_apogee + (t - 36.0) * 0.00003).toFixed(6);
        lo = (lo_apogee + (t - 36.0) * 0.000015).toFixed(6);
      } else {
        la = (la_apogee + 40.8 * 0.00003).toFixed(6);
        lo = (lo_apogee + 40.8 * 0.000015).toFixed(6);
      }

      // Rocket Sensors
      if (st === 'IMPACT') {
        ax = noise(0.02);
        ay = 9.81 + noise(0.02);
        az = noise(0.02);
        gx = noise(0.1);
        gy = noise(0.1);
        gz = noise(0.1);
      } else {
        if (t === 36.2) {
          az = 9.81 + 18.0 + noise(1.0); // Ejection/Parachute shock
        } else {
          az = 9.81 + Math.sin(t * 2.5) * 1.5 + noise(0.1);
        }
        ax = Math.cos(t * 2.0) * 1.0 + noise(0.1);
        ay = Math.sin(t * 1.8) * 1.0 + noise(0.1);
        gx = Math.sin(t * 1.5) * 12.0 + noise(0.5);
        gy = Math.cos(t * 1.2) * 12.0 + noise(0.5);
        gz = Math.sin(t * 0.5) * 5.0 + noise(0.2);
      }

      // 2. CanSat Descent (Diverged!)
      if (t < 76.8) {
        csAlt = apo * Math.pow(1 - (t - 36.0) / 40.8, 1.2);
        csLa = (la_apogee - (t - 36.0) * 0.00001).toFixed(6);
        csLo = (lo_apogee + (t - 36.0) * 0.00004).toFixed(6);
      } else {
        csAlt = 0.0;
        csLa = (la_apogee - 40.8 * 0.00001).toFixed(6);
        csLo = (lo_apogee + 40.8 * 0.00004).toFixed(6);
      }

      // CanSat Sensors
      if (csSt === 'LANDED') {
        csAx = 9.81 + noise(0.02);
        csAy = noise(0.02);
        csAz = noise(0.02);
        csGx = noise(0.1);
        csGy = noise(0.1);
        csGz = noise(0.1);
      } else {
        if (t === 36.2) {
          csAx = 12.0 + noise(1.0);
          csAy = 12.0 + noise(1.0);
          csAz = 9.81 + 15.0 + noise(1.0);
        } else {
          csAx = Math.cos(t * 2.2) * 0.5 + noise(0.05);
          csAy = Math.sin(t * 2.0) * 0.5 + noise(0.05);
          csAz = 9.81 + Math.sin(t * 3.0) * 0.8 + noise(0.05);
        }
        csGx = Math.sin(t * 2.0) * 8.0 + noise(0.3);
        csGy = Math.cos(t * 1.7) * 8.0 + noise(0.3);
        csGz = 15.0 + Math.sin(t * 0.8) * 5.0 + noise(0.5);
      }
    }

    // Common telemetry variables derived from altitude
    const pr = 101325 * Math.pow(1 - 0.0000225 * alt, 5.25) + noise(8);
    const tp = (28.0 - alt * 0.0065 + noise(0.15)).toFixed(1);
    const vl = (8.24 - Math.min(66.8, Math.max(0, t - 10)) * 0.004 + noise(0.01)).toFixed(2);

    const csPr = 101325 * Math.pow(1 - 0.0000225 * csAlt, 5.25) + noise(10);
    const csTp = (27.5 - csAlt * 0.0065 + noise(0.2)).toFixed(1);

    // Simulate link RSSI and GCS source badges
    loraRssi = -70 - Math.floor(Math.random() * 15);
    xbeeRssi = -65 - Math.floor(Math.random() * 15);
    xbeeLqi = 220 + Math.floor(Math.random() * 30);
    xbeeLastPkt = Date.now();
    updateSourceBadge('LORA', loraRssi);
    updateSourceBadge('XBEE', xbeeRssi);

    // Rocket packets (identical for LoRa and XBee)
    const rocketCsv = `${tm},${t.toFixed(1)},${pk},${alt.toFixed(1)},${Math.round(pr)},${tp},${vl},${gt},${la},${lo},${Math.round(alt)},${s},${ax.toFixed(2)};${ay.toFixed(2)};${az.toFixed(2)},${gx.toFixed(1)};${gy.toFixed(1)};${gz.toFixed(1)},${st},OK`;
    parse(rocketCsv);
    parseXbee(rocketCsv);

    // CanSat packet
    const cansatCsv = `${tm},${t.toFixed(1)},${pk},${csAlt.toFixed(1)},${Math.round(csPr)},${csTp},${csAx.toFixed(2)};${csAy.toFixed(2)};${csAz.toFixed(2)},${csLa},${csLo},${csS},${csSt}`;
    parseCansat(cansatCsv);

  }, 200);
}

// ── Command Console Input ──
const cmdInput=$('cmd-input'), cmdTarget=$('cmd-target'), btnSendCmd=$('btn-send-cmd');
function sendConsoleCmd(){
  const cmd=cmdInput.value.trim();if(!cmd)return;
  const target=cmdTarget.value;
  wsSend(target,cmd);cmdInput.value='';
}
btnSendCmd.addEventListener('click',sendConsoleCmd);
cmdInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendConsoleCmd();});

// ── Events ──
el.btnConn.addEventListener('click',()=>{conn?wsDisconnect():wsConnect();});
el.btnCsv.addEventListener('click',exportCSV);
el.btnStart.addEventListener('click',()=>wsSend('ROCKET','CMD,START_TM'));
el.btnStop.addEventListener('click',()=>wsSend('ROCKET','CMD,STOP_TM'));
el.btnArm.addEventListener('click',()=>{if(confirm('ARM the rocket?'))wsSend('ROCKET','CMD,ARM_ROCKET');});
el.btnZero.addEventListener('click',()=>wsSend('ROCKET','CMD,ZERO_ALT'));
$('btn-cansat-start').addEventListener('click',()=>wsSend('CANSAT','CMD,CANSAT_START'));
$('btn-cansat-stop').addEventListener('click',()=>wsSend('CANSAT','CMD,CANSAT_STOP'));

// ── Tab Switching ──
function switchTab(tab){
  ['rocket','xbee','cansat'].forEach(t=>{
    document.getElementById('page-'+t).classList.toggle('hidden',t!==tab);
    document.getElementById('tab-'+t).classList.toggle('active',t===tab);
  });
  if(tab==='cansat')setTimeout(()=>{csMap.invalidateSize();},200);
  if(tab==='rocket')setTimeout(()=>{map.invalidateSize();},200);
  if(tab==='xbee')setTimeout(()=>{xbMap&&xbMap.invalidateSize();},200);
}
window.switchTab=switchTab;
setInterval(()=>{const r=rateCnt;rateCnt=0;if(el.rate)el.rate.textContent=r+' pkt/s';},1000);
document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='d' && e.shiftKey)startDemo();});

// ── Init ──
document.addEventListener('DOMContentLoaded',()=>{initMap();initCharts();initCansatUI();initXbeeUI();fbInit();
  mlog('IN-SPACe 2026 GCS v3.0 — LoRa + XBee + CAN-7U + Firebase','log-ok');
  mlog('Tabs: 🚀 ROCKET (LoRa) | 📶 ROCKET (XBee) | 🛰 CAN-7U','log-info');
  mlog('Press [Shift+D] for demo simulation','log-info');
  mlog('Click Connect GCS to link to ESP32','log-info');
});
