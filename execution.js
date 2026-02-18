import "dotenv/config";
import ccxt from "ccxt";
import { logger } from "./logger.js";
import { registerTrade } from "./risk.js";
import { sendNotification } from "./notification.js";
import { config } from "./config.js";

// Initialize Binance Exchange based on Environment
const tradingEnv = process.env.TRADING_ENV || 'spot';
const tradingMode = process.env.TRADING_MODE || 'live';

const exchange = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
  options: {
    defaultType: tradingEnv === 'futures' ? 'future' : 'spot', 
  },
});

if (tradingMode === 'testnet') {
  if (tradingEnv === 'futures') {
      // Manual Testnet URL Override for Futures
      exchange.urls['api'] = exchange.urls['api'] || {};
      exchange.urls['api']['fapiPublic'] = 'https://testnet.binancefuture.com/fapi/v1';
      exchange.urls['api']['fapiPrivate'] = 'https://testnet.binancefuture.com/fapi/v1';
      exchange.urls['api']['fapiPrivateV2'] = 'https://testnet.binancefuture.com/fapi/v2';
  } else {
      // Manual Testnet URL Override for Spot (testnet.binance.vision)
      exchange.urls['api'] = exchange.urls['api'] || {};
      exchange.urls['api']['public'] = 'https://testnet.binance.vision/api';
      exchange.urls['api']['private'] = 'https://testnet.binance.vision/api';
      exchange.urls['api']['v3'] = 'https://testnet.binance.vision/api/v3';
      
      exchange.setSandboxMode(true);
  }
}

// Log the API URLs to verify Configuration
logger.info(`Binance Configured: Env=${tradingEnv.toUpperCase()}, Mode=${tradingMode.toUpperCase()}`); 

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
    
    // --- SPOT: CHECK HOLDINGS FOR SELL ---
    if (tradingEnv === 'spot' && action.toUpperCase() === 'SELL') {
       // Extract base asset (e.g. BTC from BTCUSDT)
       // This assumes standard naming: BTCUSDT -> BTC
       // A safer way is via loadMarkets but for now we assume standard pairs
       const baseAsset = symbol.replace("USDT", ""); 
       
       try {
           const balance = await exchange.fetchBalance();
           const available = balance[baseAsset] ? parseFloat(balance[baseAsset].free) : 0;
           
           if (available < quantity) {
               logger.warn(`⚠️ SPOT SELL Skipped: Insufficient ${baseAsset}. Have: ${available}, Need: ${quantity}`);
               return { status: "skipped", reason: "insufficient_balance" };
           }
       } catch (e) {
           logger.error(`Failed to check asset balance for Spot Sell: ${e.message}`);
       }
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

    // 4. Place TP/SL Orders
    if (tp && sl) {
      try {
         const exitSide = side === 'buy' ? 'sell' : 'buy';
         const exitQty = exchange.amountToPrecision(symbol, order.amount);

         if (tradingEnv === 'futures') {
             // Futures: Separate orders with reduceOnly
             // Take Profit (Limit)
             await exchange.createOrder(symbol, 'LIMIT', exitSide, exitQty, exchange.priceToPrecision(symbol, tp), { reduceOnly: true });
             
             // Stop Loss (Stop Market)
             await exchange.createOrder(symbol, 'STOP_MARKET', exitSide, exitQty, null, { stopPrice: exchange.priceToPrecision(symbol, sl), reduceOnly: true });
             
             logger.info(`✅ Futures TP/SL Orders Placed! TP: ${tp}, SL: ${sl}`);
         } else {
             // Spot: OCO Order
             // Spot: OCO Order
             await exchange.privatePostOrderOco({
                symbol: symbol.replace('/', ''),
                side: exitSide.toUpperCase(), 
                quantity: exitQty, 
                price: exchange.priceToPrecision(symbol, tp),
                stopPrice: exchange.priceToPrecision(symbol, sl),
                stopLimitPrice: exchange.priceToPrecision(symbol, sl),
                stopLimitTimeInForce: 'GTC'
             });
             logger.info(`✅ Spot OCO Order Placed! TP: ${tp}, SL: ${sl}`);
         }
      } catch (exitError) {
         logger.error(`❌ TP/SL Execution Failed: ${exitError.message}. Manual monitoring required.`);
      }
    }

    // 5. Register Trade in Database
    try {
        await registerTrade({
            symbol,
            action,
            price,
            quantity: parseFloat(quantity), // Ensure number
            sl,
            tp,
            score: tradeData.score || 0,
            rsi: tradeData.rsi || 0,
            macd: tradeData.macd || 0,
            stoch_k: tradeData.stoch_k || 0,
            stoch_d: tradeData.stoch_d || 0
        });
    } catch (dbErr) {
        logger.error(`Failed to register trade in DB: ${dbErr.message}`);
    }
    // 6. Send Notification
    const finalTradeData = { ...tradeData, quantity: order.amount, price: order.price || price };
    const tradeDetails = `Action: **${action}**\nSymbol: **${symbol}**\nAvg Price: **$${finalTradeData.price}**\nQty: **${finalTradeData.quantity}**\nTP: **$${tp}**\nSL: **$${sl}**\nScore: **${tradeData.score}%**`;
    await sendNotification(`Trade Executed: ${action} ${symbol}`, tradeDetails);

    return {
      status: "filled",
      orderId: order.id,
      ...finalTradeData
    };

    return {
      status: "filled",
      orderId: order.id,
      ...finalTradeData
    };

  } catch (error) {
    if (error.message.includes("-2008") || error.message.includes("Invalid Api-Key ID")) {
        logger.error(`❌ INVALID API KEY DETECTED!`);
        logger.error(`💡 HINT: You are trying to trade FUTURES on TESTNET.`);
        logger.error(`   Please ensure you got your keys from: https://testnet.binancefuture.com/en/Register.html`);
        logger.error(`   Keys from 'demo.binance.com' (API Management) are often for SPOT only.`);
    }
    logger.error(`❌ Order Failed: ${error.message}`);
    // Potentially send a failure notification
    await sendNotification(`Trade FAILED: ${action} ${symbol}`, `Error: ${error.message}`);
    throw error;
  }
}
