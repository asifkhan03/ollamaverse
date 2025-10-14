import pkg from 'pg';
const { Pool } = pkg;
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000, // Increased to 15 seconds
  acquireTimeoutMillis: 10000,     // Time to wait for a connection from pool
  createTimeoutMillis: 10000,     // Time to wait for connection creation
  destroyTimeoutMillis: 5000,     // Time to wait for connection destruction
  reapIntervalMillis: 1000,       // Frequency to check for idle connections
  createRetryIntervalMillis: 2000  // Time between connection retry attempts
});

// Test connection
pool.on('connect', () => {
  logger.debug('🔗 Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  logger.error('❌ PostgreSQL connection error:', err);
});

// Database initialization
export const initializeDatabase = async () => {
  const client = await pool.connect();
  
  try {
    logger.info('🚀 Initializing database schema...');
    
    // Create api_tokens table
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_email VARCHAR(255) NOT NULL,
        user_id VARCHAR(255),
        token_name VARCHAR(100) NOT NULL,
        token_hash VARCHAR(255) UNIQUE NOT NULL,
        token_prefix VARCHAR(20) NOT NULL,
        scopes TEXT[] DEFAULT '{"chat", "models"}',
        rate_limit_per_minute INTEGER DEFAULT 60,
        total_requests INTEGER DEFAULT 0,
        last_used_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      )
    `);

    // Create api_usage table for analytics
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token_id UUID REFERENCES api_tokens(id) ON DELETE CASCADE,
        endpoint VARCHAR(255) NOT NULL,
        method VARCHAR(10) NOT NULL,
        model_used VARCHAR(100),
        prompt_length INTEGER,
        response_length INTEGER,
        response_time_ms INTEGER,
        status_code INTEGER,
        ip_address INET,
        user_agent TEXT,
        metadata JSONB,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add metadata column if it doesn't exist (for existing databases)
    await client.query(`
      ALTER TABLE api_usage 
      ADD COLUMN IF NOT EXISTS metadata JSONB
    `);

    // Create indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_api_tokens_user_email ON api_tokens(user_email);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_api_usage_token_id ON api_usage(token_id);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at);
    `);

    logger.info('✅ Database schema initialized successfully');
    
  } catch (error) {
    logger.error('❌ Database initialization failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Token management functions
export const createToken = async (tokenData) => {
  const client = await pool.connect();
  try {
    const {
      userEmail,
      userId,
      tokenName,
      tokenHash,
      tokenPrefix,
      scopes = ['chat', 'models'],
      rateLimitPerMinute = 60,
      expiresAt
    } = tokenData;

    const result = await client.query(`
      INSERT INTO api_tokens (
        user_email, user_id, token_name, token_hash, token_prefix, 
        scopes, rate_limit_per_minute, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [userEmail, userId, tokenName, tokenHash, tokenPrefix, scopes, rateLimitPerMinute, expiresAt]);

    return result.rows[0];
  } finally {
    client.release();
  }
};

export const getTokenByHash = async (tokenHash) => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT * FROM api_tokens 
      WHERE token_hash = $1 AND is_active = true 
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `, [tokenHash]);

    return result.rows[0] || null;
  } finally {
    client.release();
  }
};

// Optimized function to authenticate a token
export const authenticateTokenFast = async (tokenValue) => {
  let client;
  try {
    logger.info('⚡ Fast token authentication attempt', {
      service: 'tokenapi',
      tokenPrefix: `${tokenValue.substring(0, 12)}...`
    });

    // Get connection from pool
    client = await pool.connect();
    
    // Simple query to get the specific token if it exists
    // We'll use a more targeted approach instead of fetching all tokens
    const result = await client.query(`
      SELECT id, user_email, user_id, token_name, token_hash, token_prefix, 
             scopes, rate_limit_per_minute, total_requests, last_used_at, 
             expires_at, is_active, created_at
      FROM api_tokens 
      WHERE is_active = true 
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      AND token_prefix = $1
    `, [`${tokenValue.substring(0, 12)}...`]);

    logger.info('📊 Fast query result', {
      service: 'tokenapi',
      candidateTokens: result.rows.length
    });

    // Check each candidate token
    for (const tokenRecord of result.rows) {
      try {
        const isMatch = await bcrypt.compare(tokenValue, tokenRecord.token_hash);
        
        if (isMatch) {
          logger.info('✅ Fast token authentication successful', {
            service: 'tokenapi',
            tokenId: tokenRecord.id,
            tokenName: tokenRecord.token_name
          });
          return tokenRecord;
        }
      } catch (compareError) {
        logger.error('❌ Bcrypt compare error', {
          service: 'tokenapi',
          error: compareError.message
        });
      }
    }

    return null;
  } catch (error) {
    logger.error('❌ Fast token authentication error', {
      service: 'tokenapi',
      error: error.message
    });
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

export const getUserTokens = async (userEmail) => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, token_name, token_prefix, scopes, rate_limit_per_minute, 
             total_requests, last_used_at, expires_at, created_at, is_active
      FROM api_tokens 
      WHERE user_email = $1 
      ORDER BY created_at DESC
    `, [userEmail]);

    return result.rows;
  } finally {
    client.release();
  }
};

export const updateTokenUsage = async (tokenId) => {
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE api_tokens 
      SET total_requests = total_requests + 1, 
          last_used_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [tokenId]);
  } finally {
    client.release();
  }
};

export const deactivateToken = async (tokenId, userEmail) => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE api_tokens 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_email = $2
      RETURNING *
    `, [tokenId, userEmail]);

    return result.rows[0] || null;
  } finally {
    client.release();
  }
};

export const logApiUsage = async (usageData) => {
  const client = await pool.connect();
  try {
    const {
      tokenId,
      endpoint,
      method,
      modelUsed,
      promptLength,
      responseLength,
      responseTimeMs,
      statusCode,
      ipAddress,
      userAgent,
      errorMessage
    } = usageData;

    await client.query(`
      INSERT INTO api_usage (
        token_id, endpoint, method, model_used, prompt_length, 
        response_length, response_time_ms, status_code, ip_address, 
        user_agent, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      tokenId, endpoint, method, modelUsed, promptLength,
      responseLength, responseTimeMs, statusCode, ipAddress,
      userAgent, errorMessage
    ]);
  } catch (error) {
    logger.error('Failed to log API usage:', error);
    // Don't throw error - logging failure shouldn't break API
  } finally {
    client.release();
  }
};

// Enhanced usage recording function for the public API
export const recordTokenUsage = async (usageData) => {
  const client = await pool.connect();
  try {
    const {
      tokenId,
      endpoint,
      method,
      statusCode,
      responseTime,
      promptTokens = 0,
      responseTokens = 0,
      metadata = {},
      errorMessage = null
    } = usageData;

    // Insert usage record
    await client.query(`
      INSERT INTO api_usage (
        token_id, endpoint, method, status_code, response_time_ms,
        prompt_length, response_length, metadata, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      tokenId, endpoint, method, statusCode, responseTime,
      promptTokens, responseTokens, JSON.stringify(metadata), errorMessage
    ]);

    // Update token's total request count and last used timestamp
    await client.query(`
      UPDATE api_tokens 
      SET total_requests = total_requests + 1, 
          last_used_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [tokenId]);

  } catch (error) {
    logger.error('Failed to record token usage:', {
      error: error.message,
      tokenId: usageData.tokenId,
      endpoint: usageData.endpoint
    });
    // Don't throw error - logging failure shouldn't break API
  } finally {
    client.release();
  }
};

export const getTokenUsageStats = async (tokenId, days = 30) => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        COUNT(*) as total_requests,
        COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as successful_requests,
        COUNT(CASE WHEN status_code >= 400 THEN 1 END) as failed_requests,
        AVG(response_time_ms) as avg_response_time,
        SUM(prompt_length) as total_prompt_tokens,
        SUM(response_length) as total_response_tokens,
        DATE(created_at) as date,
        COUNT(*) as daily_requests
      FROM api_usage 
      WHERE token_id = $1 
        AND created_at >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [tokenId]);

    return result.rows;
  } finally {
    client.release();
  }
};

export default pool;