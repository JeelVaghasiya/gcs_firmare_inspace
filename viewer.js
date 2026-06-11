/* IN-SPACe 2026 — View-Only Dashboard (reads from Firebase RTDB) */
const FB_CFG={apiKey:"AIzaSyBD5gFn07sDou65IOKpWF4GaYOg9HFkdpM",authDomain:"inspace-f7015.firebaseapp.com",
  databaseURL:"https://inspace-f7015-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"inspace-f7015",
  storageBucket:"inspace-f7015.firebasestorage.app",messagingSenderId:"165221397818",
  appId:"1:165221397818:web:7f63b7ec0336418e728c03"};

firebase.initializeApp(FB_CFG);
const db=firebase.database();

const $=id=>document.getElementById(id);
const STATES=['BOOT','TEST_MODE','LAUNCH_PAD','ASCENT','PAYLOAD_SEP','DESCENT','AEROBREAK','IMPACT'];

// Data stores
const D={time:[],alt:[],spd:[],temp:[],press:[],volt:[],ax:[],ay:[],az:[],gx:[],gy:[],gz:[],lx:[],ly:[]};
const CS={time:[],alt:[],temp:[],press:[],ax:[],ay:[],az:[]};
let maxAlt=0,pktCnt=0,map,marker,poly,csMap,csMarker,csPoly,xbMap,xbMarker,xbPoly;
let lLat=null,lLon=null;
let rotX=0,rotY=0,rotZ=0,lastT=null;
let autoCenter=true,autoCenterCs=true,autoCenterXb=true;
let baseX=[],baseY=[],baseZ=[];

// Plotly config
const PL={paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',
  font:{color:'#6b7280',size:10,family:'JetBrains Mono'},margin:{t:8,b:30,l:42,r:10},
  xaxis:{gridcolor:'rgba(56,189,248,0.06)',zeroline:false,title:{text:'Time (s)',font:{size:9}}},
  yaxis:{gridcolor:'rgba(56,189,248,0.06)',zeroline:false},showlegend:false,hovermode:'x unified'};
const PC={displayModeBar:true,responsive:true,scrollZoom:true,
  modeBarButtonsToAdd:['resetScale2d'],modeBarButtonsToRemove:['lasso2d','select2d']};
function tr(n,c){return{x:[],y:[],name:n,mode:'lines',line:{color:c,width:1.5,shape:'spline'}};}

// Console logger
function mlog(m,c='log-info'){const con=$('console-output');if(!con)return;
  const d=document.createElement('div');d.className=c;
  d.textContent=`[${new Date().toLocaleTimeString('en-GB')}] ${m}`;
  con.appendChild(d);con.scrollTop=con.scrollHeight;
  if(con.children.length>500)con.removeChild(con.firstChild);}

// ── Init Maps + Charts ──
function initMaps(){
  map=L.map('map',{zoomControl:true,scrollWheelZoom:true}).setView([23.0225,72.5714],14);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'CARTO',maxZoom:19}).addTo(map);
  marker=L.circleMarker([0,0],{radius:6,color:'#38bdf8',fillColor:'#38bdf8',fillOpacity:.8}).addTo(map);
  poly=L.polyline([],{color:'#38bdf8',weight:2,opacity:.6}).addTo(map);

  const btn=$('btn-auto-center');
  if(btn) btn.addEventListener('click',()=>{
    autoCenter=!autoCenter;
    btn.textContent=autoCenter?'🎯 AUTO: ON':'🎯 AUTO: OFF';
    btn.classList.toggle('active',autoCenter);
    btn.style.color=autoCenter?'var(--cyan)':'var(--text-muted)';
    btn.style.borderColor=autoCenter?'var(--cyan)':'var(--border)';
    if(autoCenter&&D.lat&&D.lat.length) map.panTo([D.lat[D.lat.length-1],D.lon[D.lon.length-1]]);
  });

  csMap=L.map('map-cansat',{zoomControl:true}).setView([23.0225,72.5714],14);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'CARTO',maxZoom:19}).addTo(csMap);
  csMarker=L.circleMarker([0,0],{radius:6,color:'#f59e0b',fillColor:'#f59e0b',fillOpacity:.8}).addTo(csMap);
  csPoly=L.polyline([],{color:'#f59e0b',weight:2,opacity:.6}).addTo(csMap);

  const btnCs=$('btn-auto-center-cs');
  if(btnCs) btnCs.addEventListener('click',()=>{
    autoCenterCs=!autoCenterCs;
    btnCs.textContent=autoCenterCs?'🎯 AUTO: ON':'🎯 AUTO: OFF';
    btnCs.classList.toggle('active',autoCenterCs);
    btnCs.style.color=autoCenterCs?'var(--amber)':'var(--text-muted)';
    btnCs.style.borderColor=autoCenterCs?'var(--amber)':'var(--border)';
    if(autoCenterCs&&CS.lat&&CS.lat.length) csMap.panTo([CS.lat[CS.lat.length-1],CS.lon[CS.lon.length-1]]);
  });

  // XBee map (purple)
  xbMap=L.map('map-xbee',{zoomControl:true}).setView([23.0225,72.5714],14);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'CARTO',maxZoom:19}).addTo(xbMap);
  xbMarker=L.circleMarker([0,0],{radius:6,color:'#a855f7',fillColor:'#a855f7',fillOpacity:.8}).addTo(xbMap);
  xbPoly=L.polyline([],{color:'#a855f7',weight:2,opacity:.6}).addTo(xbMap);

  const btnXb=$('btn-auto-center-xb');
  if(btnXb) btnXb.addEventListener('click',()=>{
    autoCenterXb=!autoCenterXb;
    btnXb.textContent=autoCenterXb?'🎯 AUTO: ON':'🎯 AUTO: OFF';
    btnXb.classList.toggle('active',autoCenterXb);
    btnXb.style.color=autoCenterXb?'#a855f7':'var(--text-muted)';
    btnXb.style.borderColor=autoCenterXb?'#a855f7':'var(--border)';
  });
}

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
    {paper_bgcolor:'rgba(0,0,0,0)',scene:{xaxis:{title:'East (m)'},yaxis:{title:'North (m)'},
      zaxis:{title:'Alt (m)'},bgcolor:'rgba(0,0,0,0)'},margin:{t:0,b:0,l:0,r:0},font:{color:'#6b7280',size:9}},PC);
  // 3D Rocket model
  const h=2,r=.3,seg=12;baseX=[];baseY=[];baseZ=[];
  for(let i=0;i<=seg;i++){const a=2*Math.PI*i/seg;
    baseX.push(r*Math.cos(a),r*Math.cos(a),0);baseY.push(r*Math.sin(a),r*Math.sin(a),0);baseZ.push(-h/2,h/2,h/2+.5);}
  Plotly.newPlot('plot-3d-gyro',[{x:[...baseX],y:[...baseY],z:[...baseZ],type:'mesh3d',
    color:'#38bdf8',opacity:.7,flatshading:true}],
    {paper_bgcolor:'rgba(0,0,0,0)',scene:{xaxis:{range:[-3,3],title:''},yaxis:{range:[-3,3],title:''},
      zaxis:{range:[-3,3],title:''},bgcolor:'rgba(0,0,0,0)',
      camera:{eye:{x:1.5,y:1.5,z:1}}},margin:{t:0,b:0,l:0,r:0}},PC);
  // CAN-7U charts
  Plotly.newPlot('plot-cs-alt',[tr('Alt','#f59e0b')],{...PL,yaxis:{...PL.yaxis,title:{text:'m',font:{size:9}}}},PC);
  Plotly.newPlot('plot-cs-temp',[tr('Temp','#ef4444')],{...PL,yaxis:{...PL.yaxis,title:{text:'°C',font:{size:9}}}},PC);
  Plotly.newPlot('plot-cs-press',[tr('Press','#ec4899')],{...PL,yaxis:{...PL.yaxis,title:{text:'Pa',font:{size:9}}}},PC);
  Plotly.newPlot('plot-cs-accel',[tr('X','#ef4444'),tr('Y','#22c55e'),tr('Z','#38bdf8')],
    {...PL,showlegend:true,legend:{font:{size:9},x:1,xanchor:'right'},yaxis:{...PL.yaxis,title:{text:'m/s²',font:{size:9}}}},PC);
  // XBee charts (purple theme)
  const trX=(n,c)=>({x:[],y:[],name:n,mode:'lines',line:{color:c,width:1.5,shape:'spline'}});
  Plotly.newPlot('xb-plot-altitude',[trX('Alt','#a855f7')],{...PL,yaxis:{...PL.yaxis,title:{text:'m',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-velocity',[trX('Vel','#c084fc')],{...PL,yaxis:{...PL.yaxis,title:{text:'m/s',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-accel',[trX('X','#ef4444'),trX('Y','#22c55e'),trX('Z','#a855f7')],
    {...PL,showlegend:true,legend:{font:{size:9},x:1,xanchor:'right'},yaxis:{...PL.yaxis,title:{text:'m/s²',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-gyro',[trX('X','#ef4444'),trX('Y','#22c55e'),trX('Z','#a855f7')],
    {...PL,showlegend:true,legend:{font:{size:9},x:1,xanchor:'right'},yaxis:{...PL.yaxis,title:{text:'°/s',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-temp',[trX('Temp','#f97316')],{...PL,yaxis:{...PL.yaxis,title:{text:'°C',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-press',[trX('Press','#ec4899')],{...PL,yaxis:{...PL.yaxis,title:{text:'Pa',font:{size:9}}}},PC);
  Plotly.newPlot('xb-plot-voltage',[trX('V','#a855f7')],{...PL,yaxis:{...PL.yaxis,title:{text:'V',font:{size:9}}}},PC);
  // XBee 3D Trajectory (purple)
  Plotly.newPlot('xb-plot-3d',[{x:[],y:[],z:[],type:'scatter3d',mode:'lines+markers',
    marker:{size:2,color:'#a855f7'},line:{color:'#a855f7',width:3}}],
    {paper_bgcolor:'rgba(0,0,0,0)',scene:{xaxis:{title:'East(m)',gridcolor:'#111',color:'#555'},
      yaxis:{title:'North(m)',gridcolor:'#111',color:'#555'},
      zaxis:{title:'Alt(m)',gridcolor:'#111',color:'#555'},bgcolor:'rgba(0,0,0,0)'},
    margin:{t:0,b:0,l:0,r:0},font:{color:'#6b7280',size:9}},PC);
  // XBee 3D Orientation
  const xbH=4,xbR=.3,xbN=12;const xbXr=[],xbYr=[],xbZr=[],xbI=[],xbJ=[],xbK=[];
  for(let i=0;i<=xbN;i++){const a=(i/xbN)*2*Math.PI;
    xbXr.push(xbR*Math.cos(a));xbYr.push(xbR*Math.sin(a));xbZr.push(0);
    xbXr.push(xbR*Math.cos(a));xbYr.push(xbR*Math.sin(a));xbZr.push(xbH*.7);}
  for(let i=0;i<xbN;i++){const b=i*2,t=b+1;xbI.push(b);xbJ.push(t);xbK.push(b+2);xbI.push(t);xbJ.push(t+2);xbK.push(b+2);}
  const xbTip=xbXr.length;xbXr.push(0);xbYr.push(0);xbZr.push(xbH);
  for(let i=0;i<xbN;i++){xbI.push(i*2+1);xbJ.push(((i+1)%xbN)*2+1);xbK.push(xbTip);}
  window.xbRocketX=[...xbXr];window.xbRocketY=[...xbYr];window.xbRocketZ=[...xbZr];
  Plotly.newPlot('xb-plot-3d-gyro',[{type:'mesh3d',x:xbXr,y:xbYr,z:xbZr,i:xbI,j:xbJ,k:xbK,
    color:'#a855f7',opacity:.85,flatshading:true}],
    {paper_bgcolor:'rgba(0,0,0,0)',scene:{xaxis:{range:[-4,4],gridcolor:'#1a1a2e',color:'#555',title:''},
      yaxis:{range:[-4,4],gridcolor:'#1a1a2e',color:'#555',title:''},
      zaxis:{range:[-2,5],gridcolor:'#1a1a2e',color:'#555',title:''},
      bgcolor:'rgba(0,0,0,0)',camera:{eye:{x:1.8,y:1.8,z:1.0}}},margin:{t:0,b:0,l:0,r:0}},PC);
}

// ── 3D Rocket rotation ──
function rotateRocket(){
  const cx=Math.cos(rotX),sx=Math.sin(rotX),cy=Math.cos(rotY),sy=Math.sin(rotY),cz=Math.cos(rotZ),sz=Math.sin(rotZ);
  const nx=[],ny=[],nz=[];
  for(let i=0;i<baseX.length;i++){
    const x=baseX[i],y=baseY[i],z=baseZ[i];
    const y1=cx*y-sx*z,z1=sx*y+cx*z;
    const x2=cy*x+sy*z1,z2=-sy*x+cy*z1;
    const x3=cz*x2-sz*y1,y3=sz*x2+cz*y1;
    nx.push(x3);ny.push(y3);nz.push(z2);
  }
  Plotly.update('plot-3d-gyro',{x:[nx],y:[ny],z:[nz]},[0]);
}

// ── Firebase Listener ──
function listenFirebase(){
  const fbBadge=$('firebase-badge');
  // Connection state
  db.ref('.info/connected').on('value',snap=>{
    if(snap.val()===true){
      fbBadge.textContent='🔥 FIREBASE CONNECTED';fbBadge.className='status-badge fb-badge connected';
      mlog('Firebase RTDB connected — listening for telemetry','log-ok');
    } else {
      fbBadge.textContent='🔥 FIREBASE OFFLINE';fbBadge.className='status-badge fb-badge';
      mlog('Firebase disconnected','log-warn');
    }
  });

  let currentTeam = null;

  // Listen for teams being added/updated
  db.ref('gcs').limitToLast(1).on('value',snap=>{
    const teams=snap.val();if(!teams)return;
    const teamId=Object.keys(teams)[0];
    if(teamId === currentTeam) return;
    currentTeam = teamId;
    
    $('team-id-display').textContent='TEAM: '+teamId;
    $('connection-badge').querySelector('.dot').classList.add('online');
    $('connection-badge').querySelector('span:last-child').textContent='RECEIVING';
    $('connection-badge').classList.add('connected');
    mlog(`Subscribed to telemetry stream for team: ${teamId}`,'log-ok');

    // Remove previous listeners if any
    db.ref(`gcs/${teamId}/rocket`).off();
    db.ref(`gcs/${teamId}/cansat`).off();

    // ── Rocket Data (Last 600) ──
    db.ref(`gcs/${teamId}/rocket`).limitToLast(600).on('value', rsnap=>{
      const rocketData=rsnap.val();if(!rocketData)return;
      const entries=Object.values(rocketData).sort((a,b)=>a.t-b.t);
      
      D.time.length=0;D.alt.length=0;D.temp.length=0;D.press.length=0;D.volt.length=0;
      D.ax.length=0;D.ay.length=0;D.az.length=0;D.gx.length=0;D.gy.length=0;D.gz.length=0;
      D.spd.length=0;D.lx.length=0;D.ly.length=0;
      let prevAlt=0,prevT=0;
      
      entries.forEach(d=>{
        D.time.push(d.t);D.alt.push(d.alt);D.temp.push(d.tmp);D.press.push(d.prs);D.volt.push(d.vlt);
        D.ax.push(d.ax||0);D.ay.push(d.ay||0);D.az.push(d.az||0);
        D.gx.push(d.gx||0);D.gy.push(d.gy||0);D.gz.push(d.gz||0);
        const spd=(d.t>prevT&&prevT>0)?Math.abs((d.alt-prevAlt)/(d.t-prevT)):0;
        D.spd.push(spd);prevAlt=d.alt;prevT=d.t;
        // Lateral offset from launch
        if(d.lat&&d.lon){
          if(!lLat){lLat=d.lat;lLon=d.lon;}
          D.ly.push((d.lat-lLat)*111111);
          D.lx.push((d.lon-lLon)*111111*Math.cos(lLat*Math.PI/180));
        }
      });
      const last=entries[entries.length-1];
      if(last.alt>maxAlt)maxAlt=last.alt;
      pktCnt=entries.length;

      // Gyro integration for 3D model
      if(entries.length>1){
        rotX=0;rotY=0;rotZ=0;
        for(let i=1;i<entries.length;i++){
          const dt=entries[i].t-entries[i-1].t;
          if(dt>0&&dt<2){
            rotX+=(entries[i].gx||0)*Math.PI/180*dt;
            rotY+=(entries[i].gy||0)*Math.PI/180*dt;
            rotZ+=(entries[i].gz||0)*Math.PI/180*dt;
          }
        }
      }

      // Update metrics
      $('val-altitude').textContent=(last.alt||0).toFixed(1);
      $('val-max-alt').textContent=maxAlt.toFixed(1);
      $('val-pressure').textContent=Math.round(last.prs||0);
      $('val-voltage').textContent=(last.vlt||0).toFixed(2);
      $('val-temp').textContent=(last.tmp||0).toFixed(1);
      $('val-sats').textContent=last.sat||0;
      $('val-packets').textContent=pktCnt;
      $('val-gnss-time').textContent=last.gt||'--';
      $('val-lat').textContent=(last.lat||0).toFixed(4);
      $('val-lon').textContent=(last.lon||0).toFixed(4);
      $('val-gnss-alt').textContent=(last.galt||0).toFixed(1);
      $('val-ax').textContent=(last.ax||0).toFixed(2);
      $('val-ay').textContent=(last.ay||0).toFixed(2);
      $('val-az').textContent=(last.az||0).toFixed(2);
      $('val-gx').textContent=(last.gx||0).toFixed(1);
      $('val-gy').textContent=(last.gy||0).toFixed(1);
      $('val-gz').textContent=(last.gz||0).toFixed(1);
      $('flight-state').textContent=last.st||'PRE-FLIGHT';
      $('flight-state').className='flight-state st-'+(last.st||'');
      if(last.sat>0){$('gps-status').textContent=last.sat+' SATS';$('gps-status').className='card-badge fix';}

      // Update GPS map
      if(last.lat&&last.lon){marker.setLatLng([last.lat,last.lon]);poly.setLatLngs(
        entries.filter(d=>d.lat&&d.lon).map(d=>[d.lat,d.lon]));if(autoCenter)map.panTo([last.lat,last.lon]);}

      // Throttled chart updates
      if(!window.chartTmr){
        window.chartTmr=setTimeout(()=>{
          window.chartTmr=null;
          const t=D.time;
          Plotly.update('plot-altitude',{x:[t],y:[D.alt]},[0]);
          Plotly.update('plot-velocity',{x:[t],y:[D.spd]},[0]);
          Plotly.update('plot-accel',{x:[t,t,t],y:[D.ax,D.ay,D.az]},[0,1,2]);
          Plotly.update('plot-gyro',{x:[t,t,t],y:[D.gx,D.gy,D.gz]},[0,1,2]);
          Plotly.update('plot-temp',{x:[t],y:[D.temp]},[0]);
          Plotly.update('plot-press',{x:[t],y:[D.press]},[0]);
          Plotly.update('plot-voltage',{x:[t],y:[D.volt]},[0]);
          if(D.lx.length>0)Plotly.update('plot-3d',{x:[D.lx],y:[D.ly],z:[D.alt]},[0]);
          rotateRocket();
        }, 200);
      }

      // MET timer
      if(entries.length>0){
        const s=Math.round(last.t);
        $('met-display').textContent=`T+ ${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
      }
    });

    // ── CAN-7U Data (Last 600) ──
    db.ref(`gcs/${teamId}/cansat`).limitToLast(600).on('value', csnap=>{
      const cansatData=csnap.val();if(!cansatData)return;
      const entries=Object.values(cansatData).sort((a,b)=>a.t-b.t);
      
      CS.time.length=0;CS.alt.length=0;CS.temp.length=0;CS.press.length=0;
      CS.ax.length=0;CS.ay.length=0;CS.az.length=0;
      
      entries.forEach(d=>{
        CS.time.push(d.t);CS.alt.push(d.alt);CS.temp.push(d.tmp);CS.press.push(d.prs);
        CS.ax.push(d.ax||0);CS.ay.push(d.ay||0);CS.az.push(d.az||0);
      });
      
      const last=entries[entries.length-1];
      $('cs-alt').textContent=(last.alt||0).toFixed(1);
      $('cs-press').textContent=Math.round(last.prs||0);
      $('cs-temp').textContent=(last.tmp||0).toFixed(1);
      $('cs-ax').textContent=(last.ax||0).toFixed(2);
      $('cs-ay').textContent=(last.ay||0).toFixed(2);
      $('cs-az').textContent=(last.az||0).toFixed(2);
      $('cs-lat').textContent=(last.lat||0).toFixed(4);
      $('cs-lon').textContent=(last.lon||0).toFixed(4);
      $('cs-sats').textContent=last.sat||0;
      $('cs-state').textContent=last.st||'IDLE';
      $('cansat-status').textContent='ACTIVE';$('cansat-status').className='card-badge fix';

      if(last.lat&&last.lon){csMarker.setLatLng([last.lat,last.lon]);csPoly.setLatLngs(
        entries.filter(d=>d.lat&&d.lon).map(d=>[d.lat,d.lon]));if(autoCenterCs)csMap.panTo([last.lat,last.lon]);}

      if(!window.csChartTmr){
        window.csChartTmr=setTimeout(()=>{
          window.csChartTmr=null;
          Plotly.update('plot-cs-alt',{x:[CS.time],y:[CS.alt]},[0]);
          Plotly.update('plot-cs-temp',{x:[CS.time],y:[CS.temp]},[0]);
          Plotly.update('plot-cs-press',{x:[CS.time],y:[CS.press]},[0]);
          Plotly.update('plot-cs-accel',{x:[CS.time,CS.time,CS.time],y:[CS.ax,CS.ay,CS.az]},[0,1,2]);
        }, 200);
      }
    });

    // ── XBee Rocket Data (Last 600) ──
    db.ref(`gcs/${teamId}/rocket_xbee`).off();
    db.ref(`gcs/${teamId}/rocket_xbee`).limitToLast(600).on('value', xsnap=>{
      const xData=xsnap.val();if(!xData)return;
      const entries=Object.values(xData).sort((a,b)=>a.t-b.t);
      const DX={time:[],alt:[],temp:[],press:[],volt:[],ax:[],ay:[],az:[],gx:[],gy:[],gz:[],spd:[],lat:[],lon:[]};
      let prevAlt=0,prevT=0;
      entries.forEach(d=>{
        DX.time.push(d.t);DX.alt.push(d.alt);DX.temp.push(d.tmp);DX.press.push(d.prs);DX.volt.push(d.vlt);
        DX.ax.push(d.ax||0);DX.ay.push(d.ay||0);DX.az.push(d.az||0);
        DX.gx.push(d.gx||0);DX.gy.push(d.gy||0);DX.gz.push(d.gz||0);
        const spd=(d.t>prevT&&prevT>0)?Math.abs((d.alt-prevAlt)/(d.t-prevT)):0;
        DX.spd.push(spd);prevAlt=d.alt;prevT=d.t;
        if(d.lat)DX.lat.push(d.lat);if(d.lon)DX.lon.push(d.lon);
      });
      const last=entries[entries.length-1];
      // Metrics
      const s=id=>document.getElementById(id);
      if(s('xb-altitude'))s('xb-altitude').textContent=(last.alt||0).toFixed(1);
      if(s('xb-max-alt'))s('xb-max-alt').textContent=Math.max(...DX.alt).toFixed(1);
      if(s('xb-pressure'))s('xb-pressure').textContent=Math.round(last.prs||0);
      if(s('xb-voltage'))s('xb-voltage').textContent=(last.vlt||0).toFixed(2);
      if(s('xb-temp'))s('xb-temp').textContent=(last.tmp||0).toFixed(1);
      if(s('xb-packets'))s('xb-packets').textContent=entries.length;
      if(s('xb-rssi'))s('xb-rssi').textContent=last.rssi||'--';
      if(s('xb-lqi'))s('xb-lqi').textContent=last.lqi||'--';
      if(s('xb-lat'))s('xb-lat').textContent=(last.lat||0).toFixed(4);
      if(s('xb-lon'))s('xb-lon').textContent=(last.lon||0).toFixed(4);
      if(s('xb-gnss-alt'))s('xb-gnss-alt').textContent=(last.galt||0).toFixed(1);
      if(s('xb-ax'))s('xb-ax').textContent=(last.ax||0).toFixed(2);
      if(s('xb-ay'))s('xb-ay').textContent=(last.ay||0).toFixed(2);
      if(s('xb-az'))s('xb-az').textContent=(last.az||0).toFixed(2);
      if(s('xb-gx'))s('xb-gx').textContent=(last.gx||0).toFixed(1);
      if(s('xb-gy'))s('xb-gy').textContent=(last.gy||0).toFixed(1);
      if(s('xb-gz'))s('xb-gz').textContent=(last.gz||0).toFixed(1);
      if(last.lat&&last.lon&&xbMap){
        xbMarker.setLatLng([last.lat,last.lon]);
        xbPoly.setLatLngs(entries.filter(d=>d.lat&&d.lon).map(d=>[d.lat,d.lon]));
        if(autoCenterXb)xbMap.panTo([last.lat,last.lon]);
      }
      // Metrics — sats update
      if(s('xb-sats'))s('xb-sats').textContent=last.sat||0;
      if(s('xb-gps-status')){
        if((last.sat||0)>0){s('xb-gps-status').textContent=(last.sat||0)+' SATS';s('xb-gps-status').className='card-badge fix';}
        else{s('xb-gps-status').textContent='NO FIX';s('xb-gps-status').className='card-badge';}
      }
      if(!window.xbChartTmr){
        window.xbChartTmr=setTimeout(()=>{
          window.xbChartTmr=null;
          const t=DX.time;
          Plotly.update('xb-plot-altitude',{x:[t],y:[DX.alt]},[0]);
          Plotly.update('xb-plot-velocity',{x:[t],y:[DX.spd]},[0]);
          Plotly.update('xb-plot-accel',{x:[t,t,t],y:[DX.ax,DX.ay,DX.az]},[0,1,2]);
          Plotly.update('xb-plot-gyro',{x:[t,t,t],y:[DX.gx,DX.gy,DX.gz]},[0,1,2]);
          Plotly.update('xb-plot-temp',{x:[t],y:[DX.temp]},[0]);
          Plotly.update('xb-plot-press',{x:[t],y:[DX.press]},[0]);
          Plotly.update('xb-plot-voltage',{x:[t],y:[DX.volt]},[0]);
          // 3D Trajectory
          const xbLx=[],xbLy=[],xbLL={lat:null,lon:null};
          entries.forEach(d=>{
            if(d.lat&&d.lon){
              if(!xbLL.lat){xbLL.lat=d.lat;xbLL.lon=d.lon;}
              xbLx.push((d.lon-xbLL.lon)*111111*Math.cos(xbLL.lat*Math.PI/180));
              xbLy.push((d.lat-xbLL.lat)*111111);
            }
          });
          if(xbLx.length>0)Plotly.update('xb-plot-3d',{x:[xbLx],y:[xbLy],z:[DX.alt.slice(-xbLx.length)]},[0]);
          // 3D Orientation — gyro integration
          if(window.xbRocketX&&entries.length>1){
            let rx=0,ry=0,rz=0;
            for(let i=1;i<entries.length;i++){
              const dt=entries[i].t-entries[i-1].t;
              if(dt>0&&dt<2){rx+=(entries[i].gx||0)*Math.PI/180*dt;ry+=(entries[i].gy||0)*Math.PI/180*dt;rz+=(entries[i].gz||0)*Math.PI/180*dt;}
            }
            const cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry),cz=Math.cos(rz),sz=Math.sin(rz);
            const nx=window.xbRocketX.map((x,i)=>{
              const y=window.xbRocketY[i],z=window.xbRocketZ[i];
              const x1=cy*cz*x+(-cy*sz)*y+sy*z;
              const y1=(sx*sy*cz+cx*sz)*x+(-sx*sy*sz+cx*cz)*y+(-sx*cy)*z;
              const z1=(-cx*sy*cz+sx*sz)*x+(cx*sy*sz+sx*cz)*y+(cx*cy)*z;
              return x1;
            });
            const ny=window.xbRocketY.map((y,i)=>{
              const x=window.xbRocketX[i],z=window.xbRocketZ[i];
              return (sx*Math.sin(ry)*Math.cos(rz)+cx*Math.sin(rz))*x+(-sx*Math.sin(ry)*Math.sin(rz)+cx*Math.cos(rz))*y+(-sx*Math.cos(ry))*z;
            });
            const nz=window.xbRocketZ.map((z,i)=>{
              const x=window.xbRocketX[i],y=window.xbRocketY[i];
              return (-cx*Math.sin(ry)*Math.cos(rz)+sx*Math.sin(rz))*x+(cx*Math.sin(ry)*Math.sin(rz)+sx*Math.cos(rz))*y+(cx*Math.cos(ry))*z;
            });
            Plotly.update('xb-plot-3d-gyro',{x:[nx],y:[ny],z:[nz]},[0]);
          }
        },200);
      }
    });  // end rocket_xbee listener

  });  // end team snapshot listener
}  // end listenFirebase

// ── Tab Switching (3 tabs) ──
function switchTab(tab){
  ['rocket','xbee','cansat'].forEach(t=>{
    const pg=$('page-'+t), tb=$('tab-'+t);
    if(pg)pg.classList.toggle('hidden',t!==tab);
    if(tb)tb.classList.toggle('active',t===tab);
  });
  if(tab==='cansat'&&csMap)setTimeout(()=>{csMap.invalidateSize();},200);
  if(tab==='rocket'&&map)setTimeout(()=>{map.invalidateSize();},200);
  if(tab==='xbee'&&xbMap)setTimeout(()=>{xbMap.invalidateSize();},200);
}
window.switchTab=switchTab;

// ── Init ──
document.addEventListener('DOMContentLoaded',()=>{
  initMaps();initCharts();listenFirebase();
  mlog('IN-SPACe 2026 Viewer v3.0 — Read Only','log-ok');
  mlog('Tabs: 🚀 ROCKET (LoRa) | 📶 ROCKET (XBee) | 🛰 CAN-7U','log-info');
  mlog('Listening for live telemetry from Firebase...','log-info');
});
