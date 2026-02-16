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
const ADX_THRESHOLD = 30; // Increased for higher quality trends
const MIN_CONFIDENCE = 95; // Minimum Score to trade

// Risk Management Settings

// Risk Management Settings
const TP_PERCENT = 0.015; // Take Profit 1.5%
const SL_PERCENT = 0.0075; // Stop Loss 0.75%

async function fetchCandles(symbol, interval = "1h", limit = 250) {
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
    if (signalType === "BUY") {
      const tp = currentPrice * (1 + TP_PERCENT);
      const sl = currentPrice * (1 - SL_PERCENT);
      return { action: "BUY", price: currentPrice, tp, sl, score };
    } 
    if (signalType === "SELL") {
      const tp = currentPrice * (1 - TP_PERCENT);
      const sl = currentPrice * (1 + SL_PERCENT);
      return { action: "SELL", price: currentPrice, tp, sl, score };
    }
  }

  return null;
}

export async function runBotLoop() {
  logger.info("🤖 Starting Bot Loop Analysis...");

  for (const symbol of WATCHLIST) {
    try {
      const result = await analyzeMarket(symbol);

      if (result) {
        const { action, price, tp, sl, score } = result;
        logger.info(`🔥 VALIDATED SIGNAL FOUND (${score}%): ${action} ${symbol} @ ${price} (TP: ${tp.toFixed(2)}, SL: ${sl.toFixed(2)})`);

        const riskCheck = await checkRisk();
        
        if (riskCheck.allowed) {
          await executeTrade(symbol, action, price, tp, sl);
          logger.info(`✅ Trade Executed: ${action} ${symbol}`);
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
