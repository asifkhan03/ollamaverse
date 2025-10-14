import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";
import morgan from "morgan";
import logger from "./logger.js";
import { createClient } from "redis";
import { connectDB } from "./db.js";       // MongoDB connection
import authRouter from "./routes/auth.js";

dotenv.config();
const app = express();

// -------------------- Middleware --------------------
app.use(cors());
app.use(bodyParser.json());
app.use(
  morgan("combined", { stream: { write: (msg) => logger.info(msg.trim()) } })
);

// -------------------- Redis Setup --------------------
export const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.on("connect", () => logger.info("✅ Connected to Redis"));
redisClient.on("ready", () => logger.info("🔁 Redis ready"));
redisClient.on("reconnecting", () => logger.warn("♻️ Reconnecting to Redis..."));
redisClient.on("end", () => logger.warn("❌ Redis closed"));
redisClient.on("error", (err) => logger.error("❌ Redis error: %s", err.message));

// -------------------- Health Check --------------------
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

// -------------------- App Init --------------------
const initApp = async () => {
  try {
    logger.info("🚀 Starting backend...");

    // MongoDB connection
    await connectDB();

    // Redis connection (non-blocking if it fails)
    try {
      await redisClient.connect();
      logger.info("✅ Redis connected");
    } catch (err) {
      logger.warn("⚠️ Redis connection failed, continuing without Redis: %s", err.message);
    }

    // Routes
    app.use("/auth", authRouter);

    // Global error handler
    app.use((err, req, res, next) => {
      logger.error("💥 Unhandled error: %s", err.stack || err.message);
      res.status(500).json({ msg: "Server error" });
    });

    const PORT = process.env.PORT || 5000;

    // ✅ Bind to 0.0.0.0 for Kubernetes probes
    app.listen(PORT, "0.0.0.0", () => logger.info(`🚀 Server running on http://0.0.0.0:${PORT}`));
  } catch (err) {
    logger.error("❌ Initialization failed: %s", err.stack || err.message);
    setTimeout(() => process.exit(1), 10000);
  }
};

// Start app
initApp();

// -------------------- Global Fallbacks --------------------
process.on("unhandledRejection", (reason) => logger.error("⚠️ Unhandled Rejection: %s", reason));
process.on("uncaughtException", (err) => logger.error("🔥 Uncaught Exception: %s", err.message));
