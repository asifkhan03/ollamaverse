import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";
import pkg from "pg";
import { createClient } from "redis";
import morgan from "morgan";
import logger from "./logger.js";
import jwt from "jsonwebtoken";

dotenv.config();

const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(bodyParser.json());

// -------------------- Morgan HTTP request logging --------------------
app.use(morgan("combined", {
  stream: { write: (message) => logger.info(message.trim()) }
}));

// -------------------- PostgreSQL Setup --------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.connect()
  .then(() => logger.info("✅ Connected to NeonDB"))
  .catch((err) => logger.error("❌ DB connection failed: %s", err.stack || err.message));

// -------------------- Redis Setup --------------------
const redisClient = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });

redisClient.on("connect", () => logger.info("✅ Connected to Redis"));
redisClient.on("error", (err) => logger.error("❌ Redis error: %s", err.stack || err.message));

await redisClient.connect();

// -------------------- JWT Helper --------------------
const generateToken = (user) => {
  return jwt.sign(
    { email: user.email, name: user.name },
    process.env.JWT_SECRET || "supersecret",
    { expiresIn: "1d" }
  );
};

// -------------------- Auth Routes --------------------
app.post("/auth/signup", async (req, res, next) => {
  const { email, password, name, username } = req.body;
  const finalName = name || username;

  if (!email || !password || !finalName) {
    logger.warn("Signup attempt with missing fields: %o", { ...req.body, password: "***" });
    return res.status(400).json({ msg: "Missing required fields" });
  }

  try {
    const existing = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      logger.info("Signup failed: User already exists (%s)", email);
      return res.status(400).json({ msg: "User already exists" });
    }

    await pool.query(
      "INSERT INTO users (email, password, name) VALUES ($1, $2, $3)",
      [email, password, finalName]
    );
    logger.info("User registered successfully: %s", email);

    const userData = { email, name: finalName };
    await redisClient.setEx(`user:${email}`, 24 * 60 * 60, JSON.stringify(userData));

    const token = generateToken(userData);
    res.status(201).json({ msg: "User registered successfully", user: userData, token });
  } catch (err) {
    logger.error(
      "Signup error for %s | Query: INSERT INTO users ... | Params: %o | Error: %s",
      email,
      [email, "***", finalName],
      err.stack || err.message
    );
    next(err);
  }
});

app.post("/auth/login", async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    logger.warn("Login attempt with missing fields: %o", { ...req.body, password: "***" });
    return res.status(400).json({ msg: "Missing email or password" });
  }

  try {
    let user;
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
        logger.warn("Login failed: Invalid credentials for %s", email);
        return res.status(401).json({ msg: "Invalid credentials" });
      }
      user = result.rows[0];
      await redisClient.setEx(`user:${email}`, 24 * 60 * 60, JSON.stringify(user));
    }

    const token = generateToken(user);
    res.status(200).json({ msg: "Login successful", user, token });
  } catch (err) {
    logger.error(
      "Login error for %s | Query: SELECT * FROM users ... | Params: %o | Error: %s",
      email,
      [email, "***"],
      err.stack || err.message
    );
    next(err);
  }
});

// -------------------- Default Route --------------------
app.get("/", (req, res) => {
  logger.info("Health check ping");
  res.send("Backend running successfully 🚀");
});

// -------------------- Global Error Handler --------------------
app.use((err, req, res, next) => {
  logger.error("Unhandled error: %s", err.stack || err.message);
  res.status(500).json({ msg: "Server error" });
});

// -------------------- Start Server --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`🚀 Server running on http://localhost:${PORT}`);
});
