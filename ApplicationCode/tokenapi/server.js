import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

// Import routes
import tokenRoutes from './routes/tokens.js';
import publicRoutes from './routes/public.js';

// Import utilities
import { initializeDatabase } from './database.js';
import pool from './database.js';
import logger from './logger.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.TOKEN_API_PORT || 9000;

// Request ID middleware
app.use((req, res, next) => {
  req.id = uuidv4();
  req.startTime = Date.now();
  next();
});

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration - Allow all origins
app.use(cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'Content-Type']
}));

// CORS logging middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    logger.info('🌐 CORS Request', {
      service: 'tokenapi',
      method: req.method,
      origin: origin,
      requestId: req.id,
      allowed: true  // All origins allowed with wildcard
    });
  }
  next();
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTP request logging
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Request logging middleware
app.use((req, res, next) => {
  // Log incoming request
  logger.info('🔵 Incoming Request', {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    authorization: req.get('Authorization') ? 'Bearer ***' : 'None',
    timestamp: new Date().toISOString()
  });
  
  // Log response when finished
  const originalSend = res.send;
  res.send = function(data) {
    const responseTime = Date.now() - req.startTime;
    
    // Log response
    logger.info('🟢 Response Sent', {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      contentLength: data?.length || 0,
      timestamp: new Date().toISOString()
    });
    
    // Log additional analytics for specific endpoints
    if (req.originalUrl.includes('/tokens/') || req.originalUrl.includes('/v1/')) {
      logger.info('📊 API Analytics', {
        requestId: req.id,
        endpoint: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        responseTime: responseTime,
        success: res.statusCode >= 200 && res.statusCode < 400,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
    }
    
    return originalSend.call(this, data);
  };
  
  next();
});

// Health check endpoint (before authentication)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Ollamaverse Token API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Debug endpoint to check database status
app.get('/debug/db', async (req, res) => {
  try {
    const client = await pool.connect();
    
    // Check if tables exist
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    // Count tokens
    const tokenCountResult = await client.query('SELECT COUNT(*) as count FROM api_tokens');
    const activeTokenCountResult = await client.query('SELECT COUNT(*) as count FROM api_tokens WHERE is_active = true');
    
    client.release();
    
    res.json({
      status: 'ok',
      database: 'connected',
      tables: tablesResult.rows.map(row => row.table_name),
      totalTokens: parseInt(tokenCountResult.rows[0].count),
      activeTokens: parseInt(activeTokenCountResult.rows[0].count)
    });
  } catch (error) {
    logger.error('Database debug error:', error);
    res.status(500).json({
      status: 'error',
      database: 'failed',
      error: error.message
    });
  }
});

// Development only: Create a test token
app.post('/debug/create-test-token', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const { createToken } = await import('./database.js');
    const crypto = await import('crypto');
    const bcrypt = await import('bcrypt');

    // Generate test token
    const tokenValue = `olla_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = await bcrypt.hash(tokenValue, 12);
    const tokenPrefix = `${tokenValue.substring(0, 12)}...`;

    const tokenRecord = await createToken({
      userEmail: 'test@example.com',
      userId: 'test-user-123',
      tokenName: 'Development Test Token',
      tokenHash,
      tokenPrefix,
      scopes: ['chat', 'models'],
      rateLimitPerMinute: 60,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
    });

    logger.info('🧪 Test token created', {
      service: 'tokenapi',
      tokenId: tokenRecord.id,
      tokenName: 'Development Test Token'
    });

    res.json({
      message: 'Test token created successfully',
      token: {
        id: tokenRecord.id,
        value: tokenValue,
        prefix: tokenPrefix,
        scopes: ['chat', 'models']
      },
      warning: 'This is for development only!'
    });

  } catch (error) {
    logger.error('Failed to create test token:', error);
    res.status(500).json({
      error: 'Failed to create test token',
      message: error.message
    });
  }
});

// Handle preflight requests for all routes
app.options('*', cors());

// API Documentation
app.get('/', (req, res) => {
  res.json({
    name: 'Ollamaverse Token API',
    version: '1.0.0',
    description: 'API token management and public endpoints for Ollamaverse AI',
    endpoints: {
      authentication: {
        'POST /tokens/generate': 'Generate a new API token',
        'GET /tokens/list': 'List user tokens',
        'DELETE /tokens/:id': 'Revoke a token',
        'GET /tokens/:id/usage': 'Get token usage statistics'
      },
      public: {
        'GET /v1/models': 'List available models (requires token)',
        'POST /v1/chat/completions': 'Chat completion (OpenAI compatible, requires token)',
        'GET /v1/health': 'Service health check'
      }
    },
    documentation: 'https://docs.ollamaverse.ai',
    support: 'support@ollamaverse.ai'
  });
});

// Mount routes
app.use('/tokens', tokenRoutes);
app.use('/v1', publicRoutes);

// 404 handler
app.use('*', (req, res) => {
  logger.warn('📍 404 - Route not found', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'POST /tokens/generate',
      'GET /tokens/list',
      'DELETE /tokens/:id',
      'GET /tokens/:id/usage',
      'GET /v1/models',
      'POST /v1/chat/completions',
      'GET /v1/health'
    ]
  });
});

// Global error handler
app.use((error, req, res, next) => {
  const responseTime = Date.now() - req.startTime;
  
  logger.error('💥 Unhandled error', {
    error: error.message,
    stack: error.stack,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.id,
    responseTime: `${responseTime}ms`
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(error.status || 500).json({
    error: 'Internal Server Error',
    message: isDevelopment ? error.message : 'An unexpected error occurred',
    requestId: req.id,
    ...(isDevelopment && { stack: error.stack })
  });
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`🔄 Received ${signal}. Starting graceful shutdown...`);
  
  const server = app.listen(PORT, () => {
    logger.info(`🚀 Token API Server running on port ${PORT}`);
    logger.info(`📖 API Documentation: http://localhost:${PORT}/`);
    logger.info(`🏥 Health Check: http://localhost:${PORT}/health`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  process.on(signal, () => {
    logger.info('⏰ Shutdown signal received, closing server...');
    
    server.close(() => {
      logger.info('✅ HTTP server closed');
      process.exit(0);
    });

    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('❌ Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  });
};

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database connection
    await initializeDatabase();
    logger.info('✅ Database initialized successfully');

    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Token API Server running on port ${PORT}`);
      logger.info(`📖 API Documentation: http://localhost:${PORT}/`);
      logger.info(`🏥 Health Check: http://localhost:${PORT}/health`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      
      // Log configuration
      logger.info('⚙️ Configuration', {
        port: PORT,
        nodeEnv: process.env.NODE_ENV || 'development',
        pythonBackend: process.env.PYTHON_BACKEND_URL,
        maxTokensPerUser: process.env.MAX_TOKENS_PER_USER || 10,
        jwtSecret: process.env.JWT_SECRET ? '***configured***' : '***missing***',
        pgDatabase: process.env.PG_DATABASE
      });
    });

    // Setup graceful shutdown
    ['SIGTERM', 'SIGINT'].forEach(signal => {
      process.on(signal, () => {
        logger.info(`⏰ ${signal} received, closing server...`);
        
        server.close(() => {
          logger.info('✅ HTTP server closed');
          process.exit(0);
        });

        // Force close after 30 seconds
        setTimeout(() => {
          logger.error('❌ Could not close connections in time, forcefully shutting down');
          process.exit(1);
        }, 30000);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('💥 Uncaught Exception', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('💥 Unhandled Rejection', {
        reason: reason?.message || reason,
        promise: promise.toString()
      });
      process.exit(1);
    });

  } catch (error) {
    logger.error('❌ Failed to start server', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Start the server
startServer();

export default app;