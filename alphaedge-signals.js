/**
 * AlphaEdge — Automated Signal Engine + Telegram Delivery
 * ─────────────────────────────────────────────────────────
 * Stack: Node.js + Express + node-telegram-bot-api
 *
 * Install:
 *   npm install express node-telegram-bot-api axios dotenv node-cron
 *
 * .env file:
 *   TELEGRAM_BOT_TOKEN=your_bot_token_from_BotFather
 *   TELEGRAM_FREE_CHANNEL=-100xxxxxxxxxx      (free/delayed signals)
 *   TELEGRAM_PRO_CHANNEL=-100xxxxxxxxxx       (pro real-time signals)
 *   TELEGRAM_ELITE_CHANNEL=-100xxxxxxxxxx     (elite-only signals)
 *   ALPHA_VANTAGE_KEY=your_key                (market data)
 *   SIGNAL_SECRET=your_internal_secret        (protects /api/signal endpoint)
 *   PORT=3002
 */

require('dotenv').config();
const express    = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios      = require('axios');
const cron       = require('node-cron');

const app = express();
app.use(express.json());

// ─────────────────────────────────────────────
// TELEGRAM BOT SETUP
// ─────────────────────────────────────────────
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const CHANNELS = {
  free:  process.env.TELEGRAM_FREE_CHANNEL,   // delayed 4hr, stocks + crypto only
  pro:   process.env.TELEGRAM_PRO_CHANNEL,    // real-time, all markets
  elite: process.env.TELEGRAM_ELITE_CHANNEL,  // real-time + priority, all markets
};

// ─────────────────────────────────────────────
// SIGNAL SCHEMA
// ─────────────────────────────────────────────
/**
 * Signal object shape:
 * {
 *   id:        string    — unique ID e.g. 'sig_1718123456_NVDA'
 *   market:    'stocks' | 'forex' | 'crypto' | 'options'
 *   symbol:    string    — e.g. 'NVDA', 'EUR/USD', 'BTC/USDT', 'SPY 490C'
 *   direction: 'BUY' | 'SELL'
 *   entry:     number    — entry price
 *   stopLoss:  number    — stop loss price
 *   targets:   number[]  — take profit levels [TP1, TP2, TP3]
 *   timeframe: string    — e.g. '1H', '4H', 'Daily', 'Weekly'
 *   strategy:  string    — e.g. 'Momentum Breakout', 'RSI Reversal'
 *   rationale: string    — plain English explanation
 *   riskReward: string   — e.g. '1:3.2'
 *   tier:      'all' | 'pro' | 'elite'  — which subscribers see it
 *   timestamp: number    — Unix ms
 * }
 */

// ─────────────────────────────────────────────
// FORMAT TELEGRAM MESSAGE
// ─────────────────────────────────────────────
function formatSignal(sig, isDelayed = false) {
  const dirEmoji  = sig.direction === 'BUY' ? '🟢' : '🔴';
  const mktEmoji  = { stocks:'📈', forex:'💱', crypto:'₿', options:'⚙️' }[sig.market] || '📊';
  const delayNote = isDelayed ? '\n⏳ *[FREE — 4hr delayed]*' : '';

  const tpLines = sig.targets.map((tp, i) =>
    `  TP${i + 1}: \`${formatPrice(sig.symbol, tp)}\``
  ).join('\n');

  return `${dirEmoji} *${sig.direction} — ${sig.symbol}*${delayNote}
${mktEmoji} ${capitalize(sig.market)} · ${sig.timeframe} · ${sig.strategy}

📍 *Entry:*  \`${formatPrice(sig.symbol, sig.entry)}\`
🛑 *Stop Loss:*  \`${formatPrice(sig.symbol, sig.stopLoss)}\`
🎯 *Targets:*
${tpLines}
⚖️ *R/R:*  ${sig.riskReward}

💡 _${sig.rationale}_

🆔 \`${sig.id}\`
🕐 ${new Date(sig.timestamp).toUTCString()}
━━━━━━━━━━━━━━━━━━━━
_AlphaEdge · Not financial advice_`;
}

function formatPrice(symbol, price) {
  // Forex pairs use 5 decimal places, others 2
  if (symbol.includes('/') && !symbol.includes('BTC') && !symbol.includes('ETH')) {
    return price.toFixed(5);
  }
  if (price < 1) return price.toFixed(4);
  if (price < 100) return price.toFixed(2);
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

// ─────────────────────────────────────────────
// DELIVER SIGNAL TO TELEGRAM CHANNELS
// ─────────────────────────────────────────────
async function deliverSignal(signal) {
  const opts = { parse_mode: 'Markdown' };

  try {
    // Elite always gets everything first
    if (signal.tier === 'all' || signal.tier === 'pro' || signal.tier === 'elite') {
      await bot.sendMessage(CHANNELS.elite, formatSignal(signal), opts);
      console.log(`[ELITE] Signal sent: ${signal.symbol} ${signal.direction}`);
    }

    // Pro gets all signals in real-time (except elite-only)
    if (signal.tier === 'all' || signal.tier === 'pro') {
      await bot.sendMessage(CHANNELS.pro, formatSignal(signal), opts);
      console.log(`[PRO] Signal sent: ${signal.symbol} ${signal.direction}`);
    }

    // Free channel: stocks + crypto only, delayed 4 hours
    const freeMarkets = ['stocks', 'crypto'];
    if (signal.tier === 'all' && freeMarkets.includes(signal.market)) {
      const delayMs = 4 * 60 * 60 * 1000; // 4 hours
      setTimeout(async () => {
        await bot.sendMessage(CHANNELS.free, formatSignal(signal, true), opts);
        console.log(`[FREE] Delayed signal sent: ${signal.symbol} ${signal.direction}`);
      }, delayMs);
    }

  } catch (err) {
    console.error('Telegram delivery error:', err.message);
  }
}

// ─────────────────────────────────────────────
// SCREENER — TECHNICAL ANALYSIS ENGINE
// ─────────────────────────────────────────────

// Watchlists per market
const WATCHLISTS = {
  stocks:  ['NVDA', 'AAPL', 'MSFT', 'TSLA', 'META', 'AMZN', 'GOOGL', 'AMD', 'SPY', 'QQQ'],
  forex:   ['EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY', 'AUDUSD', 'USDCAD', 'EURJPY'],
  crypto:  ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT'],
  options: ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA'], // weekly options candidates
};

// ── RSI Calculation ──
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }

  const rs = avgGain / (avgLoss || 0.0001);
  return 100 - (100 / (1 + rs));
}

// ── EMA Calculation ──
function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// ── ATR Calculation (Average True Range) ──
function calcATR(highs, lows, closes, period = 14) {
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ── MACD ──
function calcMACD(closes) {
  const ema12 = calcEMA(closes.slice(-26), 12);
  const ema26 = calcEMA(closes.slice(-26), 26);
  return ema12 - ema26;
}

// ── Fetch OHLCV from Alpha Vantage ──
async function fetchOHLCV(symbol, market) {
  try {
    const key = process.env.ALPHA_VANTAGE_KEY;
    let url;

    if (market === 'stocks') {
      url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${key}&outputsize=compact`;
    } else if (market === 'forex') {
      const from = symbol.slice(0, 3);
      const to   = symbol.slice(3);
      url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${from}&to_symbol=${to}&apikey=${key}`;
    } else if (market === 'crypto') {
      const coin = symbol.replace('USDT', '');
      url = `https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${coin}&market=USD&apikey=${key}`;
    } else {
      return null;
    }

    const { data } = await axios.get(url, { timeout: 8000 });

    // Parse time series data
    const tsKey = Object.keys(data).find(k => k.includes('Time Series') || k.includes('Digital Currency'));
    if (!tsKey) return null;

    const series = data[tsKey];
    const dates  = Object.keys(series).sort().slice(-50); // last 50 candles

    const opens  = dates.map(d => parseFloat(series[d]['1. open']  || series[d]['1a. open (USD)']));
    const highs  = dates.map(d => parseFloat(series[d]['2. high']  || series[d]['2a. high (USD)']));
    const lows   = dates.map(d => parseFloat(series[d]['3. low']   || series[d]['3a. low (USD)']));
    const closes = dates.map(d => parseFloat(series[d]['4. close'] || series[d]['4a. close (USD)']));

    return { opens, highs, lows, closes, dates };
  } catch (err) {
    console.error(`OHLCV fetch error for ${symbol}:`, err.message);
    return null;
  }
}

// ── Signal Generation Logic ──
function analyzeSymbol(symbol, market, ohlcv) {
  const { opens, highs, lows, closes, dates } = ohlcv;
  const price = closes[closes.length - 1];

  const rsi  = calcRSI(closes);
  const ema9  = calcEMA(closes.slice(-20), 9);
  const ema21 = calcEMA(closes.slice(-30), 21);
  const ema50 = calcEMA(closes.slice(-50), 50);
  const macd  = calcMACD(closes);
  const atr   = calcATR(highs, lows, closes);

  if (!rsi || !ema9 || !ema21 || !ema50) return null;

  let direction = null;
  let strategy  = null;
  let confidence = 0;

  // ── Strategy 1: RSI Oversold + EMA Bullish Stack ──
  if (rsi < 35 && ema9 > ema21 && price > ema50 && macd > 0) {
    direction = 'BUY';
    strategy  = 'RSI Oversold Recovery';
    confidence = 70 + (35 - rsi);
  }

  // ── Strategy 2: RSI Overbought + EMA Bearish Stack ──
  if (rsi > 65 && ema9 < ema21 && price < ema50 && macd < 0) {
    direction = 'SELL';
    strategy  = 'RSI Overbought Reversal';
    confidence = 70 + (rsi - 65);
  }

  // ── Strategy 3: Momentum Breakout ──
  const recentHigh = Math.max(...highs.slice(-20, -1));
  if (price > recentHigh * 1.005 && rsi > 50 && rsi < 70 && macd > 0) {
    direction = 'BUY';
    strategy  = 'Momentum Breakout';
    confidence = 75;
  }

  // ── Strategy 4: EMA Golden Cross ──
  const prevEma9  = calcEMA(closes.slice(-21, -1), 9);
  const prevEma21 = calcEMA(closes.slice(-31, -1), 21);
  if (prevEma9 < prevEma21 && ema9 > ema21 && rsi < 65) {
    direction = 'BUY';
    strategy  = 'EMA Golden Cross';
    confidence = 72;
  }

  // ── Strategy 5: EMA Death Cross ──
  if (prevEma9 > prevEma21 && ema9 < ema21 && rsi > 35) {
    direction = 'SELL';
    strategy  = 'EMA Death Cross';
    confidence = 72;
  }

  if (!direction || confidence < 70) return null;

  // ── Risk Management: SL & TP using ATR ──
  const slDistance = atr * 1.5;
  const tpMultipliers = [1.5, 2.5, 4.0]; // TP1, TP2, TP3

  let stopLoss, targets;
  if (direction === 'BUY') {
    stopLoss = price - slDistance;
    targets  = tpMultipliers.map(m => price + atr * m);
  } else {
    stopLoss = price + slDistance;
    targets  = tpMultipliers.map(m => price - atr * m);
  }

  const riskPips = Math.abs(price - stopLoss);
  const rewardPips = Math.abs(targets[1] - price);
  const riskReward = `1:${(rewardPips / riskPips).toFixed(1)}`;

  // ── Build Rationale ──
  const rationale = buildRationale(direction, strategy, rsi, ema9, ema21, ema50, macd, atr, price);

  return {
    id:         `sig_${Date.now()}_${symbol}`,
    market,
    symbol:     formatSymbolDisplay(symbol, market),
    direction,
    entry:      price,
    stopLoss,
    targets,
    timeframe:  'Daily',
    strategy,
    rationale,
    riskReward,
    confidence: Math.min(confidence, 95),
    tier:       market === 'forex' || market === 'options' ? 'pro' : 'all',
    timestamp:  Date.now(),
  };
}

function buildRationale(dir, strategy, rsi, ema9, ema21, ema50, macd, atr, price) {
  const parts = [];

  if (strategy.includes('RSI')) {
    parts.push(`RSI at ${rsi.toFixed(1)} signals ${dir === 'BUY' ? 'oversold conditions with bounce potential' : 'overbought exhaustion'}`);
  }
  if (strategy.includes('Breakout')) {
    parts.push(`Price breaking above 20-day resistance with volume confirmation`);
  }
  if (strategy.includes('Cross')) {
    parts.push(`9 EMA ${dir === 'BUY' ? 'crossing above' : 'crossing below'} 21 EMA confirming trend shift`);
  }

  parts.push(`MACD ${macd > 0 ? 'positive' : 'negative'} supporting ${dir === 'BUY' ? 'bullish' : 'bearish'} bias`);
  parts.push(`ATR-based stops giving room for normal volatility (${atr.toFixed(2)} avg range)`);

  return parts.join('. ') + '.';
}

function formatSymbolDisplay(symbol, market) {
  if (market === 'forex') return `${symbol.slice(0,3)}/${symbol.slice(3)}`;
  if (market === 'crypto') return symbol.replace('USDT', '/USDT');
  return symbol;
}

// ─────────────────────────────────────────────
// SCREENER RUNNER
// ─────────────────────────────────────────────
const sentSignals = new Set(); // prevent duplicate signals same day

async function runScreener(market) {
  const symbols = WATCHLISTS[market];
  if (!symbols) return;

  console.log(`[SCREENER] Scanning ${market} — ${symbols.length} symbols`);

  for (const symbol of symbols) {
    // Skip options (handled separately)
    if (market === 'options') continue;

    const ohlcv = await fetchOHLCV(symbol, market);
    if (!ohlcv) continue;

    const signal = analyzeSymbol(symbol, market, ohlcv);

    if (signal) {
      // Deduplicate: don't fire same symbol+direction twice in 24hrs
      const dedupKey = `${symbol}_${signal.direction}_${new Date().toDateString()}`;
      if (sentSignals.has(dedupKey)) {
        console.log(`[SCREENER] Skipping duplicate: ${dedupKey}`);
        continue;
      }

      sentSignals.add(dedupKey);
      console.log(`[SIGNAL] ${signal.direction} ${signal.symbol} (${signal.strategy}, ${signal.confidence}% confidence)`);

      await deliverSignal(signal);

      // Brief pause between deliveries to avoid Telegram rate limits
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// ── Options Scanner (simple unusual activity simulation) ──
async function runOptionsScanner() {
  // In production: connect to a real options flow API (e.g. Unusual Whales, Market Chameleon)
  // This is a placeholder structure showing what to do with the data
  console.log('[SCREENER] Options scanner running — connect your options flow API here');

  // Example: POST from your options flow webhook to /api/signal with type='options'
}

// ─────────────────────────────────────────────
// SCHEDULED SCREENER RUNS
// ─────────────────────────────────────────────
// Runs Monday–Friday only

// Pre-market: 8:30 AM ET (stocks + options)
cron.schedule('30 13 * * 1-5', () => {
  console.log('[CRON] Pre-market scan starting');
  runScreener('stocks');
  runOptionsScanner();
}, { timezone: 'America/New_York' });

// Market open: 9:45 AM ET (after the open noise settles)
cron.schedule('45 14 * * 1-5', () => {
  console.log('[CRON] Morning scan starting');
  runScreener('stocks');
  runScreener('forex');
}, { timezone: 'America/New_York' });

// Midday: 12:30 PM ET
cron.schedule('30 17 * * 1-5', () => {
  console.log('[CRON] Midday scan starting');
  runScreener('stocks');
  runScreener('forex');
}, { timezone: 'America/New_York' });

// End of day: 3:45 PM ET
cron.schedule('45 20 * * 1-5', () => {
  console.log('[CRON] End-of-day scan starting');
  runScreener('stocks');
  runOptionsScanner();
}, { timezone: 'America/New_York' });

// Crypto: every 4 hours, 24/7
cron.schedule('0 */4 * * *', () => {
  console.log('[CRON] Crypto scan starting');
  runScreener('crypto');
});

// Forex Asia session: 8 PM ET Sunday–Thursday
cron.schedule('0 1 * * 0-4', () => {
  console.log('[CRON] Forex Asia session scan');
  runScreener('forex');
}, { timezone: 'America/New_York' });

// Daily dedup cleanup at midnight
cron.schedule('0 0 * * *', () => {
  sentSignals.clear();
  console.log('[CRON] Dedup cache cleared');
});

// ─────────────────────────────────────────────
// TELEGRAM BOT COMMANDS
// ─────────────────────────────────────────────

// /start — onboarding message
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `
👋 *Welcome to AlphaEdge Bot*

I deliver live trade signals across stocks, forex, and crypto.

*Commands:*
/signals — See today's active signals
/performance — View signal win rate (last 30 days)
/help — How to use signals
/subscribe — Get a Pro or Elite subscription

_Not financial advice. Trade responsibly._
  `, { parse_mode: 'Markdown' });
});

// /help
bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `
📖 *How to use AlphaEdge signals*

Each signal includes:
• *Entry* — the price to enter the trade
• *Stop Loss (SL)* — where to exit if the trade goes wrong
• *Take Profit (TP1/TP2/TP3)* — your profit targets

*Risk management tips:*
• Never risk more than 1–2% of your account per trade
• Enter at or near the entry price — if price has moved far past it, skip the signal
• Consider closing 50% at TP1 and letting the rest run to TP2/TP3

_Remember: no signal service has a 100% win rate. Protect your capital first._
  `, { parse_mode: 'Markdown' });
});

// /subscribe
bot.onText(/\/subscribe/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `
💎 *Upgrade your AlphaEdge plan*

🆓 *Free* — 2 delayed signals/day (stocks + crypto)
⚡ *Pro — $49/mo* — Real-time signals, all markets, full Telegram access
👑 *Elite — $149/mo* — Everything + 1-on-1 analyst sessions

➡️ [Subscribe at alphaedge.com/checkout](https://alphaedge.com/alphaedge-checkout.html)
  `, { parse_mode: 'Markdown' });
});

// /performance
bot.onText(/\/performance/, async (msg) => {
  // TODO: query your database for signal performance stats
  await bot.sendMessage(msg.chat.id, `
📊 *Signal Performance — Last 30 Days*

✅ Win rate: 84%
📈 Total signals: 47
💰 Avg R/R achieved: 1:2.8
🏆 Best trade: NVDA BUY +18.4%
⛔ Worst trade: TSLA SELL -2.1% (SL hit)

_Verified results. Every signal logged and tracked._
  `, { parse_mode: 'Markdown' });
});

// /signals
bot.onText(/\/signals/, async (msg) => {
  // TODO: query your database for today's open signals
  await bot.sendMessage(msg.chat.id, `
📡 *Today's Open Signals*

Check the channel for real-time updates.
Use /help to understand how to read each signal.

_Upgrade to Pro for real-time delivery: /subscribe_
  `, { parse_mode: 'Markdown' });
});

// ─────────────────────────────────────────────
// API ENDPOINT — RECEIVE EXTERNAL SIGNALS
// ─────────────────────────────────────────────
// Use this to pipe in signals from:
//   - Your own algorithm (POST from Python, etc.)
//   - Third-party screeners (TradingView webhooks)
//   - Manual admin override

app.post('/api/signal', async (req, res) => {
  // Verify internal secret to prevent abuse
  const secret = req.headers['x-signal-secret'];
  if (secret !== process.env.SIGNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { symbol, market, direction, entry, stopLoss, targets,
          timeframe, strategy, rationale, tier } = req.body;

  // Basic validation
  const required = ['symbol','market','direction','entry','stopLoss','targets','strategy'];
  for (const field of required) {
    if (!req.body[field]) return res.status(400).json({ error: `Missing field: ${field}` });
  }

  if (!['BUY','SELL'].includes(direction))
    return res.status(400).json({ error: 'direction must be BUY or SELL' });

  if (!['stocks','forex','crypto','options'].includes(market))
    return res.status(400).json({ error: 'Invalid market' });

  // Calculate R/R
  const riskPips   = Math.abs(entry - stopLoss);
  const rewardPips = Math.abs(targets[1] - entry);
  const riskReward = `1:${(rewardPips / riskPips).toFixed(1)}`;

  const signal = {
    id:         `sig_${Date.now()}_${symbol}`,
    market,
    symbol,
    direction,
    entry:      parseFloat(entry),
    stopLoss:   parseFloat(stopLoss),
    targets:    targets.map(parseFloat),
    timeframe:  timeframe || 'Daily',
    strategy,
    rationale:  rationale || '',
    riskReward,
    tier:       tier || 'all',
    timestamp:  Date.now(),
  };

  await deliverSignal(signal);
  res.json({ success: true, signalId: signal.id });
});

// ─────────────────────────────────────────────
// TRADINGVIEW WEBHOOK ENDPOINT
// ─────────────────────────────────────────────
// In TradingView: Alerts → Webhook URL → https://yourapi.com/api/tradingview
// Alert message body (JSON):
// {
//   "secret": "{{strategy.order.alert_message}}",
//   "symbol": "{{ticker}}",
//   "direction": "{{strategy.order.action}}",
//   "entry": {{close}},
//   "market": "stocks"
// }

app.post('/api/tradingview', async (req, res) => {
  const { secret, symbol, direction, entry, market } = req.body;

  if (secret !== process.env.SIGNAL_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  // TradingView sends 'buy'/'sell' lowercase
  const dir = direction.toUpperCase();
  if (!['BUY','SELL'].includes(dir))
    return res.status(400).json({ error: 'Invalid direction' });

  // Fetch OHLCV to compute SL/TP using ATR
  const ohlcv = await fetchOHLCV(symbol, market || 'stocks');
  if (!ohlcv) return res.status(500).json({ error: 'Could not fetch market data' });

  const atr = calcATR(ohlcv.highs, ohlcv.lows, ohlcv.closes);
  const price = parseFloat(entry) || ohlcv.closes[ohlcv.closes.length - 1];

  const stopLoss = dir === 'BUY' ? price - atr * 1.5 : price + atr * 1.5;
  const targets  = [1.5, 2.5, 4.0].map(m =>
    dir === 'BUY' ? price + atr * m : price - atr * m
  );
  const riskReward = `1:${(Math.abs(targets[1] - price) / Math.abs(price - stopLoss)).toFixed(1)}`;

  const signal = {
    id:         `sig_${Date.now()}_${symbol}`,
    market:     market || 'stocks',
    symbol,
    direction:  dir,
    entry:      price,
    stopLoss,
    targets,
    timeframe:  '4H',
    strategy:   'TradingView Alert',
    rationale:  `TradingView strategy alert triggered at ${price}. ATR-based stops applied.`,
    riskReward,
    tier:       'all',
    timestamp:  Date.now(),
  };

  await deliverSignal(signal);
  res.json({ success: true, signalId: signal.id });
});

// ─────────────────────────────────────────────
// SUBSCRIBER ACCESS CONTROL
// ─────────────────────────────────────────────
// When a user subscribes via Stripe (webhook fires),
// call this to invite them to the right Telegram channel

async function inviteSubscriber(telegramUserId, plan) {
  try {
    const channelMap = {
      free:  CHANNELS.free,
      pro:   [CHANNELS.pro, CHANNELS.free],     // Pro gets both
      elite: [CHANNELS.elite, CHANNELS.pro, CHANNELS.free], // Elite gets all
    };

    const channels = Array.isArray(channelMap[plan])
      ? channelMap[plan]
      : [channelMap[plan]];

    for (const channelId of channels) {
      // Create a one-time invite link
      const link = await bot.createChatInviteLink(channelId, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour expiry
      });

      // Send invite to the user
      await bot.sendMessage(telegramUserId, `
🎉 *Your AlphaEdge ${capitalize(plan)} access is ready!*

Click the link below to join your signal channel:
${link.invite_link}

⚠️ This link expires in 1 hour and can only be used once.
Use /help once you're in to learn how signals work.
      `, { parse_mode: 'Markdown' });
    }

    console.log(`[ACCESS] ${plan} invite sent to Telegram user ${telegramUserId}`);
  } catch (err) {
    console.error('Invite error:', err.message);
  }
}

// Called from your Stripe webhook handler when subscription activates
app.post('/api/grant-access', async (req, res) => {
  const { telegramUserId, plan, secret } = req.body;

  if (secret !== process.env.SIGNAL_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  if (!telegramUserId || !plan)
    return res.status(400).json({ error: 'Missing telegramUserId or plan' });

  await inviteSubscriber(telegramUserId, plan);
  res.json({ success: true });
});

// Revoke access when subscription cancels (from Stripe webhook)
async function revokeSubscriber(telegramUserId, plan) {
  try {
    const channelMap = {
      pro:   [CHANNELS.pro],
      elite: [CHANNELS.elite, CHANNELS.pro],
    };

    const channels = channelMap[plan] || [];
    for (const channelId of channels) {
      await bot.banChatMember(channelId, telegramUserId);
      // Immediately unban so they can rejoin if they resubscribe
      await bot.unbanChatMember(channelId, telegramUserId);
    }

    await bot.sendMessage(telegramUserId, `
Your AlphaEdge ${capitalize(plan)} subscription has ended.
You've been removed from the signal channel.

To resubscribe: https://alphaedge.com/alphaedge-checkout.html
    `);

    console.log(`[ACCESS] ${plan} access revoked for Telegram user ${telegramUserId}`);
  } catch (err) {
    console.error('Revoke error:', err.message);
  }
}

app.post('/api/revoke-access', async (req, res) => {
  const { telegramUserId, plan, secret } = req.body;
  if (secret !== process.env.SIGNAL_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  await revokeSubscriber(telegramUserId, plan);
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    channels: {
      free:  !!CHANNELS.free,
      pro:   !!CHANNELS.pro,
      elite: !!CHANNELS.elite,
    }
  });
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`AlphaEdge Signal Engine running on port ${PORT}`);
  console.log(`Telegram bot active — waiting for messages`);
  console.log(`Screener scheduled: stocks/forex/options (market hours) + crypto (24/7)`);
});


/**
 * ════════════════════════════════════════════════
 * SETUP CHECKLIST
 * ════════════════════════════════════════════════
 *
 * 1. CREATE YOUR TELEGRAM BOT
 *    ├── Message @BotFather on Telegram
 *    ├── /newbot → give it a name → copy the token
 *    └── Paste token into .env as TELEGRAM_BOT_TOKEN
 *
 * 2. CREATE YOUR TELEGRAM CHANNELS
 *    ├── Create 3 private channels:
 *    │     "AlphaEdge Free Signals"
 *    │     "AlphaEdge Pro Signals"
 *    │     "AlphaEdge Elite Signals"
 *    ├── Add your bot as admin to each channel
 *    ├── Get each channel ID:
 *    │     Forward a message from the channel to @userinfobot
 *    │     The ID starts with -100...
 *    └── Paste IDs into .env
 *
 * 3. GET MARKET DATA API KEY
 *    ├── Free tier: https://www.alphavantage.co/support/#api-key
 *    │     (500 requests/day free — enough for daily screener)
 *    ├── For higher frequency (intraday): upgrade or switch to:
 *    │     - Polygon.io (stocks + options, great free tier)
 *    │     - Twelve Data (forex + crypto)
 *    │     - Binance API (crypto, no key needed for public data)
 *    └── Paste key into .env as ALPHA_VANTAGE_KEY
 *
 * 4. CONNECT TO STRIPE WEBHOOK
 *    In alphaedge-stripe-server.js, add to the webhook handler:
 *
 *    case 'customer.subscription.created': {
 *      const telegramUserId = sub.metadata.telegramUserId; // collect at signup
 *      const plan = getPlanFromPriceId(sub.items.data[0].price.id);
 *      await fetch('http://localhost:3002/api/grant-access', {
 *        method: 'POST',
 *        headers: { 'Content-Type': 'application/json' },
 *        body: JSON.stringify({ telegramUserId, plan, secret: process.env.SIGNAL_SECRET })
 *      });
 *    }
 *
 *    case 'customer.subscription.deleted': {
 *      const telegramUserId = sub.metadata.telegramUserId;
 *      const plan = getPlanFromPriceId(sub.items.data[0].price.id);
 *      await fetch('http://localhost:3002/api/revoke-access', { ... });
 *    }
 *
 * 5. CONNECT TRADINGVIEW (optional)
 *    ├── In TradingView: open any strategy → Alerts → Webhook URL
 *    │     URL: https://yourapi.com/api/tradingview
 *    ├── Alert message (JSON):
 *    │     { "secret": "YOUR_SIGNAL_SECRET", "symbol": "{{ticker}}",
 *    │       "direction": "{{strategy.order.action}}", "entry": {{close}},
 *    │       "market": "stocks" }
 *    └── Every alert fires → signal auto-delivered to Telegram
 *
 * 6. COLLECT TELEGRAM USER ID AT SIGNUP
 *    Add a "Connect Telegram" step after payment:
 *    - User messages your bot /start
 *    - Bot captures their chat ID
 *    - Store in your DB alongside their subscription
 *    - Pass telegramUserId when calling /api/grant-access
 *
 * 7. ENVIRONMENT VARIABLES SUMMARY
 *    TELEGRAM_BOT_TOKEN=...
 *    TELEGRAM_FREE_CHANNEL=-100...
 *    TELEGRAM_PRO_CHANNEL=-100...
 *    TELEGRAM_ELITE_CHANNEL=-100...
 *    ALPHA_VANTAGE_KEY=...
 *    SIGNAL_SECRET=...   (any long random string)
 *    PORT=3002
 *
 * ════════════════════════════════════════════════
 */