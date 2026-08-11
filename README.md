# BTC Signal Notebook v1.4

A static GitHub Pages reader paired with a Cloudflare Worker + D1 audit service. The reader displays a live Coinbase price tick via public WebSocket. The Worker records independent forecasts every minute and resolves them later, even with no browser open.

## What is new in v1.4

The former audit could classify an unchanged candle close as “down,” which made the record misleading. v1.4 uses the public Coinbase ticker price when it records and resolves an audit forecast. A move smaller than **1 basis point (0.01%)** is marked *flat*, shown separately, and excluded from directional Brier-score / hit-rate calculations. This threshold is explicit in `worker.js` and should be changed only with a new model version.

The audit now uses an independent equal window for each horizon (default 720 resolved records per horizon), rather than taking one mixed global sample. The site tells the reader exactly how many directional examples, flat exclusions, and recent records are used.

## Self-improving method

The model is intentionally modest and inspectable:

1. **Features.** RiskMetrics EWMA and lightweight GARCH(1,1) describe volatility; a 1D Kalman filter estimates local trend; a variance-ratio Hurst approximation reduces trend weight in a mean-reverting regime; 1m and 5m log-return features capture short momentum.
2. **Initial estimate.** Each horizon has an explicit logistic-weight vector in `INITIAL`.
3. **Online update.** After a non-flat forecast resolves, bounded regularized logistic SGD applies one small update. The learning rate decays with the count of resolved examples; each weight is clipped. The system cannot silently replace its model or rapidly overfit to a short streak.
4. **Probability calibration.** The raw model probability is passed through a ten-bin empirical-Bayes calibrator. Sparse buckets are shrunk toward 50%, which is more honest than presenting unstable frequencies as precise probabilities.
5. **Audit.** Forecasts are stored before outcomes are known. The audit measures Brier score, hit rate, calibration by probability bin, flat exclusions, and the exact per-horizon window.

This is **not** a validated trading system. It does not account for fees, settlement-index basis, spread, execution delay, taxes, or risk suitability.

## Deployment

### Cloudflare Worker

1. Create or open your existing `btc-predict` Worker.
2. In **D1 → your database → Console**, execute the complete contents of `schema.sql`. It is an idempotent safe upgrade; it adds `model_state` and indexes without deleting existing data.
3. In **Workers & Pages → btc-predict → Bindings**, confirm that your D1 database is bound as exactly `DB`.
4. In the Worker code editor, replace the code with `worker.js` and click **Deploy**.
5. In **Settings → Triggers → Cron Triggers**, retain or add `* * * * *` for once per minute.
6. Test `https://YOUR-WORKER.workers.dev/api/live` and `https://YOUR-WORKER.workers.dev/api/audit`.

v1.4 deliberately stores new records with `modelVersion: v1.4`; the audit starts fresh rather than blending an earlier measurement defect into new reported performance.

### GitHub Pages

Publish these four files directly in the Pages source folder (normally repository root):

- `index.html`
- `style.css`
- `app.js`
- `config.js`

In `config.js`, keep your real audit URL:

```js
window.AUDIT_API = 'https://btc-predict.dgschmidt00.workers.dev/api/audit';
```

Then commit and hard-refresh the browser. No API key belongs in the repository.

## Sources

- Coinbase Exchange public REST: one-minute candles and ticker snapshots used by the Worker.
- Coinbase Exchange public WebSocket: live BTC-USD price display while a reader has the site open.
- Cloudflare Cron Trigger and D1: persistent audit scheduling and storage.

Public feeds can fail, be delayed, or change. The API writes a failed run to `audit_runs` instead of fabricating a forecast.
