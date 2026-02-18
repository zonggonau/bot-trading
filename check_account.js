import ccxt from "ccxt";
import dotenv from "dotenv";

dotenv.config();

const exchange = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET_KEY,
    options: { defaultType: 'spot' } // We are on Spot Testnet
});

// Configure Spot Testnet URLs
exchange.urls['api'] = exchange.urls['api'] || {};
exchange.urls['api']['public'] = 'https://testnet.binance.vision/api';
exchange.urls['api']['private'] = 'https://testnet.binance.vision/api';
exchange.urls['api']['v3'] = 'https://testnet.binance.vision/api/v3';
exchange.setSandboxMode(true);

async function checkAccount() {
    console.log("🔍 Fetching Account Data from Binance Spot Testnet...");
    
    try {
        // 1. Fetch Balance (Filtered for Major Assets)
        console.log("\n💰 MAJOR ASSETS:");
        const balance = await exchange.fetchBalance(); // Fetch balance BEFORE using it
        const relevantAssets = ['USDT', 'BTC', 'ETH', 'BNB'];
        let found = false;

        for (const asset of relevantAssets) {
            if (balance[asset]) {
                const free = balance[asset].free;
                const used = balance[asset].used;
                const total = balance[asset].total;
                if (total > 0) {
                    console.log(`   - ${asset}: Available=${free.toFixed(4)}, In Order=${used.toFixed(4)}, Total=${total.toFixed(4)}`);
                    found = true;
                }
            }
        }
        if (!found) console.log("   (No major assets found)");

        // 2. Fetch Open Orders
        console.log("\n📋 OPEN ORDERS:");
        const openOrders = await exchange.fetchOpenOrders();
        if (openOrders.length === 0) {
            console.log("   (No open orders)");
        } else {
            openOrders.forEach(o => {
                console.log(`   - [${o.symbol}] ${o.side.toUpperCase()} ${o.amount} @ ${o.price} (Type: ${o.type})`);
            });
        }

        // 3. Fetch Recent Trades (Specifically for BTC/USDT)
        console.log("\n📜 RECENT TRADES (History):");
        const symbols = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT'];
        
        for (const symbol of symbols) {
            try {
                // Fetch up to 5 most recent trades
                const trades = await exchange.fetchMyTrades(symbol, undefined, 5);
                if (trades.length > 0) {
                    console.log(`\n   --- ${symbol} ---`);
                    // Sort descending by time
                    trades.sort((a, b) => b.timestamp - a.timestamp);
                    trades.forEach(t => {
                         console.log(`   - [${new Date(t.timestamp).toLocaleTimeString()}] ${t.side.toUpperCase()} Price: ${t.price} | Qty: ${t.amount} | Cost: ${t.cost.toFixed(2)} USDT`);
                    });
                }
            } catch (e) {
                // Ignore if no trade history for symbol
            }
        }

    } catch (error) {
        console.error("❌ Error fetching data:", error.message);
    }
}

checkAccount();
