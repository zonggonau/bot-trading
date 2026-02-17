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

// Konfigurasi Indikator (SCALPING 1-5m Optimized)
const RSI_PERIOD = 9; // Dipercepat untuk respon 1-5 menit
const MACD_FAST = 6;  // Fast MACD
const MACD_SLOW = 13; // Slow MACD
const MACD_SIGNAL = 4; // Signal
const EMA_PERIOD = 50; // EMA 50 untuk Trend Jangka Pendek
const BB_PERIOD = 20;
const BB_STD_DEV = 2;
const ADX_PERIOD = 14;
const ADX_THRESHOLD = 20; 
const MIN_CONFIDENCE = 80; // Butuh konfirmasi kuat untuk Scalping

// Risk Management Settings (SCALPING 1-5 MENIT)
const TP_PERCENT = 0.005; // Take Profit 0.5% (Cepat keluar)
const SL_PERCENT = 0.003; // Stop Loss 0.3% (Cut loss ketat)

async function fetchCandles(symbol, interval = "5m", limit = 100) {
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
  // Main di TF 5 Menit (bisa juga 1m, tapi 5m lebih stabil untuk bot)
  const candles = await fetchCandles(symbol, "5m");
  if (candles.length < 50) return null;

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  // 1. Calculate Indicators
  const rsi = RSI.calculate({ values: closes, period: RSI_PERIOD });
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: MACD_FAST,
    slowPeriod: MACD_SLOW,
    signalPeriod: MACD_SIGNAL,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const ema50 = EMA.calculate({ period: EMA_PERIOD, values: closes }); // Trend Filter
  const bb = BollingerBands.calculate({
    period: BB_PERIOD, 
    stdDev: BB_STD_DEV,
    values: closes
  });
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
  const lastEMA = ema50[ema50.length - 1];
  const lastBB = bb[bb.length - 1];
  const lastADX = adx[adx.length - 1];

  // Pastikan indikator ready
  if(!lastRSI || !lastMACD || !lastEMA || !lastBB) return null;

  logger.info(`Analisa Scalping ${symbol} ($${currentPrice}):
    - RSI(9): ${lastRSI.toFixed(2)}
    - MACD: ${lastMACD.histogram.toFixed(4)}
    - EMA(50): ${lastEMA.toFixed(2)}
    - BB Pos: ${currentPrice < lastBB.lower ? "LOW" : (currentPrice > lastBB.upper ? "HIGH" : "MID")}`);

  // --- SCALPING SCORING SYSTEM ---
  let score = 0;
  let signalType = null;

  // 1. TENTUKAN BIAS (Trend Follow Scalping)
  // Harga di atas EMA 50 = Bias BUY
  // Harga di bawah EMA 50 = Bias SELL
  if (currentPrice > lastEMA) {
     signalType = "BUY";
  } else {
     signalType = "SELL";
  }

  // 2. MOMENTUM ENTRY (RSI & BB) (40 Poin)
  if (signalType === "BUY") {
      // Buy saat pullback (RSI Oversold atau menyentuh BB Lower)
      if (lastRSI < 40) score += 20; 
      if (lastRSI < 30) score += 10; // Extra score for extreme oversold
      if (currentPrice <= lastBB.lower * 1.002) score += 20; // Dekat Lower Band
  } else {
      // Sell saat rally (RSI Overbought atau menyentuh BB Upper)
      if (lastRSI > 60) score += 20;
      if (lastRSI > 70) score += 10; // Extra score for extreme overbought
      if (currentPrice >= lastBB.upper * 0.998) score += 20; // Dekat Upper Band
  }

  // 3. CONFIRMATION (MACD) (30 Poin)
  // Reversal tanda histogram mulai membalik
  if (signalType === "BUY") {
      // Histogram naik atau positif
      if (lastMACD.histogram > lastMACD.signal) score += 15;
      if (lastMACD.histogram > 0) score += 15;
  } else {
      // Histogram turun atau negatif
      if (lastMACD.histogram < lastMACD.signal) score += 15;
      if (lastMACD.histogram < 0) score += 15;
  }

  // 4. TREND STRENGTH (ADX) (10 Poin)
  // Scalping lebih aman saat ada volatilitas/trend
  if (lastADX.adx > 15) score += 10;

  // 5. PRICE ACTION (20 Poin)
  // Breakout confirmation (simple logic)
  if (signalType === "BUY") {
      if(currentPrice > lastBB.middle) score += 10; // Strong buy zone
  } else {
      if(currentPrice < lastBB.middle) score += 10; // Strong sell zone
  }

  logger.info(`⚡ Scalp Score ${symbol}: ${score}% (${signalType})`);

  // RESULT
  if (score >= MIN_CONFIDENCE) {
    const leverage = score >= 90 ? 5 : 1; // Scalping leverage lebih agresif jika yakin (Simulasi)
    
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
