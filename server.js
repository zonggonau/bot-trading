import express from "express";
import dotenv from "dotenv";
// Imports removed: checkRisk, executeTrade (No longer needed for manual signals)
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

// Signal endpoint removed as per request (Bot runs autonomously via cron)

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
