import pkg from "pg";
import dotenv from "dotenv";
import logger from "./logger.js";

dotenv.config();

const { Pool } = pkg;

// ---------- PostgreSQL Connection ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },   // ✅ Required for Neon
  max: 5,                               // Limit concurrent connections
  keepAlive: true,                      // ✅ Keeps idle connections alive
  connectionTimeoutMillis: 10000,       // Wait max 10s to connect
  idleTimeoutMillis: 0,                 // Don't auto-close idle clients
});

// Handle unexpected disconnects gracefully
pool.on("error", (err) => {
  logger.error(`❌ Unexpected Postgres error: ${err.message}`);
});

export default pool;
