import ccxt from "ccxt";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.BINANCE_API_KEY;
const secret = process.env.BINANCE_SECRET_KEY;

if (!apiKey || !secret) {
    console.error("❌ API Keys missing in .env file!");
    process.exit(1);
}

console.log(`Checking keys:\nAPI_KEY: ${apiKey.substring(0, 10)}...\nSECRET: ${secret.substring(0, 10)}...`);

async function checkFutures() {
    console.log("\n--- Checking FUTURES TESTNET ---");
    const exchange = new ccxt.binance({
        apiKey: apiKey,
        secret: secret,
        options: { defaultType: 'future' }
    });
    
    // Manual URL override for Futures Testnet
    exchange.urls['api'] = exchange.urls['api'] || {};
    exchange.urls['api']['fapiPublic'] = 'https://testnet.binancefuture.com/fapi/v1';
    exchange.urls['api']['fapiPrivate'] = 'https://testnet.binancefuture.com/fapi/v1';
    exchange.urls['api']['fapiPrivateV2'] = 'https://testnet.binancefuture.com/fapi/v2';
    
    try {
        const balance = await exchange.fetchBalance();
        console.log("✅ SUCCESS! These details are for FUTURES TESTNET.");
        console.log(`   Balance: ${balance.USDT ? balance.USDT.free : 0} USDT`);
        return true;
    } catch (e) {
        console.error(`❌ Failed on Futures Testnet: ${e.message}`);
        return false;
    }
}

async function checkSpot() {
    console.log("\n--- Checking SPOT TESTNET ---");
    const exchange = new ccxt.binance({
        apiKey: apiKey,
        secret: secret,
        options: { defaultType: 'spot' }
    });
    exchange.setSandboxMode(true); // Spot Testnet uses standard sandbox mode

    try {
        const balance = await exchange.fetchBalance();
        console.log("✅ SUCCESS! These details are for SPOT TESTNET.");
        // Spot balance structure might differ slightly but usually has key assets
        const usdt = balance.USDT ? balance.USDT.free : 0;
        const btc = balance.BTC ? balance.BTC.free : 0;
        console.log(`   Balance: ${usdt} USDT, ${btc} BTC`);
        return true;
    } catch (e) {
        console.error(`❌ Failed on Spot Testnet: ${e.message}`);
        return false;
    }
}

async function run() {
    const isFutures = await checkFutures();
    const isSpot = await checkSpot();

    console.log("\n================ SUMMARY ================");
    if (isFutures) {
        console.log("✅ Valid FUTURES Testnet Keys.");
        console.log("👉 Ensure TRADING_ENV=futures in .env");
    } else if (isSpot) {
        console.log("✅ Valid SPOT Testnet Keys.");
        console.log("👉 PLEASE NOTE: You are trying to trade FUTURES, but these keys are for SPOT.");
        console.log("👉 To fix: Go to https://testnet.binancefuture.com/en/Register.html and generate new FUTURE keys.");
    } else {
        console.log("❌ Keys are Invalid for both Futures and Spot Testnet.");
        console.log("👉 Please generate new keys.");
    }
    console.log("=========================================");
}

run();
