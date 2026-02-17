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
        quantity REAL,
        stop_loss REAL,
        take_profit REAL,
        score REAL,
        rsi_value REAL,
        macd_histogram REAL,
        stoch_k REAL,
        stoch_d REAL,
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
    
    // --- Idempotent Schema Migration ---
    // Add new columns for backtesting and analysis if they don't exist
    const addColumn = async (colName, colType) => {
      try {
        await db.exec(`ALTER TABLE trades ADD COLUMN ${colName} ${colType}`);
        logger.info(`Column ${colName} added to trades table.`);
      } catch (e) {
        if (!e.message.includes("duplicate column name")) {
          logger.error(`Failed to add column ${colName}:`, e);
        }
      }
    };
    
    await addColumn('quantity', 'REAL');
    await addColumn('stop_loss', 'REAL');
    await addColumn('take_profit', 'REAL');
    await addColumn('score', 'REAL');
    await addColumn('rsi_value', 'REAL');
    await addColumn('macd_histogram', 'REAL');
    await addColumn('stoch_k', 'REAL');
    await addColumn('stoch_d', 'REAL');


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
