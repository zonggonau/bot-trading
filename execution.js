import "dotenv/config";
import ccxt from "ccxt";
import { logger } from "./logger.js";
import { registerTrade } from "./risk.js";
import { sendNotification } from "./notification.js";

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

export async function executeTrade(symbol, action, price, tp, sl) {
  // Ensure keys are loaded (just in case init happened before dotenv)
  if (!exchange.apiKey || !exchange.secret) {
     exchange.apiKey = process.env.BINANCE_API_KEY;
     exchange.secret = process.env.BINANCE_SECRET_KEY;
  }
  
  if (!exchange.apiKey) {
      logger.error("❌ API KEY MISSING in executeTrade! Check .env file.");
      throw new Error("API Key Missing");
  }

  logger.info(`🚀 Executing REAL PRODUCTION Trade: ${action} ${symbol} @ ${price} [TP: ${tp}, SL: ${sl}]`);

  try {
    // 1. Determine Order Side
    const side = action.toUpperCase() === "BUY" ? "buy" : "sell";
    
    // 2. Set Quantity (Dynamic based on Price)
    // Target trade size: ~12 USDT (Fits $13 Balance & > $10 Min Order)
    // CONFIRMED: Using Spot API v3 (No Leverage)
    const targetNotional = 12; 
    let quantity = targetNotional / price;
    
    // Adjust to exchange precision limits
    // Need to load markets first to get precision info, but for speed we can try a generic approach or load once.
    // Ideally: await exchange.loadMarkets(); inside init.
    // Here we will use CCXT's built-in precision handling if markets are loaded, or a safe fallback.
    
    // Hack: Round to 0 decimals for low value coins (ALGO, XRP, DOGE), 2-3 for high value.
    if (price < 1) quantity = Math.floor(quantity); // e.g. ALGO 0.1 -> qty 150
    else if (price < 10) quantity = parseFloat(quantity.toFixed(1));
    else if (price < 1000) quantity = parseFloat(quantity.toFixed(2));
    else quantity = parseFloat(quantity.toFixed(3)); // BTC, ETH

    // Ensure minimums for specific coins based on error log
    if (symbol.includes("BTC")) quantity = Math.max(quantity, 0.001);
    if (symbol.includes("ETH")) quantity = Math.max(quantity, 0.01);

    // 3. Send Main Order
    const order = await exchange.createMarketOrder(symbol, side, quantity);
    logger.info(`✅ Main Order Placed! ID: ${order.id}`);

    // 4. Place TP/SL Orders (if main order successful)
    if (tp && sl) {
      try {
        const exitSide = side === 'buy' ? 'sell' : 'buy';
        const isSpot = exchange.options.defaultType === 'spot';

        if (isSpot) {
          // SPOT MARKET: Use OCO (One-Cancels-the-Other) if possible, or simple Limits
          // Note: OCO is complex in CCXT. Let's try separate orders but expect balance errors if we try both.
          // For safety/simplicity in this demo: Just place a STOP LOSS LIMIT order.
          
          await exchange.createOrder(symbol, 'STOP_LOSS_LIMIT', exitSide, quantity, sl, {
            'stopPrice': sl,
            'timeInForce': 'GTC'
          });
          logger.info(`🛡️ Spot Stop Loss Limit set at ${sl}`);
          
          // TP as simple Limit Order (might fail if balance locked by SL)
          // await exchange.createOrder(symbol, 'LIMIT', exitSide, quantity, tp); 

        } else {
          // FUTURES MARKET
          // Stop Loss Order
          await exchange.createOrder(symbol, 'STOP_MARKET', exitSide, quantity, undefined, {
            'stopPrice': sl,
            'closePosition': true // Reduce Only
          });
          logger.info(`🛡️ Stop Loss set at ${sl}`);

          // Take Profit Order
          await exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', exitSide, quantity, undefined, {
            'stopPrice': tp,
            'closePosition': true // Reduce Only
          });
          logger.info(`💰 Take Profit set at ${tp}`);
        }
        
      } catch (err) {
        logger.warn(`⚠️ Failed to set TP/SL: ${err.message}`);
      }
    }

    // 4. Register in Local DB
    await registerTrade(symbol, action, order.price || price);

    // 5. Send Notification
    const tradeDetails = `Action: **${action}**\nSymbol: **${symbol}**\nPrice: **$${order.price || price}**\nQuantity: **${quantity}**\nTake Profit: **$${tp}**\nStop Loss: **$${sl}**\nOrder ID: \`${order.id}\``;
    await sendNotification(`Trade Executed: ${action} ${symbol}`, tradeDetails);

    return {
      status: "filled",
      orderId: order.id,
      symbol,
      action,
      qty: quantity,
      price: order.price
    };

  } catch (error) {
    logger.error(`❌ Order Failed: ${error.message}`);
    throw error;
  }
}
