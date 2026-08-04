const $=id=>document.getElementById(id);
const usd=x=>Number(x).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct=x=>x==null?'—':`${(x*100).toFixed(1)}%`;
let base='', livePrice=null, wsRetry=1000;

function workerBase(){return (window.AUDIT_API||'').replace(/\/api\/audit.*$/,'');}
function liveURL(minutes,line){
  let u=`${base}/api/live`;
  const p=[];
  if(minutes) p.push(`minutes=${encodeURIComponent(minutes)}`);
  if(line!=null) p.push(`line=${encodeURIComponent(line)}`);
  return p.length?u+'?'+p.join('&'):u;
}
function status(msg,ok=false){
  $('service-status').textContent=msg;
  $('service-status').style.color=ok?'var(--green)':'var(--blue)';
}
function callClass(p){return p>.515?['HIGHER','up']:p<.485?['LOWER','down']:['EVENLY BALANCED','mixed'];}

/* Coinbase WebSocket — live price ticks, no API key */
function connectWS(){
  let ws;
  try { ws=new WebSocket('wss://ws-feed.exchange.coinbase.com'); }
  catch(e){ scheduleWSRetry(); return; }
  ws.onopen=()=>{
    wsRetry=1000;
    ws.send(JSON.stringify({type:'subscribe',product_ids:['BTC-USD'],channels:['ticker']}));
  };
  ws.onmessage=e=>{
    let m; try{m=JSON.parse(e.data);}catch{return;}
    if(m.type==='ticker'&&m.product_id==='BTC-USD'){
      const p=+m.price; if(!Number.isFinite(p))return;
      livePrice=p;
      $('current-price').textContent=usd(p);
      $('updated').textContent=`Price updated ${new Date().toLocaleTimeString()}`;
    }
  };
  ws.onerror=()=>scheduleWSRetry();
  ws.onclose=()=>scheduleWSRetry();
}
function scheduleWSRetry(){ setTimeout(connectWS,wsRetry); wsRetry=Math.min(30000,wsRetry*1.8); }

/* Worker API — single call returns all 4 horizons */
function projectionCard(p, h){
  const [label,cls]=callClass(p.probabilityUp);
  return `<article class="projection">
    <h3>Next ${h===60?'hour':h+' minute'+(h>1?'s':'')}</h3>
    <div class="call ${cls}">${label}</div>
    <div class="probability">${pct(p.probabilityUp)}</div>
    <dl>
      <div><dt>Reference</dt><dd>${usd(p.price)}</dd></div>
      <div><dt>Likely range</dt><dd>${usd(p.rangeLow)}–${usd(p.rangeHigh)}</dd></div>
      <div><dt>Model horizon</dt><dd>${p.nearestModelHorizon} min</dd></div>
    </dl>
  </article>`;
}
async function refreshForecast(){
  try {
    const d=await fetch(liveURL(),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(r.status);return r.json();});
    if(!livePrice) $('current-price').textContent=usd(d.projections[5].price);
    $('vol-state').textContent=`${d.features.garchRatio.toFixed(2)}× baseline`;
    $('regime').textContent=d.features.hurst>.54?'Persistent':d.features.hurst<.46?'Mean-reverting':'Mixed';
    $('projection-cards').innerHTML=[1,5,15,60].map(h=>projectionCard(d.projections[h],h)).join('');
    status('Live model connected',true);
  } catch(e){
    status('Live model unavailable');
    $('projection-cards').innerHTML='<p class="loading">The live projection service is unreachable. Confirm the Worker address in config.js.</p>';
  }
}

/* Audit record */
function auditStats(data){
  const vals=Object.values(data.summary||{}), resolved=vals.reduce((s,x)=>s+(x.n||0),0);
  const valid=vals.filter(x=>x.brier!=null);
  const b=valid.length?valid.reduce((s,x)=>s+x.brier,0)/valid.length:null;
  const h=valid.length?valid.reduce((s,x)=>s+x.hit,0)/valid.length:null;
  return {resolved,b,h,last:data.latestRun?.run_at};
}
function table(data){
  const s=data.summary||{};
  return `<table><thead><tr>
    <th>Horizon</th><th>Resolved</th><th>Brier score</th>
    <th>Hit rate</th><th>Calibration snapshot</th>
  </tr></thead><tbody>
  ${[1,5,15,60].map(h=>{
    const x=s[h]||{};
    const b=(x.buckets||[]).filter(q=>q.n)
      .map(q=>`${q.bucket}: forecast ${pct(q.forecast)}, observed ${pct(q.observed)} (n=${q.n})`)
      .join('<br>')||'No resolved calls yet';
    return `<tr>
      <td>${h===60?'1 hour':h+' min'}</td>
      <td>${x.n||0}</td>
      <td>${x.brier==null?'—':x.brier.toFixed(3)}</td>
      <td>${pct(x.hit)}</td>
      <td><span class="bucket">${b}</span></td>
    </tr>`;
  }).join('')}</tbody></table>`;
}
async function refreshAudit(){
  try {
    const d=await fetch(window.AUDIT_API,{cache:'no-store'}).then(r=>r.json());
    const x=auditStats(d);
    $('audit-overview').innerHTML=`
      <div class="audit-stat"><span>Resolved forecasts</span>
        <strong>${x.resolved.toLocaleString()}</strong><small>all stored horizons</small></div>
      <div class="audit-stat"><span>Mean Brier score</span>
        <strong>${x.b==null?'—':x.b.toFixed(3)}</strong><small>lower is better</small></div>
      <div class="audit-stat"><span>Mean hit rate</span>
        <strong>${pct(x.h)}</strong><small>side of 50% only</small></div>
      <div class="audit-stat"><span>Latest audit</span>
        <strong>${x.last?new Date(x.last).toLocaleTimeString():'—'}</strong>
        <small>${d.latestRun?.status||'awaiting run'}</small></div>`;
    $('audit-table').innerHTML=table(d);
  } catch(e){
    $('audit-overview').innerHTML='<p class="loading">Audit record unavailable.</p>';
  }
}

/* Custom price-line tool */
$('line-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const minutes=+$('minutes').value, line=+$('price-line').value, box=$('line-result');
  if(!Number.isFinite(minutes)||minutes<1||minutes>240||!Number.isFinite(line)||line<=0){
    box.innerHTML='<p>Enter a time from 1–240 minutes and a positive price line.</p>'; return;
  }
  box.innerHTML='<p>Calculating…</p>';
  try {
    const d=await fetch(liveURL(minutes,line),{cache:'no-store'}).then(r=>r.json());
    const p=d.custom;
    box.innerHTML=`<div class="result-grid">
      <div><span>Question</span><strong>BTC in ${minutes} min</strong></div>
      <div><span>Price line</span><strong>${usd(p.line)}</strong></div>
      <div><span>Probability over</span><strong class="over">${pct(p.probabilityOver)}</strong></div>
      <div><span>Probability under</span><strong class="under">${pct(p.probabilityUnder)}</strong></div>
    </div>
    <p class="fine-print">Reference: ${usd(p.price)} · Range: ${usd(p.rangeLow)}–${usd(p.rangeHigh)} · Nearest model horizon: ${p.nearestModelHorizon} min</p>`;
  } catch(e){ box.innerHTML='<p>Could not load estimate. Please try again.</p>'; }
});

/* Boot */
function boot(){
  base=workerBase();
  if(!base||base.includes('PASTE_')){ status('Add the Worker API URL in config.js'); return; }
  connectWS();
  refreshForecast();
  refreshAudit();
  setInterval(refreshForecast,30000);
  setInterval(refreshAudit,60000);
}
boot();
