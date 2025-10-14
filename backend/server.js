import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";
import morgan from "morgan";
import logger from "./logger.js";
import { createClient } from "redis";
import { connectDB } from "./db.js";       // MongoDB connection
import authRouter from "./routes/auth.js";
import ollamaRouter from "./routes/ollama.js";

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
  socket: {
    connectTimeout: 3000,
    lazyConnect: true,
    reconnectStrategy: false // Disable auto-reconnect
  }
});

let redisConnected = false;

redisClient.on("connect", () => {
  logger.debug("🔗 Redis connecting...");
});

redisClient.on("ready", () => {
  logger.info("✅ Redis ready");
  redisConnected = true;
});

redisClient.on("error", (err) => {
  logger.debug("⚠️ Redis not available:", err.message);
  redisConnected = false;
});

redisClient.on("end", () => {
  logger.debug("🔌 Redis connection closed");
  redisConnected = false;
});

export const isRedisReady = () => redisConnected && redisClient.isReady;

// -------------------- Health Check --------------------
app.get("/health", (req, res) => {
  const health = {
    status: "ok",
    redis: isRedisReady() ? "connected" : "disconnected",
    timestamp: new Date().toISOString()
  };
  res.status(200).json(health);
});

// -------------------- App Init --------------------
const initApp = async () => {
  try {
    logger.info("🚀 Starting backend...");

    // MongoDB connection
    await connectDB();

    // Redis connection (optional - app continues without it)
    try {
      await Promise.race([
        redisClient.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Redis connection timeout")), 3000))
      ]);
      logger.info("✅ Redis connected successfully");
    } catch (err) {
      logger.info("ℹ️ Starting without Redis - app will use direct DB queries");
    }

    // Routes
    app.use("/auth", authRouter);
    app.use("/ollama", ollamaRouter);

    // Global error handler
    app.use((err, req, res, next) => {
      logger.error("💥 Unhandled error: %s", err.stack || err.message);
      res.status(500).json({ msg: "Server error" });
    });

    const PORT = process.env.PORT || 8080;

    // ✅ Bind to 0.0.0.0 for Kubernetes probes
    app.listen(PORT, "0.0.0.0", () => logger.info(`🚀 Server running on http://0.0.0.0:${PORT}`));
  } catch (err) {
    logger.error("❌ Initialization failed: %s", err.stack || err.message);
    setTimeout(() => process.exit(1), 10000);
  }
};

// Start app
initApp();

// -------------------- Graceful Shutdown --------------------
const gracefulShutdown = async (signal) => {
  logger.info(`🛑 Received ${signal}, shutting down gracefully...`);
  try {
    if (isRedisReady()) {
      await redisClient.quit();
      logger.info("✅ Redis connection closed");
    }
    process.exit(0);
  } catch (error) {
    logger.error("❌ Error during shutdown", { error: error.message });
    process.exit(1);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// -------------------- Global Fallbacks --------------------
process.on("unhandledRejection", (reason) => {
  logger.error("⚠️ Unhandled Rejection", { reason: reason?.message || reason });
});

process.on("uncaughtException", (err) => {
  logger.error("🔥 Uncaught Exception", { error: err.message });
  process.exit(1);
});
