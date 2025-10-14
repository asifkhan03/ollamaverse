import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getDB } from "../db.js";
import RedisHelper from "../redisHelper.js";
import logger from "../logger.js";

const router = express.Router();
const usersCollection = () => getDB().collection("users");

const generateToken = (user) =>
  jwt.sign(
    { id: user._id, username: user.username, email: user.email },
    process.env.JWT_SECRET || "supersecret",
    { expiresIn: "1d" }
  );

// -------------------- Signup --------------------
router.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !email || !password) {
    logger.warn("Signup validation failed", { email, missingFields: true });
    return res.status(400).json({ error: "All fields required" });
  }

  try {
    logger.info("Signup attempt", { email, username });
    
    const existing = await usersCollection().findOne({ email });
    if (existing) {
      logger.warn("Signup failed - user exists", { email });
      return res.status(400).json({ error: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await usersCollection().insertOne({ username, email, password: hashed });

    const user = { _id: result.insertedId, username, email };
    
    // Cache user data (non-blocking)
    RedisHelper.set(`user:${email}`, user, 86400); // 24 hours

    const token = generateToken(user);
    
    logger.info("✅ User signup successful", { email, userId: user._id });
    res.status(201).json({ message: "User created successfully", user, token });
  } catch (err) {
    logger.error("❌ Signup error", { email, error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// -------------------- Login --------------------
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    logger.warn("Login validation failed", { email, missingFields: true });
    return res.status(400).json({ error: "Email and password required" });
  }

  try {
    logger.info("Login attempt", { email });
    
    // Try cache first, then DB
    let user = await RedisHelper.get(`user:${email}`);
    
    if (!user) {
      logger.debug("User not in cache, querying DB", { email });
      user = await usersCollection().findOne({ email });
      
      if (user) {
        // Cache for next time (non-blocking)
        RedisHelper.set(`user:${email}`, user, 86400);
      }
    } else {
      logger.debug("User found in cache", { email });
    }

    if (!user) {
      logger.warn("Login failed - user not found", { email });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      logger.warn("Login failed - wrong password", { email });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Update cache with fresh login data (non-blocking)
    const userData = { _id: user._id, username: user.username, email: user.email };
    RedisHelper.set(`user:${email}`, userData, 86400);

    const token = generateToken(user);
    
    logger.info("✅ Login successful", { email, userId: user._id });
    res.json({ 
      message: "Login successful", 
      user: { id: user._id, username: user.username, email: user.email }, 
      token 
    });
  } catch (err) {
    logger.error("❌ Login error", { email, error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
