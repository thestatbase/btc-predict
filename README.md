# BTC Signal Notebook v1.1

**Release: v1.1**

A static GitHub Pages research dashboard for BTC-USD. It is a transparent educational forecasting experiment, not a trading system.

## Deploy

Upload `index.html`, `style.css`, `modules.js`, `app.js`, and this README to a GitHub repository root. Enable **Settings → Pages → Deploy from a branch → main / root**. No build process, API key, account, backend, database, or paid source is required.

## Inspectable components

`modules.js` keeps each model component isolated from presentation:

- `ewmaVolatility` and `gjrGarch`: RiskMetrics EWMA and a small GJR-GARCH(1,1) coarse likelihood fit; conditional variance affects a feature and forecast intervals.
- `kalmanTrend` and `hurstRegime`: a 1D local-level Kalman filter and variance-ratio Hurst approximation for trend/regime features.
- `microstructureModule`: Level 2 depth imbalance, classified trade-flow imbalance, quoted/effective-spread proxy, and VPIN-style volume-bucket imbalance.
- `contextModule`: Fear & Greed, perpetual funding, and mempool fee state, used only as weak slow modifiers.
- `ensemble`: horizon-specific transparent logistic weights for 1m, 5m, 15m, and 1h.
- `onlineUpdate`: bounded online logistic SGD after a queued forecast matures in the current session.
- `confidenceInterval`: volatility-adjusted Wilson-style uncertainty interval.

The dashboard deliberately begins with an empty evaluation record after a reload. It queues forecasts, evaluates them only after their future horizon, then displays a rolling Brier score, hit rate, and probability-bucket calibration table. This is live session diagnostics, **not** a historical backtest.

## Sources and cadence

| Source | Endpoint | Use / cadence |
|---|---|---|
| Coinbase Exchange | `wss://ws-feed.exchange.coinbase.com`; `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60` | live ticker + L2, candles refreshed every 5 min |
| Alternative.me | `https://api.alternative.me/fng/?limit=1` | daily Fear & Greed context |
| Binance Futures | `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT` | periodic funding/positioning proxy |
| mempool.space | `https://mempool.space/api/v1/fees/recommended` | periodic on-chain fee/congestion context |

All are intended as public, free, keyless endpoints. Public endpoint browser access can vary by region, CORS policy, or provider change. Missing context inputs are neutral; they are never replaced with a different source. On-chain data is explicitly low-weight because its cadence is mismatched to minute forecasting.

## Important limitations

This page does not establish predictive skill, profitability, or suitability for any decision. It has no transaction-cost, execution, tax, or suitability model. It cannot see complete market-wide order flow and its trade classification is a simple browser-side proxy. It does not send orders or retain data across page reloads.
