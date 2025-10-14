import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import logger from "./logger.js";

dotenv.config();

const uri = process.env.DATABASE_URL || "mongodb://mongouser:mongopass@mongodb-service:27017/mydatabase";

const client = new MongoClient(uri, { 
  serverSelectionTimeoutMS: 5000 // wait max 5 seconds
});

let db;

export const connectDB = async () => {
  try {
    await client.connect();
    db = client.db(); // Use database from URI
    logger.info("✅ Connected to MongoDB");
  } catch (err) {
    logger.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }
};

export const getDB = () => {
  if (!db) throw new Error("Database not initialized");
  return db;
};
