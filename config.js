// Global Bot Configuration

export const config = {
  // === TRADING PAIRS & MARKET ===
  // Watchlist of symbols to monitor
  WATCHLIST: [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "ADAUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "LTCUSDT",
    "DOTUSDT",
    "AVAXUSDT",
  ],
  // URL for fetching market data
  // Spot: https://api.binance.com/api/v3/klines
  // Futures Testnet: https://testnet.binancefuture.com/fapi/v1/klines
  // Futures Live: https://fapi.binance.com/fapi/v1/klines
  MARKET_DATA_URL: process.env.TRADING_ENV === 'futures' 
    ? (process.env.TRADING_MODE === 'testnet' ? "https://testnet.binancefuture.com/fapi/v1/klines" : "https://fapi.binance.com/fapi/v1/klines")
    : (process.env.TRADING_MODE === 'testnet' ? "https://testnet.binance.vision/api/v3/klines" : "https://api.binance.com/api/v3/klines"),
  // Timeframe for analysis (1H - 4H Strategy)
  ANALYSIS_TIMEFRAME: "1h",
  // Number of candles to fetch for analysis
  CANDLE_LIMIT: 200,

  // === STRATEGY PARAMETERS (TREND FOLLOWING 1H Optimized) ===
  // Confidence score required to place a trade (0-100)
  MIN_CONFIDENCE_SCORE: 75, // Slightly lower threshold for broader trend moves
  
  // RSI Settings
  RSI_PERIOD: 14, 
  
  // Stochastic RSI Settings
  STOCHRSI_PERIOD: 14,
  STOCHRSI_K: 3,
  STOCHRSI_D: 3,
  
  // MACD Settings
  MACD_FAST: 12, // Standard
  MACD_SLOW: 26, // Standard
  MACD_SIGNAL: 9, // Standard
  
  // EMA Settings (for trend direction)
  EMA_PERIOD: 200, // 200 EMA is key for Trend Following
  
  // Bollinger Bands Settings
  BB_PERIOD: 20,
  BB_STD_DEV: 2,
  
  // ADX Settings (for trend strength)
  ADX_PERIOD: 14,
  ADX_THRESHOLD: 25, // Stronger trend requirement

  // === RISK MANAGEMENT ===
  // The percentage of total equity to risk on a single trade (e.g., 0.01 for 1%)
  RISK_PER_TRADE: 0.02, // 2% Risk
  // Take Profit percentage (Target 3-8% -> Average ~5-6%)
  TP_PERCENT: 0.06, 
  // Stop Loss percentage (1-2%)
  SL_PERCENT: 0.02, 
  // Cooldown period: 1 Hour (since we trade on 1H candles)
  TRADE_COOLDOWN_MS: 60 * 60 * 1000, 
  // Target trade size in USDT
  TARGET_NOTIONAL_USDT: 50, // Slightly larger position size for Swing

  // === EXTERNAL SIGNALS ===
  // URL for polling external signals (optional)
  EXTERNAL_SIGNAL_URL: process.env.EXTERNAL_SIGNAL_URL || null,
};
