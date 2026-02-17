import "dotenv/config";
import ccxt from "ccxt";
import { logger } from "./logger.js";
import { registerTrade } from "./risk.js";
import { sendNotification } from "./notification.js";
import { config } from "./config.js";

// Initialize Binance Exchange instance with Testnet URLs
// Initialize Binance Exchange instance with Spot PRODUCTION Default URLs
const exchange = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
  options: {
    defaultType: 'spot', // Use Spot market (Real Trading)
  },
});

// Log the API URLs to verify Production configuration
logger.info(`Binance Configured. Using Default CCXT URLs (PRODUCTION)`); 

export async function executeTrade(tradeData) {
  const { symbol, action, price, tp, sl, leverage = 1 } = tradeData;

  // Ensure keys are loaded
  if (!exchange.apiKey || !exchange.secret) {
     exchange.apiKey = process.env.BINANCE_API_KEY;
     exchange.secret = process.env.BINANCE_SECRET_KEY;
  }
  if (!exchange.apiKey) {
      logger.error("❌ API KEY MISSING in executeTrade! Check .env file.");
      throw new Error("API Key Missing");
  }

  logger.info(`🚀 Executing Trade: ${action} ${symbol} @ ${price} [TP: ${tp}, SL: ${sl}]`);

  try {
    const side = action.toUpperCase() === "BUY" ? "buy" : "sell";
    let quantity;

    // --- DYNAMIC RISK-BASED POSITION SIZING ---
    try {
      const balance = await exchange.fetchBalance();
      const equity = (balance['USDT'] && balance['USDT'].free) ? parseFloat(balance['USDT'].free) : 0;
      logger.info(`💰 Total Equity (USDT): ${equity.toFixed(2)}`);

      const riskAmount = equity * config.RISK_PER_TRADE;
      const slDistance = Math.abs(price - sl);

      if (equity > 10 && slDistance > 0) { // Min equity check and avoid division by zero
        quantity = riskAmount / slDistance;
        logger.info(`🎯 Dynamic Sizing: Risking ${riskAmount.toFixed(2)} USDT (${config.RISK_PER_TRADE * 100}% of Equity). SL Distance: ${slDistance.toFixed(4)}. Calculated Qty: ${quantity}`);
      } else {
        // Fallback to fixed notional size if SL is too close or balance is low
        quantity = config.TARGET_NOTIONAL_USDT / price;
        logger.warn(`⚠️ SL distance too small or low balance. Falling back to fixed notional size. Qty: ${quantity}`);
      }
    } catch (balErr) {
      quantity = config.TARGET_NOTIONAL_USDT / price;
      logger.warn(`Failed to fetch balance for dynamic sizing: ${balErr.message}. Using fixed notional size. Qty: ${quantity}`);
    }
    
    // Adjust to exchange precision limits (simple rounding, can be improved by fetching market data)
    await exchange.loadMarkets();
    quantity = exchange.amountToPrecision(symbol, quantity);

    logger.info(`Final Quantity after precision adjustment: ${quantity}`);

    // Ensure minimums
    const cost = quantity * price;
    if (cost < 10) {
      logger.error(`❌ Order value is less than 10 USDT (value: ${cost.toFixed(2)}). Aborting.`);
      throw new Error("Order value too low");
    }

    // 3. Send Main Order
    const order = await exchange.createMarketOrder(symbol, side, quantity);
    logger.info(`✅ Main Order Placed! ID: ${order.id}, Qty: ${order.amount}`);

    // 4. Place TP/SL Orders (OCO for Spot)
    if (tp && sl) {
      try {
         const ocoAmount = exchange.amountToPrecision(symbol, order.amount);
         await exchange.privatePostOrderOco({
            symbol: symbol.replace('/', ''),
            side: side === 'buy' ? 'SELL' : 'BUY', 
            quantity: ocoAmount, // Use the actual executed quantity
            price: exchange.priceToPrecision(symbol, tp),
            stopPrice: exchange.priceToPrecision(symbol, sl),
            stopLimitPrice: exchange.priceToPrecision(symbol, sl),
            stopLimitTimeInForce: 'GTC'
         });
         logger.info(`✅ OCO Order Placed! TP: ${tp}, SL: ${sl}`);
      } catch (ocoError) {
         logger.error(`❌ OCO Failed: ${ocoError.message}. Manual monitoring required.`);
      }
    }

    // 5. Register in Local DB
    const finalTradeData = { ...tradeData, quantity: order.amount, price: order.price || price };
    await registerTrade(finalTradeData);

    // 6. Send Notification
    const tradeDetails = `Action: **${action}**\nSymbol: **${symbol}**\nAvg Price: **$${finalTradeData.price}**\nQty: **${finalTradeData.quantity}**\nTP: **$${tp}**\nSL: **$${sl}**\nScore: **${tradeData.score}%**`;
    await sendNotification(`Trade Executed: ${action} ${symbol}`, tradeDetails);

    return {
      status: "filled",
      orderId: order.id,
      ...finalTradeData
    };

  } catch (error) {
    logger.error(`❌ Order Failed: ${error.message}`);
    // Potentially send a failure notification
    await sendNotification(`Trade FAILED: ${action} ${symbol}`, `Error: ${error.message}`);
    throw error;
  }
}
