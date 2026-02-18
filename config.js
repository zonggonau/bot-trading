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
  // Timeframe for analysis (e.g., "1m", "5m", "15m", "1h")
  ANALYSIS_TIMEFRAME: "1m",
  // Number of candles to fetch for analysis
  CANDLE_LIMIT: 200,

  // === STRATEGY PARAMETERS (SCALPING 1-5m Optimized) ===
  // Confidence score required to place a trade (0-100)
  MIN_CONFIDENCE_SCORE: 80,
  
  // RSI Settings
  RSI_PERIOD: 9, 
  
  // Stochastic RSI Settings
  STOCHRSI_PERIOD: 14,
  STOCHRSI_K: 3,
  STOCHRSI_D: 3,
  
  // MACD Settings
  MACD_FAST: 6,
  MACD_SLOW: 13,
  MACD_SIGNAL: 4,
  
  // EMA Settings (for trend direction)
  EMA_PERIOD: 50,
  
  // Bollinger Bands Settings
  BB_PERIOD: 20,
  BB_STD_DEV: 2,
  
  // ADX Settings (for trend strength)
  ADX_PERIOD: 14,
  ADX_THRESHOLD: 20, // Minimum ADX value to consider a trend strong

  // === RISK MANAGEMENT ===
  // The percentage of total equity to risk on a single trade (e.g., 0.01 for 1%)
  RISK_PER_TRADE: 0.01,
  // Take Profit percentage (e.g., 0.005 for 0.5%)
  TP_PERCENT: 0.005,
  // Stop Loss percentage (e.g., 0.003 for 0.3%)
  SL_PERCENT: 0.003,
  // Cooldown period in milliseconds between trades for the same symbol
  TRADE_COOLDOWN_MS: 15 * 60 * 1000, // 15 minutes
  // Target trade size in USDT (increased to 20 to avoid min-notional errors after rounding)
  TARGET_NOTIONAL_USDT: 20,

  // === EXTERNAL SIGNALS ===
  // URL for polling external signals (optional)
  EXTERNAL_SIGNAL_URL: process.env.EXTERNAL_SIGNAL_URL || null,
};
