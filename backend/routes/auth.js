import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getDB } from "../db.js";
import { redisClient } from "../server.js";

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
  if (!username || !email || !password) return res.status(400).json({ error: "All fields required" });

  try {
    const existing = await usersCollection().findOne({ email });
    if (existing) return res.status(400).json({ error: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const result = await usersCollection().insertOne({ username, email, password: hashed });

    const user = { _id: result.insertedId, username, email };
    await redisClient.setEx(`user:${email}`, 24 * 60 * 60, JSON.stringify(user));

    const token = generateToken(user);
    res.status(201).json({ message: "User created successfully", user, token });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// -------------------- Login --------------------
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  try {
    const user = await usersCollection().findOne({ email });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    await redisClient.setEx(
      `user:${email}`,
      24 * 60 * 60,
      JSON.stringify({ _id: user._id, username: user.username, email: user.email })
    );

    const token = generateToken(user);
    res.json({ message: "Login successful", user: { id: user._id, username: user.username, email: user.email }, token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
