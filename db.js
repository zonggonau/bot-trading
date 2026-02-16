import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { logger } from "./logger.js";

let db = null;

// Initialize the database
export async function initDB() {
  if (db) return db;

  try {
    db = await open({
      filename: "./trading.db",
      driver: sqlite3.Database,
    });

    // Create tables if they don't exist
    await db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        action TEXT NOT NULL,
        price REAL NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'OPEN', -- OPEN, CLOSED, CANCELLED
        profit_loss REAL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS risk_stats (
        date TEXT PRIMARY KEY,
        daily_loss REAL DEFAULT 0,
        trade_count INTEGER DEFAULT 0
      );
    `);

    logger.info("Database initialized successfully");
    return db;
  } catch (error) {
    logger.error("Failed to initialize database", error);
    throw error;
  }
}

// Get the database instance
export async function getDB() {
  if (!db) {
    return await initDB();
  }
  return db;
}
