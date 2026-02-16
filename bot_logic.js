import axios from "axios";
import { logger } from "./logger.js";
import { checkRisk } from "./risk.js";
import { executeTrade } from "./execution.js";
import { RSI, MACD, EMA, BollingerBands, ADX } from "technicalindicators";


// Ganti URL ini dengan API sumber sinyal/market data Anda
// Contoh: Binance API untuk harga ticker
const MARKET_API_URL = "https://api.binance.com/api/v3/ticker/price";
// Watchlist aset populer dan stabil
const WATCHLIST = [
  "BTCUSDT", // Bitcoin
  "ETHUSDT", // Ethereum
  "BNBUSDT", // Binance Coin
  "ADAUSDT", // Cardano
  "SOLUSDT", // Solana
  "XRPUSDT", // Ripple
  "DOGEUSDT", // Dogecoin
  "MATICUSDT", // Polygon
  "LTCUSDT", // Litecoin
  "DOTUSDT", // Polkadot
  "AVAXUSDT", // Avalanche
  "LINKUSDT", // Chainlink
  "UNIUSDT", // Uniswap
  "ATOMUSDT", // Cosmos
  "ALGOUSDT", // Algorand
  "FILUSDT", // Filecoin
  "ICPUSDT", // Internet Computer
  "NEARUSDT", // NEAR Protocol
  "TONUSDT", // Toncoin
  "APTUSDT"  // Aptos
];

// Konfigurasi Indikator
const RSI_PERIOD = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const EMA_PERIOD = 200;
const BB_PERIOD = 20;
const BB_STD_DEV = 2;
const ADX_PERIOD = 14;
const ADX_THRESHOLD = 20; // Lower threshold for 15m Scalping flows
const MIN_CONFIDENCE = 75; // Minimum Score to trade (75-89% Spot, 90%+ Leverage)

// Risk Management Settings

// Risk Management Settings
// Risk Management Settings (SCALPING MODE)
const TP_PERCENT = 0.008; // Take Profit 0.8% (Quick Scalp)
const SL_PERCENT = 0.004; // Stop Loss 0.4% (Tight Safety)

async function fetchCandles(symbol, interval = "15m", limit = 250) {
  try {
    const response = await axios.get("https://api.binance.com/api/v3/klines", {
      params: { symbol, interval, limit }
    });
    // Format: [Open Time, Open, High, Low, Close, Volume, ...]
    return response.data.map(d => ({
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5])
    }));
  } catch (error) {
    logger.error(`Failed to fetch candles for ${symbol}: ${error.message}`);
    return [];
  }
}

async function analyzeMarket(symbol) {
  const candles = await fetchCandles(symbol);
  if (candles.length < 200) return null;

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  // 1. Calculate Primary Indicators (3)
  const rsi = RSI.calculate({ values: closes, period: RSI_PERIOD });
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: MACD_FAST,
    slowPeriod: MACD_SLOW,
    signalPeriod: MACD_SIGNAL,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const ema200 = EMA.calculate({ period: EMA_PERIOD, values: closes });
  
  // 4. Calculate Validation Indicator (Bollinger Bands)
  const bb = BollingerBands.calculate({
    period: BB_PERIOD, 
    stdDev: BB_STD_DEV,
    values: closes
  });

  // 5. Calculate Trend Strength (ADX)
  const adx = ADX.calculate({
    period: ADX_PERIOD,
    high: highs,
    low: lows,
    close: closes
  });

  // Get latest values
  const currentPrice = closes[closes.length - 1];
  const lastRSI = rsi[rsi.length - 1];
  const lastMACD = macd[macd.length - 1];
  const lastEMA = ema200[ema200.length - 1];
  const lastBB = bb[bb.length - 1];
  const lastADX = adx[adx.length - 1];

  logger.info(`Validating ${symbol} ($${currentPrice}):
    - RSI: ${lastRSI.toFixed(2)}
    - MACD: Hist=${lastMACD.histogram.toFixed(4)}
    - BB: Upper=${lastBB.upper.toFixed(2)} Lower=${lastBB.lower.toFixed(2)}
    - ADX: ${lastADX.adx.toFixed(2)}`);

  // --- SCORING SYSTEM (Target: 95% Confidence) ---
  let score = 0;
  let signalType = null;

  // 1. TREND CHECK (20%)
  // Buy: Price > EMA | Sell: Price < EMA
  if (currentPrice > lastEMA) {
     score += 20; 
     signalType = "BUY"; // Bias UP
  } else {
     score += 20;
     signalType = "SELL"; // Bias DOWN
  }

  // 2. MOMENTUM CHECK (25% - Weighted High)
  // Strict RSI for Sniper Mode
  if (signalType === "BUY") {
    if (lastRSI < 40) score += 25; // Very Discounted
  } else {
    if (lastRSI > 60) score += 25; // Very Expensive
  }

  // 3. STRENGTH CHECK (15%)
  if (lastADX.adx > ADX_THRESHOLD) score += 15;

  // 4. VALUE CHECK (20%)
  // Buy: Price < Middle Band | Sell: Price > Middle Band
  if (signalType === "BUY") {
    if (currentPrice < lastBB.middle) score += 20;
  } else {
    if (currentPrice > lastBB.middle) score += 20;
  }

  // 5. OBSERVER CHECK (20%)
  // MACD Histogram confirms direction
  if (signalType === "BUY") {
    if (lastMACD.histogram > 0) score += 20;
  } else {
    if (lastMACD.histogram < 0) score += 20;
  }

  logger.info(`🔍 Analysis Score for ${symbol}: ${score}% (${signalType})`);

  // FINAL DECISION
  if (score >= MIN_CONFIDENCE) {
    // Dynamic Leverage Logic
    const leverage = score >= 90 ? 2 : 1;
    const type = leverage > 1 ? "LEVERAGE (2x)" : "SPOT (1x)";

    logger.info(`🎯 Signal Qualifies as ${type}`);

    if (signalType === "BUY") {
      const tp = currentPrice * (1 + TP_PERCENT);
      const sl = currentPrice * (1 - SL_PERCENT);
      return { action: "BUY", price: currentPrice, tp, sl, score, leverage };
    } 
    if (signalType === "SELL") {
      const tp = currentPrice * (1 - TP_PERCENT);
      const sl = currentPrice * (1 + SL_PERCENT);
      return { action: "SELL", price: currentPrice, tp, sl, score, leverage };
    }
  }

  return null;
}

// Basic Idempotency: Track processed signal IDs to avoid duplicates
const processedSignalIds = new Set();

async function pollExternalSignals() {
  const url = process.env.EXTERNAL_SIGNAL_URL;
  if (!url) return;

  try {
    const response = await axios.get(url, { timeout: 5000 });
    const data = response.data;
    const signals = Array.isArray(data) ? data : [data];

    for (const signal of signals) {
      if (!signal || !signal.symbol || !signal.action) continue;

      // Prevent duplicate processing if ID is provided
      if (signal.id && processedSignalIds.has(signal.id)) continue;
      if (signal.id) processedSignalIds.add(signal.id);

      const { symbol, action, price, tp, sl } = signal;
      logger.info(`📥 External Signal Received: ${action} ${symbol}`);
      
      const riskCheck = await checkRisk();
      if (riskCheck.allowed) {
          let execPrice = price; 
          
          // Fetch current price if missing
          if (!execPrice) {
             const candles = await fetchCandles(symbol, "1m", 1);
             if (candles && candles.length > 0) {
                 execPrice = candles[0].close;
             } else {
                 logger.warn(`Skipping external signal ${symbol}: Price fetch failed`);
                 continue;
             }
          }
          
          let execTp = tp;
          let execSl = sl;
          // Calculate TP/SL if missing
          if (!execTp || !execSl) {
              if (action.toUpperCase() === 'BUY') {
                  execTp = execPrice * (1 + TP_PERCENT);
                  execSl = execPrice * (1 - SL_PERCENT);
              } else {
                   execTp = execPrice * (1 - TP_PERCENT);
                   execSl = execPrice * (1 + SL_PERCENT);
              }
          }

          // Execute
          await executeTrade(symbol, action, execPrice, execTp, execSl);
          logger.info(`✅ External Trade Executed: ${symbol}`);
      } else {
          logger.warn(`⛔ External Trade Blocked: ${riskCheck.reason}`);
      }
    }
  } catch (error) {
    // Ignore 404/empty to avoid log spam if no signals
    if (error.response && error.response.status !== 404) {
        logger.warn(`External Signal Poll Failed: ${error.message}`);
    }
  }
}

export async function runBotLoop() {
  logger.info("🤖 Starting Bot Loop Analysis...");

  // 1. Check External Signals First
  await pollExternalSignals();

  // 2. Run Internal Technical Analysis
  for (const symbol of WATCHLIST) {
    try {
      const result = await analyzeMarket(symbol);

      if (result) {
        const { action, price, tp, sl, score } = result;
        logger.info(`🔥 VALIDATED SIGNAL FOUND (${score}%): ${action} ${symbol} @ ${price} (TP: ${tp.toFixed(2)}, SL: ${sl.toFixed(2)})`);

        const riskCheck = await checkRisk();
        
        if (riskCheck.allowed) {
          const { leverage } = result;
          await executeTrade(symbol, action, price, tp, sl, leverage);
          logger.info(`✅ Trade Executed: ${action} ${symbol} (x${leverage})`);
        } else {
          logger.warn(`⛔ Trade Blocked by Risk Manager: ${riskCheck.reason}`);
        }
      } else {
        logger.info(`Creating bot... No Signal for ${symbol}`);
      }

    } catch (error) {
      logger.error(`Error processing ${symbol}: ${error.message}`);
    }
  }
}
