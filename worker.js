/**
 * BTC Signal Notebook v1.2 — persistent, one-minute forecast auditor.
 *
 * Free-tier design: a cron event fetches public Coinbase REST once per minute,
 * writes four small forecasts, resolves matured rows, and serves read-only JSON.
 * It deliberately does NOT maintain a 24/7 WebSocket. Thus order-flow/L2 data is
 * client-live-only; the persistent audit uses reproducible one-minute OHLCV features.
 */
const MODEL_VERSION = 'v1.2';
const HORIZONS = [1, 5, 15, 60];
const COINBASE = 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60';
const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json','access-control-allow-origin':'*','cache-control':'no-store'}});
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const mean = a => a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const variance = a => {if(a.length<2)return 0;const m=mean(a);return mean(a.map(x=>(x-m)**2));};
const sigmoid = x => 1/(1+Math.exp(-x));
const z = (x, base, scale) => clamp((x-base)/(scale||1),-3,3);

// RiskMetrics EWMA: a computationally small volatility-clustering estimator.
function ewma(returns, lambda=.94) { let v=variance(returns.slice(-30))||1e-8; for(const r of returns.slice(-180))v=lambda*v+(1-lambda)*r*r; return Math.sqrt(v); }
// GARCH(1,1) lite: fixed stable coefficients suitable for a 10 ms scheduled-worker budget.
function garchLite(returns) { const r=returns.slice(-180), long=variance(r)||1e-8, last=r.at(-1)||0, prior=r.at(-2)||0; const alpha=.08,beta=.89; const priorV=Math.max(1e-12,(1-alpha-beta)*long+alpha*prior*prior+beta*long); const next=Math.max(1e-12,(1-alpha-beta)*long+alpha*last*last+beta*priorV); return {sigma:Math.sqrt(next), ratio:Math.sqrt(next/long)}; }
// 1D Kalman local-level filter: adaptive denoised trend, not a fixed-window moving average.
function kalman(closes) { let level=Math.log(closes[0]),P=1,q=2e-7,r=8e-7;const path=[];for(const price of closes){const obs=Math.log(price);P+=q;const k=P/(P+r);level+=k*(obs-level);P*=1-k;path.push(level);}const recent=path.slice(-8);return {level, velocity:(path.at(-1)-recent[0])/Math.max(1,recent.length-1), distance:Math.log(closes.at(-1))-level}; }
// Variance-ratio Hurst approximation: downweights momentum in mean-reverting regimes.
function hurst(returns) { const x=returns.slice(-80);if(x.length<20)return .5;const v=variance(x),q=5,d=[];for(let i=q;i<x.length;i++)d.push(x.slice(i-q,i).reduce((s,n)=>s+n,0));return clamp(.5+.5*Math.log(Math.max(variance(d)/(q*v||1),.05))/Math.log(q),.15,.85); }
function features(candles) { const closes=candles.map(c=>c.close),rs=closes.slice(1).map((p,i)=>Math.log(p/closes[i])),e=ewma(rs),g=garchLite(rs),k=kalman(closes),h=hurst(rs); const mom1=((closes.at(-1)/closes.at(-2))-1)*100, mom5=((closes.at(-1)/closes.at(-6))-1)*100; return {ewma:e,garch:g,kalman:k,hurst:h,momentum1:mom1,momentum5:mom5,trend:z(k.velocity,0,.00035)*(h>.5?1:.35),reversal:z(-k.distance,0,.0012),vol:z(g.ratio,1,.45)}; }
// Transparent horizon-specific logistic ensemble; weights are explicit and versioned.
const W={1:{b:0,m1:.85,m5:.2,trend:.3,reversal:.12,vol:-.28},5:{b:0,m1:.45,m5:.55,trend:.78,reversal:.25,vol:-.32},15:{b:0,m1:.15,m5:.5,trend:1.0,reversal:.38,vol:-.38},60:{b:0,m1:.05,m5:.25,trend:1.12,reversal:.48,vol:-.45}};
function predict(f,h) { const w=W[h], score=w.b+w.m1*z(f.momentum1,0,.12)+w.m5*z(f.momentum5,0,.25)+w.trend*f.trend+w.reversal*f.reversal+w.vol*f.vol; return clamp(sigmoid(score),.15,.85); }
async function candles() { const r=await fetch(COINBASE,{headers:{accept:'application/json'}});if(!r.ok)throw Error(`Coinbase ${r.status}`);const rows=await r.json();return rows.map(x=>({time:x[0]*1000,close:+x[4]})).sort((a,b)=>a.time-b.time); }
async function audit(env) { const now=Math.floor(Date.now()/60000)*60000; try { const cs=await candles();if(cs.length<90)throw Error('insufficient candles');const price=cs.at(-1).close,f=features(cs);const stmts=[];for(const h of HORIZONS)stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO forecasts (model_version,created_at,due_at,horizon_minutes,entry_price,probability_up,feature_json) VALUES (?,?,?,?,?,?,?)`).bind(MODEL_VERSION,now,now+h*60000,h,price,predict(f,h),JSON.stringify(f)));
  // Resolve only due, unresolved rows. Index keeps the write/read bounded.
  stmts.push(env.DB.prepare(`UPDATE forecasts SET resolved_at=?, exit_price=?, outcome_up=CASE WHEN ? > entry_price THEN 1 ELSE 0 END WHERE model_version=? AND resolved_at IS NULL AND due_at <= ?`).bind(now,price,price,MODEL_VERSION,now));
  stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO audit_runs (run_at,price,status,detail) VALUES (?,?,?,?)`).bind(now,price,'ok',`candles=${cs.length}`)); await env.DB.batch(stmts); return {ok:true,price,time:now};
 } catch(err) { await env.DB.prepare(`INSERT OR REPLACE INTO audit_runs (run_at,status,detail) VALUES (?,?,?)`).bind(now,'error',String(err).slice(0,300)).run(); return {ok:false,error:String(err)}; } }
function summaries(rows) { const out={};for(const h of HORIZONS){const r=rows.filter(x=>x.horizon_minutes===h),n=r.length,brier=n?mean(r.map(x=>(x.probability_up-x.outcome_up)**2)):null,hit=n?mean(r.map(x=>(x.probability_up>=.5)===(x.outcome_up===1)?1:0)):null;const buckets=[[.15,.35],[.35,.45],[.45,.55],[.55,.65],[.65,.85]].map(([a,b])=>{const q=r.filter(x=>x.probability_up>=a&&x.probability_up<(b===.85?.851:b));return {bucket:`${Math.round(a*100)}–${Math.round(b*100)}%`,n:q.length,forecast:q.length?mean(q.map(x=>x.probability_up)):null,observed:q.length?mean(q.map(x=>x.outcome_up)):null};});out[h]={n,brier,hit,buckets};}return out; }
async function api(env, url) { const limit=Math.min(10000,Math.max(100,Number(url.searchParams.get('limit')||4000))); const {results}=await env.DB.prepare(`SELECT horizon_minutes, probability_up, outcome_up, created_at, entry_price, exit_price FROM forecasts WHERE model_version=? AND resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT ?`).bind(MODEL_VERSION,limit).all(); const latest=await env.DB.prepare(`SELECT * FROM audit_runs ORDER BY run_at DESC LIMIT 1`).all();return json({modelVersion:MODEL_VERSION,generatedAt:Date.now(),latestRun:latest.results?.[0]||null,summary:summaries(results),recent:results.slice(0,80)}); }
export default { async scheduled(event,env,ctx) { ctx.waitUntil(audit(env)); }, async fetch(request,env,ctx) { const u=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET'}});if(u.pathname==='/api/audit')return api(env,u);if(u.pathname==='/api/run'&&u.searchParams.get('token')===env.RUN_TOKEN){const r=await audit(env);return json(r,r.ok?200:500);}return new Response('BTC Signal Notebook auditor v1.2. See /api/audit.',{headers:{'content-type':'text/plain'}}); } };