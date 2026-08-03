# BTC Signal Notebook v1.2

## What changed

v1.2 separates the reader website from a persistent serverless auditor. The audit Worker runs on a Cloudflare Cron Trigger every minute even when the site has zero visitors. Each run reads public Coinbase BTC-USD one-minute candles, creates four forecasts (1m, 5m, 15m, 1h), and resolves older forecasts once their horizons have elapsed. Forecasts and outcomes remain in Cloudflare D1, so every visitor sees the same accumulated Brier score, hit rate, and calibration buckets.

The website itself is a deliberately simpler, StatBase-inspired research page: a clear framing question, a results strip, per-horizon audit cards, visible model modules, and limitations. It is no longer styled as a trading terminal.

## Why Cloudflare rather than a simpler static-only tool?

There is no static-only solution that can collect predictions while nobody is visiting. GitHub Pages is only a file host; JavaScript stops when the final browser tab closes. The simplest reliable free architecture is therefore:

`Cloudflare Cron Trigger → Worker → D1 → read-only audit API → static website`

The cron job is designed for a free account: it performs one compact REST pull and a handful of indexed D1 writes per minute. It does *not* operate a permanent WebSocket collector. This is intentional: it keeps cost/operational complexity low, but historical persistent forecasts use reproducible candle features rather than live order-book signals. The original v1.1 browser model can still be retained separately as an optional live experimental display.

## Deploy in order

You need a Cloudflare account, Node.js, and a terminal. Wrangler is Cloudflare's command-line tool.

### 1. Unzip and open the project

```bash
unzip btc-signal-notebook-v1.2.zip
cd btc-signal-notebook-v1.2
npm init -y
npm install --save-dev wrangler@latest
npx wrangler login
```


### 2. Create the D1 database

```bash
npx wrangler d1 create btc-signal-audit
```


Cloudflare prints a `database_id`. Copy it into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`. Leave the binding name as `DB`—the Worker expects that exact name.

### 3. Create the remote tables

```bash
npx wrangler d1 execute btc-signal-audit --remote --file=./schema.sql
```


### 4. Deploy the auditor

```bash
npx wrangler deploy
```


Wrangler prints a URL like `https://btc-signal-auditor-v12.YOUR-SUBDOMAIN.workers.dev`. Your API address is that URL plus `/api/audit`.

The Worker configuration already contains the every-minute cron expression. Cloudflare notes that new or changed cron triggers may need several minutes—up to roughly 15 minutes—to propagate. It is normal for resolved results to be empty at first: the 1-minute outcomes must mature first; the 1-hour outcomes need an hour.

### 5. Verify the persistent service

Open this in a browser:

`https://btc-signal-auditor-v12.YOUR-SUBDOMAIN.workers.dev/api/audit`

You should eventually see JSON containing `latestRun`, `summary`, and `recent`. In Cloudflare, you can also inspect **Workers & Pages → your Worker → Settings → Trigger Events**.

### 6. Connect and publish the reader site

Open `site/config.js`. Replace the placeholder with the API URL, including `/api/audit`:

```js
window.AUDIT_API = 'https://btc-signal-auditor-v12.YOUR-SUBDOMAIN.workers.dev/api/audit';
```


Then publish the **contents** of the `site/` directory through GitHub Pages as before, or upload that directory to Cloudflare Pages. The reader site is just static HTML/CSS/JS—no secrets belong in it.

## Operational notes

- **Do not place a real token in `config.js`.** The included public API is read-only. The Worker has a manual `/api/run` route protected by `RUN_TOKEN`, but this v1.2 deployment does not require it; leave it unset.
- The audit Worker uses only Coinbase’s public candle endpoint. Public endpoints can be rate-limited, changed, or temporarily unavailable. A failed run is written as an `audit_runs` error record rather than quietly creating a missing forecast.
- The dashboard API allows cross-origin reads by design. It offers no database-write route to visitors.
- Data grows by four forecast rows per minute. That is about 172,800 forecast rows per 30-day month before any index overhead. Add a retention/rollup job before retaining raw minute rows indefinitely.
- This is research software, not an assertion of predictive skill or a trading recommendation. It does not model costs, slippage, execution, latency, or suitability.

## Project map

- `worker.js` — scheduled model/auditor and read-only API
- `schema.sql` — D1 tables and performance indexes
- `wrangler.toml` — Worker/D1/cron deployment configuration
- `site/` — statically hosted reader website

## Sources used by the deployment

- Coinbase Exchange public one-minute BTC-USD candles: live market input.
- Cloudflare Workers Cron Trigger: minute scheduler.
- Cloudflare D1: durable forecast and outcome store.

No API key, paid feed, client-tracking system, or order-placement capability is included.
