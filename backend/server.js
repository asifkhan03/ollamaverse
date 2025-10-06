import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";
import authRoutes from "./routes/auth.js";
import pool from "./db.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Initialize DB connection test
pool.connect()
  .then(() => console.log("✅ Connected to NeonDB"))
  .catch(err => console.error("❌ DB connection failed:", err.message));

// Routes
app.use("/auth", authRoutes);

// Default route
app.get("/", (req, res) => {
  res.send("Backend running successfully 🚀");
});

// Start server
app.listen(process.env.PORT, () => {
  console.log(`Server running on http://localhost:${process.env.PORT}`);
});
