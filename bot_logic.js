// TODO: Add unit tests for calculateIndicators and evaluateSignal to ensure strategy logic is correct.

import axios from "axios";
import { logger } from "./logger.js";
import { checkRisk } from "./risk.js";
import { executeTrade } from "./execution.js";
import { config } from "./config.js";
import { RSI, MACD, EMA, BollingerBands, ADX, StochasticRSI } from "technicalindicators";

async function fetchCandles(symbol, interval = config.ANALYSIS_TIMEFRAME, limit = config.CANDLE_LIMIT) {
  try {
    const response = await axios.get(config.MARKET_DATA_URL, {
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

function calculateIndicators(closes, highs, lows) {
  const rsi = RSI.calculate({ values: closes, period: config.RSI_PERIOD });
  const stochRsi = StochasticRSI.calculate({
    values: closes,
    rsiPeriod: config.STOCHRSI_PERIOD,
    stochasticPeriod: config.STOCHRSI_PERIOD,
    kPeriod: config.STOCHRSI_K,
    dPeriod: config.STOCHRSI_D
  });
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: config.MACD_FAST,
    slowPeriod: config.MACD_SLOW,
    signalPeriod: config.MACD_SIGNAL,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const ema50 = EMA.calculate({ period: config.EMA_PERIOD, values: closes });
  const bb = BollingerBands.calculate({
    period: config.BB_PERIOD, 
    stdDev: config.BB_STD_DEV,
    values: closes
  });
  const adx = ADX.calculate({
    period: config.ADX_PERIOD,
    high: highs,
    low: lows,
    close: closes
  });

  return { rsi, stochRsi, macd, ema50, bb, adx };
}

function evaluateSignal(lastRSI, lastStochRSI, lastMACD, lastEMA, lastBB, lastADX, currentPrice) {
  let score = 0;
  let signalType = null;

  // 1. TENTUKAN BIAS TREND UTAMA (30 Poin)
  // Harga DI ATAS EMA 200 = Bullish Bias -> Cari BUY
  // Harga DI BAWAH EMA 200 = Bearish Bias -> Cari SELL
  if (currentPrice > lastEMA) {
     signalType = "BUY";
  } else {
     signalType = "SELL";
  }
  score += 30; 

  // 2. MOMENTUM & KONDISI MARKET (RSI 14) (Max 30 Poin)
  // Kita ingin entry saat koreksi dalam trend (Dip Buying / Rally Selling)
  if (signalType === "BUY") {
      // Bullish: Cari RSI yang tidak overbought (>70), idealnya < 60 untuk room to grow, atau > 40 untuk momentum
      if (lastRSI > 40 && lastRSI < 70) score += 15; 
      if (lastRSI > 50) score += 15; // RSI di atas 50 menandakan Bullish Control
  } else {
      // Bearish: Cari RSI yang tidak oversold (<30)
      if (lastRSI < 60 && lastRSI > 30) score += 15;
      if (lastRSI < 50) score += 15; // RSI di bawah 50 menandakan Bearish Control
  }

  // 3. CONFIRMATION (MACD) (20 Poin)
  // MACD Histogram searah dengan trend
  if (signalType === "BUY") {
      if (lastMACD.histogram > 0) score += 20;
  } else {
      if (lastMACD.histogram < 0) score += 20;
  }

  // 4. TREND STRENGTH (ADX) (20 Poin)
  // ADX > 25 Menandakan Trend Kuat, sangat bagus untuk strategy 1H ini
  if (lastADX.adx > config.ADX_THRESHOLD) {
      score += 20;
  }

  return { score, signalType };
}

async function analyzeMarket(symbol) {
  const candles = await fetchCandles(symbol, config.ANALYSIS_TIMEFRAME, config.CANDLE_LIMIT);
  if (candles.length < 210) return null; // Ensure enough data for EMA200

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  const { rsi, stochRsi, macd, ema50, bb, adx } = calculateIndicators(closes, highs, lows);

  const currentPrice = closes[closes.length - 1];
  const lastRSI = rsi[rsi.length - 1];
  const lastStochRSI = stochRsi[stochRsi.length - 1] || { k: 50, d: 50 };
  const lastMACD = macd[macd.length - 1];
  const lastEMA = ema50[ema50.length - 1]; // This is actually EMA200 now based on config
  const lastBB = bb[bb.length - 1];
  const lastADX = adx[adx.length - 1];

  if(!lastRSI || !lastMACD || !lastEMA || !lastBB) return null;

  const { score, signalType } = evaluateSignal(lastRSI, lastStochRSI, lastMACD, lastEMA, lastBB, lastADX, currentPrice);

  if (score >= config.MIN_CONFIDENCE_SCORE) {
      logger.info(`Analisa Trend 1H ${symbol} ($${currentPrice}):
        - Trend (EMA200): ${currentPrice > lastEMA ? "BULLISH 🟢" : "BEARISH 🔴"}
        - ADX Strength: ${lastADX.adx.toFixed(2)} (${lastADX.adx > 25 ? "Strong" : "Weak"})
        - RSI(14): ${lastRSI.toFixed(2)}
        - MACD Hist: ${lastMACD.histogram.toFixed(4)}`);
      
      logger.info(`⚡ Trend Score ${symbol}: ${score}% (${signalType})`);
      
      const leverage = 5; // Requested Low Risk Leverage
      const baseResult = { 
        symbol, score, leverage, 
        rsi: lastRSI, macd: lastMACD.histogram, 
        stoch_k: lastStochRSI.k, stoch_d: lastStochRSI.d 
      };

      if (signalType === "BUY") {
        const tp = currentPrice * (1 + config.TP_PERCENT);
        const sl = currentPrice * (1 - config.SL_PERCENT);
        return { ...baseResult, action: "BUY", price: currentPrice, tp, sl };
      } 
      if (signalType === "SELL") {
        const tp = currentPrice * (1 - config.TP_PERCENT);
        const sl = currentPrice * (1 + config.SL_PERCENT);
        return { ...baseResult, action: "SELL", price: currentPrice, tp, sl };
      }
  }

  return null;
}

// Basic Idempotency: Track processed signal IDs to avoid duplicates
const processedSignalIds = new Set();
const lastTradeTimes = new Map(); // Cooldown tracker

async function pollExternalSignals() {
  const url = config.EXTERNAL_SIGNAL_URL;
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
          if (!execTp || !execSl) {
              if (action.toUpperCase() === 'BUY') {
                  execTp = execPrice * (1 + config.TP_PERCENT);
                  execSl = execPrice * (1 - config.SL_PERCENT);
              } else {
                   execTp = execPrice * (1 - config.TP_PERCENT);
                   execSl = execPrice * (1 + config.SL_PERCENT);
              }
          }

          // Execute
          await executeTrade({ symbol, action, price: execPrice, tp: execTp, sl: execSl, score: 100, leverage: 1 });
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
  for (const symbol of config.WATCHLIST) {
    try {
      // Cooldown Check
      const lastTrade = lastTradeTimes.get(symbol);
      if (lastTrade && (Date.now() - lastTrade) < config.TRADE_COOLDOWN_MS) {
          // logger.debug(`Skipping ${symbol} (Cooldown)`); // Optional generic log
          continue; 
      }

      const result = await analyzeMarket(symbol);

      if (result) {
        logger.info(`🔥 VALIDATED SIGNAL FOUND (${result.score}%): ${result.action} ${result.symbol} @ ${result.price} (TP: ${result.tp.toFixed(2)}, SL: ${result.sl.toFixed(2)})`);

        const riskCheck = await checkRisk();
        
        if (riskCheck.allowed) {
          await executeTrade(result);
          lastTradeTimes.set(symbol, Date.now()); // Set cooldown
          logger.info(`✅ Trade Executed: ${result.action} ${result.symbol} (x${result.leverage})`);
        } else {
          logger.warn(`⛔ Trade Blocked by Risk Manager: ${riskCheck.reason}`);
        }
      } else {
        // Silent (No Signal < 80%)
      }

    } catch (error) {
      logger.error(`Error processing ${symbol}: ${error.message}`);
    }
  }
}
