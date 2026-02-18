import dotenv from "dotenv";
dotenv.config();

import express from "express";
// Imports removed: checkRisk, executeTrade (No longer needed for manual signals)
import { logger } from "./logger.js";
import cron from "node-cron";
import { runBotLoop } from "./bot_logic.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Endpoint to view trading logs
app.get("/logs", async (req, res) => {
    try {
        const { getDB } = await import('./db.js');
        const db = await getDB();
        
        // Fetch last 50 trades, newest first
        const logs = await db.all("SELECT * FROM trades ORDER BY timestamp DESC LIMIT 50");
        
        // Simple HTML formatting for easy reading
        let html = `
        <html>
            <head>
                <title>OpenClaw Trading Logs</title>
                <style>
                    body { font-family: monospace; background: #0d1117; color: #c9d1d9; padding: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #30363d; padding: 8px; text-align: left; }
                    th { background: #161b22; }
                    tr:nth-child(even) { background: #161b22; }
                    .BUY { color: #2ea043; font-weight: bold; }
                    .SELL { color: #f85149; font-weight: bold; }
                    .header { display: flex; justify-content: space-between; align-items: center; }
                    h1 { margin: 0; }
                    a { color: #58a6ff; text-decoration: none; }
                </style>
                <meta http-equiv="refresh" content="30"> <!-- Auto-refresh every 30s -->
            </head>
            <body>
                <div class="header">
                    <h1>OpenClaw Trading Activity</h1>
                    <span>Auto-refresh: 30s</span>
                </div>
                <table>
                    <tr>
                        <th>ID</th>
                        <th>Time (UTC)</th>
                        <th>Symbol</th>
                        <th>Action</th>
                        <th>Price</th>
                        <th>Qty</th>
                        <th>TP</th>
                        <th>SL</th>
                        <th>Score</th>
                        <th>Indicators</th>
                    </tr>
                    ${logs.map(log => `
                        <tr>
                            <td>${log.id}</td>
                            <td>${log.timestamp}</td>
                            <td>${log.symbol}</td>
                            <td class="${log.action}">${log.action}</td>
                            <td>${log.price}</td>
                            <td>${log.quantity ? log.quantity.toFixed(4) : '-'}</td>
                            <td>${log.take_profit ? log.take_profit.toFixed(4) : '-'}</td>
                            <td>${log.stop_loss ? log.stop_loss.toFixed(4) : '-'}</td>
                            <td>${log.score}%</td>
                            <td>
                                RSI: ${log.rsi_value ? log.rsi_value.toFixed(2) : '-'}<br>
                                MACD: ${log.macd_histogram ? log.macd_histogram.toFixed(4) : '-'}
                            </td>
                        </tr>
                    `).join('')}
                </table>
            </body>
        </html>
        `;
        
        res.send(html);
    } catch (error) {
        logger.error(`Failed to fetch logs: ${error.message}`);
        res.status(500).send("Error fetching logs");
    }
});

app.listen(process.env.PORT, () => {
  console.log(`🚀 OpenClaw Bot running on port ${process.env.PORT}`);

  // Schedule Bot Loop: Runs every 1 minute
  // Crontab Format: * * * * * (Every minute)
  cron.schedule('* * * * *', () => {
    logger.info('⏰ Running Bot Loop...');
    runBotLoop();
  });

  // Run Immediately on Start
  runBotLoop();
});
