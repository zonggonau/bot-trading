# Panduan Menuju Live Trading (Uang Asli)

Saat ini, bot OpenClaw berjalan dalam **Mode Simulasi**. Artinya:

1.  Menggunakan Uang Mainan (tidak ada saldo asli yang berkurang).
2.  Data Market Asli (dari Binance), tapi Order Palsu.
3.  Strategi Random (Buy/Sell acak).

## Langkah-langkah untuk Live Trading:

### 1. Dapatkan API Key

Daftar ke exchange (misal: Binance, Tokocrypto, Bybit) dan buat API Key.
Simpan `API_KEY` dan `API_SECRET` Anda di file `.env`.

### 2. Aktifkan Eksekusi Nyata

Edit file `execution.js`. Ubah kode simulasi menjadi kode real menggunakan library seperti `ccxt`.

Contoh kode (pseudo-code):

```javascript
import ccxt from "ccxt";

const exchange = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_API_SECRET,
});

export async function executeTrade(symbol, action, price) {
  if (action === "BUY") {
    return await exchange.createMarketBuyOrder(symbol, 0.001); // Beli 0.001 BTC
  }
}
```

### 3. Gunakan Strategi Beneran

Edit file `bot_logic.js`. Ganti fungsi `analyzeMarket` dengan logika trading Anda.
Contoh: "Beli jika harga > Moving Average 200".

### 4. Isi Saldo (Fund Your Account)

Pastikan ada saldo USDT di akun exchange Anda.

**⚠️ PERINGATAN:** Trading dengan bot memiliki risiko tinggi. Pastikan kode Anda sudah diuji coba (backtesting) sebelum menggunakan uang asli.
