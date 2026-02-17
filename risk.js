import { getDB } from "./db.js";
import { logger } from "./logger.js";


export async function checkRisk() {
  const db = await getDB();
  const maxOpen = parseInt(process.env.MAX_OPEN_TRADES || 5);
  const maxDailyLoss = parseFloat(process.env.MAX_DAILY_LOSS || 100);

  // Get current open trades count
  const openTradesResult = await db.get(
    "SELECT COUNT(*) as count FROM trades WHERE status = 'OPEN'"
  );
  const currentOpenTrades = openTradesResult ? openTradesResult.count : 0;

  // Get today's daily loss
  const today = new Date().toISOString().split('T')[0];
  const dailyStats = await db.get(
    "SELECT daily_loss FROM risk_stats WHERE date = ?",
    [today]
  );
  const currentDailyLoss = dailyStats ? dailyStats.daily_loss : 0;

  logger.info(`Risk Check: Open Trades=${currentOpenTrades}/${maxOpen}, Daily Loss=${currentDailyLoss}/${maxDailyLoss}`);

  if (currentOpenTrades >= maxOpen) {
    return { allowed: false, reason: `Max open trades reached (${currentOpenTrades})` };
  }

  if (currentDailyLoss >= maxDailyLoss) {
    return { allowed: false, reason: `Daily loss limit reached (${currentDailyLoss})` };
  }

  return { allowed: true };
}

export async function registerTrade(trade) {
  const db = await getDB();
  const today = new Date().toISOString().split('T')[0];
  
  const { 
    symbol, action, price, quantity, sl: stop_loss, tp: take_profit, score,
    rsi, macd, stoch_k, stoch_d
  } = trade;

  try {
    await db.run(
      `INSERT INTO trades (
        symbol, action, price, quantity, stop_loss, take_profit, status,
        score, rsi_value, macd_histogram, stoch_k, stoch_d
      ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)`,
      [
        symbol, action, price, quantity, stop_loss, take_profit,
        score, rsi, macd, stoch_k, stoch_d
      ]
    );

    // Initialize daily stats if not exists
    await db.run(
      "INSERT OR IGNORE INTO risk_stats (date, daily_loss, trade_count) VALUES (?, 0, 0)",
      [today]
    );
    
    // Increment daily trade count
    await db.run(
      "UPDATE risk_stats SET trade_count = trade_count + 1 WHERE date = ?",
      [today]
    );

    logger.info(`Trade registered: ${symbol} ${action} @ ${price}`);
  } catch (error) {
    logger.error("Failed to register trade", error);
    throw error;
  }
}

export async function closeTrade(tradeId, profitLoss) {
  const db = await getDB();
  const today = new Date().toISOString().split('T')[0];
  const loss = profitLoss < 0 ? Math.abs(profitLoss) : 0;

  try {
    await db.run(
      "UPDATE trades SET status = 'CLOSED', profit_loss = ? WHERE id = ?",
      [profitLoss, tradeId]
    );

    if (loss > 0) {
      await db.run(
        "UPDATE risk_stats SET daily_loss = daily_loss + ? WHERE date = ?",
        [loss, today]
      );
    }
    
    logger.info(`Trade closed: ID ${tradeId}, P/L: ${profitLoss}`);
  } catch (error) {
    logger.error("Failed to close trade", error);
    throw error;
  }
}

export async function hasOpenPosition(symbol) {
  const db = await getDB();
  try {
    const result = await db.get(
      "SELECT count(*) as count FROM trades WHERE symbol = ? AND status = 'OPEN'",
      [symbol]
    );
    return result && result.count > 0;
  } catch (error) {
    logger.error(`Failed to check open position for ${symbol}`, error);
    return true; // Fail safe: assume open to prevent duplicates
  }
}
