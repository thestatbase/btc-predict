# BTC Pulse

A static, browser-only BTC-USD short-horizon signal dashboard built for GitHub Pages. It uses Coinbase Exchange's public market-data endpoints: historical 1-minute candles via REST and live ticker / Level 2 order-book updates via WebSocket. No API key, account, backend, or paid service is used.

## Publish with GitHub Pages

1. Create a new GitHub repository, for example `btc-pulse`.
2. Upload `index.html`, `style.css`, and `app.js` from this folder to the repository root and commit them.
3. In the repository, open **Settings → Pages**. Under *Build and deployment*, select **Deploy from a branch**, choose `main` and `/ (root)`, then save.
4. Wait for GitHub Pages to publish, then open the URL displayed on that page.

Opening `index.html` directly can work, but publishing it is preferable because some browsers impose stricter local-file networking rules.

## What the signal means

Each card estimates the likelihood that the BTC-USD price will be higher at the indicated horizon. It is a bounded, transparent heuristic based on 1/3/5-minute momentum, 8-vs-21 EMA trend, short realized volatility, relative volume, and level-2 order-book imbalance. It is intentionally **not** a trained model and it is not financial advice. Its probabilities are not calibrated against an out-of-sample backtest, so treat them as a research display rather than actionable forecasts.

## Reliability notes

The app reconnects automatically when the feed closes and refreshes candle history every five minutes. Public exchange data can be delayed, throttled, unavailable, or affected by network/CORS changes. The dashboard does not place orders and has no trading credentials.

## Future upgrade path

The next meaningful free improvement is data collection plus walk-forward backtesting: record candles/order-book features, train a simple regularized classifier offline, and publish its calibration and accuracy by horizon. A static GitHub Pages site alone cannot reliably retain a long-term live feature dataset.
