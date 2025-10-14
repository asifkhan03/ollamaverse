import express from 'express';
import bcrypt from 'bcrypt';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { authenticateTokenFast, recordTokenUsage } from '../database.js';
import logger from '../logger.js';

const router = express.Router();

// Rate limiting for public API (more restrictive than internal API)
const publicApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: (req) => {
    // Use token-specific rate limit if available
    return req.tokenRateLimit || 30; // Default 30 requests per minute
  },
  keyGenerator: (req) => {
    // Rate limit per token
    return req.tokenId || req.ip;
  },
  message: {
    error: 'Too many requests',
    retryAfter: '60 seconds',
    docs: 'https://docs.ollamaverse.ai/rate-limits'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Token authentication middleware
const authenticateApiToken = async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    logger.info('🔐 API Token Authentication Attempt', {
      requestId: req.id,
      method: req.method,
      endpoint: req.originalUrl,
      hasToken: !!token,
      tokenFormat: token ? (token.startsWith('olla_') ? 'valid' : 'invalid') : 'none',
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (!token) {
      logger.warn('🚫 Authentication failed - no token', {
        requestId: req.id,
        endpoint: req.originalUrl,
        ip: req.ip,
        reason: 'API token required'
      });
      return res.status(401).json({
        error: 'API token required',
        message: 'Include your token in the Authorization header as Bearer <token>',
        docs: 'https://docs.ollamaverse.ai/authentication'
      });
    }

    // Check if token has correct format
    if (!token.startsWith('olla_')) {
      logger.warn('🚫 Authentication failed - invalid format', {
        requestId: req.id,
        endpoint: req.originalUrl,
        tokenPrefix: token.substring(0, 8),
        ip: req.ip,
        reason: 'Token must start with "olla_"'
      });
      return res.status(401).json({
        error: 'Invalid token format',
        message: 'Token must start with "olla_"'
      });
    }

    // Authenticate the token by comparing with stored hashes
    logger.info('🔍 Starting token authentication', {
      requestId: req.id,
      endpoint: req.originalUrl,
      tokenPrefix: `${token.substring(0, 12)}...`,
      ip: req.ip
    });

    const tokenRecord = await authenticateTokenFast(token);

    if (!tokenRecord) {
      logger.warn('🔒 Invalid API token attempt', {
        requestId: req.id,
        tokenPrefix: `${token.substring(0, 12)}...`,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl
      });

      return res.status(401).json({
        error: 'Invalid token',
        message: 'Token not found or has been revoked'
      });
    }

    logger.info('✅ Token authentication successful', {
      requestId: req.id,
      tokenId: tokenRecord.id,
      userEmail: tokenRecord.user_email,
      scopes: tokenRecord.scopes
    });

    // Check if token is active (already checked in authenticateToken, but kept for clarity)
    if (!tokenRecord.is_active) {
      return res.status(401).json({
        error: 'Token deactivated',
        message: 'This token has been deactivated'
      });
    }

    // Check if token has expired (already checked in authenticateToken, but kept for clarity)
    if (tokenRecord.expires_at && new Date() > new Date(tokenRecord.expires_at)) {
      return res.status(401).json({
        error: 'Token expired',
        message: 'This token has expired',
        expiredAt: tokenRecord.expires_at
      });
    }

    // Check scopes
    const requiredScope = req.originalUrl.includes('/models') ? 'models' : 'chat';
    if (!tokenRecord.scopes.includes(requiredScope)) {
      return res.status(403).json({
        error: 'Insufficient scope',
        message: `This token does not have '${requiredScope}' scope`,
        availableScopes: tokenRecord.scopes
      });
    }

    // Attach token info to request
    req.tokenId = tokenRecord.id;
    req.tokenUserId = tokenRecord.user_id;
    req.tokenUserEmail = tokenRecord.user_email;
    req.tokenRateLimit = tokenRecord.rate_limit_per_minute;
    req.tokenScopes = tokenRecord.scopes;

    next();
  } catch (error) {
    logger.error('❌ Token authentication failed', {
      error: error.message,
      ip: req.ip
    });

    res.status(500).json({
      error: 'Authentication error',
      requestId: req.id
    });
  }
};

// Apply rate limiting and authentication to all routes
router.use(publicApiLimiter);
router.use(authenticateApiToken);

// Get available models
router.get('/models', async (req, res) => {
  const startTime = Date.now();

  try {
    logger.info('📋 Public API models request', {
      tokenId: req.tokenId,
      userEmail: req.tokenUserEmail,
      ip: req.ip
    });

    // Forward request to Python backend
    const response = await axios.get(`${process.env.PYTHON_BACKEND_URL}/models`, {
      timeout: 10000
    });

    const models = response.data.models || [];

    await recordTokenUsage({
      tokenId: req.tokenId,
      endpoint: '/v1/models',
      method: 'GET',
      statusCode: 200,
      responseTime: Date.now() - startTime,
      promptTokens: 0,
      responseTokens: 0,
      metadata: { modelCount: models.length }
    });

    res.json({
      object: 'list',
      data: models.map(model => ({
        id: model,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'ollamaverse',
        permission: [],
        root: model,
        parent: null
      }))
    });

  } catch (error) {
    logger.error('❌ Public API models request failed', {
      error: error.message,
      tokenId: req.tokenId,
      responseTime: `${Date.now() - startTime}ms`
    });

    await recordTokenUsage({
      tokenId: req.tokenId,
      endpoint: '/v1/models',
      method: 'GET',
      statusCode: 500,
      responseTime: Date.now() - startTime,
      promptTokens: 0,
      responseTokens: 0,
      errorMessage: error.message
    });

    res.status(500).json({
      error: 'Failed to retrieve models',
      requestId: req.id
    });
  }
});

// Chat completion endpoint (OpenAI compatible)
router.post('/chat/completions', async (req, res) => {
  const startTime = Date.now();

  try {
    const { messages, model, temperature = 0.7, max_tokens = 1000, stream = false } = req.body;

    // Validate required parameters
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: 'invalid_request_error',
        message: 'messages is required and must be a non-empty array',
        type: 'invalid_request_error'
      });
    }

    if (!model) {
      return res.status(400).json({
        error: 'invalid_request_error',
        message: 'model is required',
        type: 'invalid_request_error'
      });
    }

    // Get the user's message (last message should be from user)
    const userMessage = messages[messages.length - 1];
    if (!userMessage || userMessage.role !== 'user') {
      return res.status(400).json({
        error: 'invalid_request_error',
        message: 'Last message must be from user role',
        type: 'invalid_request_error'
      });
    }

    logger.info('💬 Public API chat request', {
      tokenId: req.tokenId,
      userEmail: req.tokenUserEmail,
      model,
      messageCount: messages.length,
      ip: req.ip
    });

    // Estimate prompt tokens (rough calculation)
    const promptText = messages.map(msg => msg.content).join(' ');
    const promptTokens = Math.ceil(promptText.length / 4); // Rough estimation

    // Forward to Python backend
    const pythonResponse = await axios.post(`${process.env.PYTHON_BACKEND_URL}/ask`, {
      prompt: userMessage.content,
      model: model,
      token: null // Token not needed for Python backend as we've already authenticated
    }, {
      timeout: 60000 // 60 second timeout for chat responses
    });

    if (!pythonResponse.data || !pythonResponse.data.response) {
      throw new Error('Invalid response from Python backend');
    }

    const aiResponse = pythonResponse.data.response;
    const responseTokens = Math.ceil(aiResponse.length / 4); // Rough estimation

    // Record usage
    await recordTokenUsage({
      tokenId: req.tokenId,
      endpoint: '/v1/chat/completions',
      method: 'POST',
      statusCode: 200,
      responseTime: Date.now() - startTime,
      promptTokens,
      responseTokens,
      metadata: { 
        model, 
        messageCount: messages.length,
        temperature 
      }
    });

    // Return OpenAI-compatible response
    const response = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: aiResponse
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: responseTokens,
        total_tokens: promptTokens + responseTokens
      }
    };

    res.json(response);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    logger.error('❌ Public API chat request failed', {
      error: error.message,
      tokenId: req.tokenId,
      model: req.body?.model,
      responseTime: `${responseTime}ms`
    });

    // Record failed usage
    await recordTokenUsage({
      tokenId: req.tokenId,
      endpoint: '/v1/chat/completions',
      method: 'POST',
      statusCode: 500,
      responseTime,
      promptTokens: 0,
      responseTokens: 0,
      errorMessage: error.message
    });

    // Handle specific error types
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({
        error: 'service_unavailable',
        message: 'AI service is temporarily unavailable',
        type: 'service_error',
        requestId: req.id
      });
    }

    res.status(500).json({
      error: 'internal_error',
      message: 'An internal error occurred',
      type: 'internal_error',
      requestId: req.id
    });
  }
});

// Health check endpoint (doesn't require authentication)
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Ollamaverse Public API',
    version: '1.0.0'
  });
});

export default router;