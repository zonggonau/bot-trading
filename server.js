import express from "express";
import dotenv from "dotenv";
import { checkRisk } from "./risk.js";
import { executeTrade } from "./execution.js";
import { logger } from "./logger.js";
import cron from "node-cron";
import { runBotLoop } from "./bot_logic.js";


dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/signal", async (req, res) => {

  if (!req.body) {
    return res.status(400).json({ error: "Missing request body" });
  }
  const { symbol, action, price, secret } = req.body;

  if (secret !== process.env.SIGNAL_SECRET) {
    logger.warn("Unauthorized signal attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  logger.info(`Signal received: ${symbol} ${action}`);

  const riskCheck = await checkRisk(); // Await the async function

  if (!riskCheck.allowed) {
    logger.warn(`Trade blocked: ${riskCheck.reason}`);
    return res.json({ status: "blocked", reason: riskCheck.reason });
  }

  try {
    const result = await executeTrade(symbol, action, price);
    res.json({ status: "success", result });

  } catch (error) {
    logger.error("Execution failed", error);
    res.status(500).json({ error: "Execution failed" });
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
