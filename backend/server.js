import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";
import { createClient } from "redis";
import morgan from "morgan";
import jwt from "jsonwebtoken";
import logger from "./logger.js";
import pool from "./db.js"; // ✅ uses improved db.js

dotenv.config();

const app = express();

// -------------------- Middleware --------------------
app.use(cors());
app.use(bodyParser.json());
app.use(
  morgan("combined", {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

// -------------------- Redis Setup --------------------
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.on("connect", () => logger.info("✅ Connected to Redis"));
redisClient.on("error", (err) =>
  logger.error("❌ Redis error: %s", err.stack || err.message)
);

// -------------------- JWT Helper --------------------
const generateToken = (user) => {
  return jwt.sign(
    { email: user.email, name: user.name },
    process.env.JWT_SECRET || "supersecret",
    { expiresIn: "1d" }
  );
};

// -------------------- App Init --------------------
const initApp = async () => {
  try {
    // Retry logic for NeonDB
    let connected = false;
    for (let i = 0; i < 5 && !connected; i++) {
      try {
        await pool.query("SELECT 1");
        connected = true;
        logger.info("✅ Connected to NeonDB");
      } catch (err) {
        logger.warn(`⚠️ DB connection attempt ${i + 1} failed: ${err.message}`);
        await new Promise((res) => setTimeout(res, 5000));
      }
    }

    if (!connected) {
      throw new Error("Failed to connect to NeonDB after multiple attempts");
    }

    // Connect Redis
    await redisClient.connect();

    // -------------------- Routes --------------------

    // Signup
    app.post("/auth/signup", async (req, res, next) => {
      const { email, password, name, username } = req.body;
      const finalName = name || username;

      if (!email || !password || !finalName) {
        logger.warn("Signup attempt with missing fields");
        return res.status(400).json({ msg: "Missing required fields" });
      }

      try {
        const existing = await pool.query(
          "SELECT * FROM users WHERE email = $1",
          [email]
        );
        if (existing.rows.length > 0) {
          logger.info("User already exists: %s", email);
          return res.status(400).json({ msg: "User already exists" });
        }

        await pool.query(
          "INSERT INTO users (email, password, name) VALUES ($1, $2, $3)",
          [email, password, finalName]
        );
        logger.info("User registered successfully: %s", email);

        const userData = { email, name: finalName };
        await redisClient.setEx(
          `user:${email}`,
          24 * 60 * 60,
          JSON.stringify(userData)
        );

        const token = generateToken(userData);
        res.status(201).json({
          msg: "User registered successfully",
          user: userData,
          token,
        });
      } catch (err) {
        logger.error("Signup error: %s", err.message);
        next(err);
      }
    });

    // Login
    app.post("/auth/login", async (req, res, next) => {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ msg: "Missing email or password" });
      }

      try {
        let user;

        // Try Redis cache
        const cachedUser = await redisClient.get(`user:${email}`);
        if (cachedUser) {
          user = JSON.parse(cachedUser);
          logger.info("⚡ Using cached user data for %s", email);
        } else {
          const result = await pool.query(
            "SELECT * FROM users WHERE email = $1 AND password = $2",
            [email, password]
          );
          if (result.rows.length === 0) {
            logger.warn("Invalid credentials for %s", email);
            return res.status(401).json({ msg: "Invalid credentials" });
          }
          user = result.rows[0];
          await redisClient.setEx(
            `user:${email}`,
            24 * 60 * 60,
            JSON.stringify(user)
          );
        }

        const token = generateToken(user);
        res.status(200).json({ msg: "Login successful", user, token });
      } catch (err) {
        logger.error("Login error: %s", err.message);
        next(err);
      }
    });

    // Health Check
    app.get("/", (req, res) => {
      res.send("Backend running successfully 🚀");
    });

    // Global Error Handler
    app.use((err, req, res, next) => {
      logger.error("Unhandled error: %s", err.stack || err.message);
      res.status(500).json({ msg: "Server error" });
    });

    // Start Server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      logger.info(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    logger.error("❌ Initialization failed: %s", err.stack || err.message);
    // Don’t crash immediately — wait before retrying
    setTimeout(() => process.exit(1), 10000);
  }
};

// Run app
initApp();

// -------------------- Global Fallbacks --------------------
process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`);
});

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
});
