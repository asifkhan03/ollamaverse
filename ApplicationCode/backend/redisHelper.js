import { isRedisReady } from "./server.js";
import { redisClient } from "./server.js";
import logger from "./logger.js";

// Simple Redis helper with fallback
class RedisHelper {
  static async get(key) {
    try {
      if (!isRedisReady()) {
        logger.debug("Redis not ready, skipping GET", { key });
        return null;
      }
      const result = await redisClient.get(key);
      if (result) {
        logger.debug("✅ Cache HIT", { key });
        return JSON.parse(result);
      }
      logger.debug("🔍 Cache MISS", { key });
      return null;
    } catch (error) {
      logger.warn("❌ Redis GET failed", { key, error: error.message });
      return null;
    }
  }

  static async set(key, data, ttl = 3600) {
    try {
      if (!isRedisReady()) {
        logger.debug("Redis not ready, skipping SET", { key });
        return false;
      }
      await redisClient.setEx(key, ttl, JSON.stringify(data));
      logger.debug("💾 Cache SET", { key, ttl });
      return true;
    } catch (error) {
      logger.warn("❌ Redis SET failed", { key, error: error.message });
      return false;
    }
  }

  static async del(key) {
    try {
      if (!isRedisReady()) return false;
      await redisClient.del(key);
      logger.debug("🗑️ Cache DEL", { key });
      return true;
    } catch (error) {
      logger.warn("❌ Redis DEL failed", { key, error: error.message });
      return false;
    }
  }
}

export default RedisHelper;