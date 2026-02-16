import axios from "axios";
import { logger } from "./logger.js";

// Load webhook URL from .env
const WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL;

export async function sendNotification(message, details = null) {
  if (!WEBHOOK_URL) {
      // return silently to avoid log spam if no webhook is set
      return;
  }

  try {
    // Determine format based on service (Simple heuristic: Discord vs Generic)
    const payload = {};
    
    if (WEBHOOK_URL.includes("discord.com")) {
      // Discord Format
      // Construct a rich embed
      const color = message.includes("BUY") ? 3066993 : (message.includes("SELL") ? 15158332 : 3447003); // Green/Red/Blue
      
      payload.embeds = [{
        title: "🐯 OpenClaw Trade Alert",
        description: `**${message}**\n\n${details || ""}`,
        color: color,
        footer: {
           text: "Automated by OpenClaw",
           icon_url: "https://i.imgur.com/AfFp7pu.png"
        },
        timestamp: new Date().toISOString()
      }];
    } else {
      // Generic JSON (Slack/Telegram/Custom)
      payload.text = message;
      payload.details = details;
    }

    await axios.post(WEBHOOK_URL, payload);
    logger.info("📢 Notification sent successfully!");
    
  } catch (error) {
    logger.error(`Failed to send notification: ${error.message}`);
  }
}
