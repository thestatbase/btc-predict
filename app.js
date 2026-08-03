/* BTC Pulse: browser-only Coinbase BTC-USD signal dashboard.
   This is deliberately a transparent heuristic, not a trained financial model. */
const WS_URL = 'wss://ws-feed.exchange.coinbase.com';
const CANDLES_URL = 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60';
const state = { candles: [], trades: [], bids: new Map(), asks: new Map(), lastPrice: null, ws: null, paused: false, reconnectDelay: 1000, lastRender: 0 };
const $ = (id) => document.getElementById(id);
const fmtUSD = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:2});
const fmtPct = (n, digits=2) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;

function setConnection(type, message) { const el=$('connection'); el.className=`status ${type}`; el.innerHTML=`<i></i> ${message}`; }
function number(v) { return Number.isFinite(v) ? v : 0; }
function clamp(x,a,b) { return Math.max(a,Math.min(b,x)); }
function sigmoid(x) { return 1/(1+Math.exp(-x)); }
function mean(a) { return a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0; }
function std(a) { if(a.length<2)return 0; const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2))); }
function ema(values, span) { if(!values.length)return 0; const k=2/(span+1); return values.reduce((v,x,i)=>i?x*k+v*(1-k):x, values[0]); }
function agoReturn(prices, minutes) { if(prices.length <= minutes) return 0; return ((prices.at(-1)/prices.at(-1-minutes))-1)*100; }
function classFor(v, neutral=.02) { return v > neutral ? 'positive' : v < -neutral ? 'negative' : 'neutral'; }

async function loadCandles() {
  try {
    const response = await fetch(CANDLES_URL, {headers:{'Accept':'application/json'}});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    // Coinbase format: [time, low, high, open, close, volume], newest first.
    state.candles = raw.map(r => ({ time:r[0]*1000, open:+r[3], high:+r[2], low:+r[1], close:+r[4], volume:+r[5] })).sort((a,b)=>a.time-b.time);
    state.lastPrice = state.candles.at(-1)?.close ?? null;
    $('candle-status').textContent = `${state.candles.length} 1m candles loaded`;
    render();
  } catch (err) {
    $('candle-status').textContent = 'Candle history unavailable';
    console.warn('Candle fetch failed:', err);
  }
}

function connect() {
  if(state.paused) return;
  try { state.ws = new WebSocket(WS_URL); } catch(err) { scheduleReconnect(); return; }
  setConnection('connecting','Connecting');
  state.ws.onopen = () => {
    state.reconnectDelay=1000; setConnection('connected','Live');
    state.ws.send(JSON.stringify({type:'subscribe',product_ids:['BTC-USD'],channels:['ticker','level2_batch','heartbeat']}));
  };
  state.ws.onmessage = ({data}) => {
    let msg; try { msg=JSON.parse(data); } catch { return; }
    if(msg.type==='ticker' && msg.product_id==='BTC-USD') {
      const price=+msg.price; if(Number.isFinite(price)) { state.lastPrice=price; state.trades.push({time:Date.now(),price,size:+msg.last_size||0}); state.trades=state.trades.filter(t=>t.time>Date.now()-16*60e3); updateLiveCandle(price,+msg.last_size||0); throttledRender(); }
    }
    if(msg.type==='snapshot' && msg.product_id==='BTC-USD') { state.bids.clear();state.asks.clear(); for(const [p,s] of msg.bids||[])state.bids.set(+p,+s);for(const [p,s] of msg.asks||[])state.asks.set(+p,+s); }
    if(msg.type==='l2update' && msg.product_id==='BTC-USD') { for(const [side,p,s] of msg.changes||[]) { const map=side==='buy'?state.bids:state.asks; +s===0?map.delete(+p):map.set(+p,+s); } throttledRender(); }
    if(msg.type==='error') console.warn('Coinbase feed:',msg.message);
  };
  state.ws.onerror = () => setConnection('error','Connection error');
  state.ws.onclose = () => { if(!state.paused) { setConnection('connecting','Reconnecting'); scheduleReconnect(); } };
}
function scheduleReconnect() { setTimeout(connect,state.reconnectDelay); state.reconnectDelay=Math.min(state.reconnectDelay*1.8,30000); }
function updateLiveCandle(price,size) {
  const now=Math.floor(Date.now()/60000)*60000, last=state.candles.at(-1);
  if(!last || last.time!==now) state.candles.push({time:now,open:last?.close||price,high:price,low:price,close:price,volume:size});
  else { last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);last.close=price;last.volume+=size; }
  state.candles=state.candles.slice(-300);
}
function bookImbalance() {
  const p=state.lastPrice;if(!p)return 0;
  let bid=0,ask=0;
  for(const [price,size] of state.bids) if(price>=p*.998) bid+=size;
  for(const [price,size] of state.asks) if(price<=p*1.002) ask+=size;
  return bid+ask ? (bid-ask)/(bid+ask) : 0;
}
function model() {
  const closes=state.candles.map(c=>c.close), vols=state.candles.map(c=>c.volume); if(closes.length<20)return null;
  const r1=agoReturn(closes,1),r3=agoReturn(closes,3),r5=agoReturn(closes,5),r15=agoReturn(closes,15);
  const returns=closes.slice(-6).map((p,i,a)=>i?Math.log(p/a[i-1]):null).slice(1);
  const vol=std(returns)*100; const fast=ema(closes.slice(-20),8),slow=ema(closes.slice(-35),21);
  const trend=((fast/slow)-1)*100; const imbal=bookImbalance(); const avgVol=mean(vols.slice(-31,-1)); const volumeScore=avgVol?clamp((vols.at(-1)/avgVol-1),-2,3):0;
  // Scores use bounded inputs so a single noisy tick cannot dominate.
  const base=clamp(.72*r1+.36*r3+.18*r5 + 1.9*trend + .48*imbal + .05*volumeScore, -3,3);
  const horizons=[1,5,10,15].map(h=>{ const decay=({1:1.12,5:1,10:.77,15:.63})[h]; const penalty=vol*({1:.65,5:.95,10:1.2,15:1.42}[h]); const score=base*decay; const p=clamp(50+35*(sigmoid(score*1.8)-.5)*2-penalty, 36,64); const direction=p>52?'UP':p<48?'DOWN':'NEUTRAL'; const confidence=clamp(Math.abs(p-50)*2.5 + Math.min(vol*10,8),4,38); return {h,p,direction,confidence}; });
  return {r1,r3,r5,r15,vol,fast,slow,trend,imbal,volumeScore,horizons};
}
function renderPredictions(m) { const root=$('predictions'); if(!m){root.innerHTML='<div class="small-muted">Collecting sufficient market data…</div>';return;} root.innerHTML=m.horizons.map(x=>{const cls=x.direction==='UP'?'bullish':x.direction==='DOWN'?'bearish':'neutral-signal';const color=x.direction==='UP'?'positive':x.direction==='DOWN'?'negative':'neutral';return `<article class="prediction ${cls}"><div class="horizon">Next ${x.h} minute${x.h>1?'s':''}</div><div class="direction ${color}">${x.direction}</div><div class="probability">${x.p.toFixed(1)}%</div><div class="bar"><i style="width:${x.p}%"></i></div><div class="confidence">Signal confidence: ${x.confidence.toFixed(0)} / 100</div></article>`;}).join(''); }
function renderChart() { const canvas=$('price-chart'), rect=canvas.getBoundingClientRect(), dpr=devicePixelRatio||1; canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const w=rect.width,h=rect.height,items=state.candles.slice(-60);ctx.clearRect(0,0,w,h); if(items.length<2)return;const vals=items.map(c=>c.close),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1,pad=14;const xy=(i,p)=>[i/(items.length-1)*w,h-pad-((p-min)/range)*(h-pad*2)];ctx.strokeStyle='rgba(76,229,139,.16)';ctx.lineWidth=1;for(let i=1;i<4;i++){const y=pad+(h-pad*2)*i/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}ctx.beginPath();items.forEach((c,i)=>{const [x,y]=xy(i,c.close);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.strokeStyle='#4ce58b';ctx.lineWidth=2;ctx.stroke();const [x,y]=xy(items.length-1,items.at(-1).close);ctx.fillStyle='#4ce58b';ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#9aafa3';ctx.font='10px DM Mono, monospace';ctx.fillText(fmtUSD.format(max),5,12);ctx.fillText(fmtUSD.format(min),5,h-3); }
function render() { const m=model(); if(state.lastPrice)$('price').textContent=fmtUSD.format(state.lastPrice); if(m){const set=(id,v)=>{const e=$(id);e.textContent=fmtPct(v);e.className=classFor(v);};set('return-1m',m.r1);set('return-5m',m.r5);$('volatility').textContent=`${m.vol.toFixed(3)}%`;const im=$('imbalance');im.textContent=`${(m.imbal*100).toFixed(1)}%`;im.className=classFor(m.imbal*100,.8);$('price-change').textContent=`1m: ${fmtPct(m.r1)} · 15m: ${fmtPct(m.r15)}`;$('price-change').className=`price-change ${classFor(m.r1)}`;const rows=[['Momentum (1m / 5m)',`${fmtPct(m.r1)} / ${fmtPct(m.r5)}`],['EMA trend (8 vs. 21)',fmtPct(m.trend,3)],['Top-book imbalance',`${(m.imbal*100).toFixed(1)}%`],['Current / avg. volume',`${(1+m.volumeScore).toFixed(2)}×`],['5m realized log volatility',`${m.vol.toFixed(4)}%`],['Method','Transparent heuristic v1']];$('diagnostics').innerHTML=rows.map(([a,b])=>`<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');}renderPredictions(m);renderChart();$('updated').textContent=`Updated ${new Date().toLocaleTimeString()}`; }
function throttledRender(){const now=Date.now();if(now-state.lastRender>700){state.lastRender=now;render();}}
$('pause-button').onclick=()=>{state.paused=!state.paused;const b=$('pause-button');b.textContent=state.paused?'Resume':'Pause';if(state.paused){state.ws?.close();setConnection('connecting','Paused');}else connect();};
window.addEventListener('resize',renderChart); loadCandles().then(connect); setInterval(loadCandles,5*60e3); setInterval(render,10e3);