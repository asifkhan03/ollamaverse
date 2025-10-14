import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
  createToken,
  getUserTokens,
  deactivateToken,
  getTokenUsageStats
} from '../database.js';
import logger from '../logger.js';

const router = express.Router();

// Middleware to verify JWT token from main backend
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    logger.info('🔐 JWT Authentication Attempt', {
      service: 'tokenapi',
      hasAuthHeader: !!authHeader,
      hasToken: !!token,
      requestId: req.id,
      ip: req.ip
    });

    if (!token) {
      logger.warn('❌ Missing JWT token', {
        service: 'tokenapi',
        requestId: req.id,
        ip: req.ip
      });
      return res.status(401).json({ error: 'Access token required' });
    }

    if (!process.env.JWT_SECRET) {
      logger.error('❌ JWT_SECRET not configured', {
        service: 'tokenapi',
        requestId: req.id
      });
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    logger.info('✅ JWT Authentication Success', {
      service: 'tokenapi',
      userEmail: decoded.email,
      userId: decoded.id,
      requestId: req.id
    });

    next();
  } catch (error) {
    logger.warn('❌ Invalid JWT token in token management', { 
      service: 'tokenapi',
      error: error.message,
      requestId: req.id,
      ip: req.ip
    });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Generate API token
router.post('/generate', authenticateUser, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { name, scopes = ['chat', 'models'], expiryDays = 365 } = req.body;
    const userEmail = req.user.email;
    const userId = req.user.id;

    logger.info('🔑 Token generation request', {
      requestId: req.id,
      userEmail,
      userId,
      tokenName: name,
      requestedScopes: scopes,
      expiryDays,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (!name || name.trim().length === 0) {
      logger.warn('❌ Token generation failed - missing name', {
        requestId: req.id,
        userEmail,
        reason: 'Token name is required'
      });
      return res.status(400).json({ error: 'Token name is required' });
    }

    if (name.length > 100) {
      logger.warn('❌ Token generation failed - name too long', {
        requestId: req.id,
        userEmail,
        tokenName: name,
        nameLength: name.length,
        reason: 'Token name too long (max 100 characters)'
      });
      return res.status(400).json({ error: 'Token name too long (max 100 characters)' });
    }

    // Check if user already has max tokens
    const existingTokens = await getUserTokens(userEmail);
    const maxTokens = parseInt(process.env.MAX_TOKENS_PER_USER) || 10;
    
    if (existingTokens.length >= maxTokens) {
      return res.status(400).json({ 
        error: `Maximum ${maxTokens} tokens allowed per user`,
        currentCount: existingTokens.length 
      });
    }

    // Generate secure token
    const tokenValue = `olla_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = await bcrypt.hash(tokenValue, 12);
    const tokenPrefix = `${tokenValue.substring(0, 12)}...`;

    // Calculate expiry date
    const expiresAt = expiryDays ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000) : null;

    // Save token to database
    const tokenRecord = await createToken({
      userEmail,
      userId,
      tokenName: name.trim(),
      tokenHash,
      tokenPrefix,
      scopes,
      rateLimitPerMinute: 60, // Default rate limit
      expiresAt
    });

    logger.tokenOperation('generated', {
      tokenName: name,
      userEmail,
      scopes,
      expiresAt
    });

    logger.apiResponse(req, res, Date.now() - startTime, {
      tokenId: tokenRecord.id,
      operation: 'generate'
    });

    res.status(201).json({
      message: 'API token generated successfully',
      token: {
        id: tokenRecord.id,
        name: tokenRecord.token_name,
        value: tokenValue, // Only returned once during creation
        prefix: tokenPrefix,
        scopes: tokenRecord.scopes,
        rateLimit: tokenRecord.rate_limit_per_minute,
        expiresAt: tokenRecord.expires_at,
        createdAt: tokenRecord.created_at
      },
      warning: 'Save this token securely. It will not be shown again.'
    });

  } catch (error) {
    logger.error('❌ Token generation failed', {
      error: error.message,
      userEmail: req.user?.email,
      responseTime: `${Date.now() - startTime}ms`
    });

    res.status(500).json({ 
      error: 'Failed to generate token',
      requestId: req.id 
    });
  }
});

// List user tokens
router.get('/list', authenticateUser, async (req, res) => {
  const startTime = Date.now();

  try {
    const userEmail = req.user.email;
    const tokens = await getUserTokens(userEmail);

    const tokensWithStats = await Promise.all(
      tokens.map(async (token) => {
        try {
          const stats = await getTokenUsageStats(token.id, 30);
          const totalRequests = stats.reduce((sum, day) => sum + parseInt(day.daily_requests), 0);
          
          return {
            id: token.id,
            name: token.token_name,
            prefix: token.token_prefix,
            scopes: token.scopes,
            rateLimit: token.rate_limit_per_minute,
            totalRequests: token.total_requests,
            lastUsed: token.last_used_at,
            expiresAt: token.expires_at,
            createdAt: token.created_at,
            isActive: token.is_active,
            usage30Days: totalRequests
          };
        } catch (statsError) {
          logger.warn('Failed to get token stats', { 
            tokenId: token.id, 
            error: statsError.message 
          });
          
          return {
            id: token.id,
            name: token.token_name,
            prefix: token.token_prefix,
            scopes: token.scopes,
            rateLimit: token.rate_limit_per_minute,
            totalRequests: token.total_requests,
            lastUsed: token.last_used_at,
            expiresAt: token.expires_at,
            createdAt: token.created_at,
            isActive: token.is_active,
            usage30Days: 0
          };
        }
      })
    );

    logger.info('📋 Token list retrieved', {
      userEmail,
      tokenCount: tokens.length,
      responseTime: `${Date.now() - startTime}ms`
    });

    res.json({
      tokens: tokensWithStats,
      total: tokens.length,
      maxAllowed: parseInt(process.env.MAX_TOKENS_PER_USER) || 10
    });

  } catch (error) {
    logger.error('❌ Token list retrieval failed', {
      error: error.message,
      userEmail: req.user?.email,
      responseTime: `${Date.now() - startTime}ms`
    });

    res.status(500).json({ 
      error: 'Failed to retrieve tokens',
      requestId: req.id 
    });
  }
});

// Revoke/deactivate token
router.delete('/:tokenId', authenticateUser, async (req, res) => {
  const startTime = Date.now();

  try {
    const { tokenId } = req.params;
    const userEmail = req.user.email;

    if (!tokenId) {
      return res.status(400).json({ error: 'Token ID is required' });
    }

    const deactivatedToken = await deactivateToken(tokenId, userEmail);

    if (!deactivatedToken) {
      return res.status(404).json({ 
        error: 'Token not found or already deactivated' 
      });
    }

    logger.tokenOperation('revoked', deactivatedToken, {
      tokenId,
      userEmail
    });

    res.json({
      message: 'Token revoked successfully',
      token: {
        id: deactivatedToken.id,
        name: deactivatedToken.token_name,
        revokedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('❌ Token revocation failed', {
      error: error.message,
      tokenId: req.params.tokenId,
      userEmail: req.user?.email,
      responseTime: `${Date.now() - startTime}ms`
    });

    res.status(500).json({ 
      error: 'Failed to revoke token',
      requestId: req.id 
    });
  }
});

// Get token usage statistics
router.get('/:tokenId/usage', authenticateUser, async (req, res) => {
  const startTime = Date.now();

  try {
    const { tokenId } = req.params;
    const { days = 30 } = req.query;
    const userEmail = req.user.email;

    // Verify token belongs to user
    const userTokens = await getUserTokens(userEmail);
    const tokenExists = userTokens.find(token => token.id === tokenId);

    if (!tokenExists) {
      return res.status(404).json({ error: 'Token not found' });
    }

    const usage = await getTokenUsageStats(tokenId, parseInt(days));

    const summary = {
      totalRequests: usage.reduce((sum, day) => sum + parseInt(day.total_requests), 0),
      successfulRequests: usage.reduce((sum, day) => sum + parseInt(day.successful_requests), 0),
      failedRequests: usage.reduce((sum, day) => sum + parseInt(day.failed_requests), 0),
      avgResponseTime: usage.length > 0 ? 
        usage.reduce((sum, day) => sum + parseFloat(day.avg_response_time || 0), 0) / usage.length : 0,
      totalTokens: usage.reduce((sum, day) => 
        sum + parseInt(day.total_prompt_tokens || 0) + parseInt(day.total_response_tokens || 0), 0
      )
    };

    res.json({
      tokenId,
      period: `${days} days`,
      summary,
      dailyUsage: usage,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ Token usage retrieval failed', {
      error: error.message,
      tokenId: req.params.tokenId,
      userEmail: req.user?.email,
      responseTime: `${Date.now() - startTime}ms`
    });

    res.status(500).json({ 
      error: 'Failed to retrieve token usage',
      requestId: req.id 
    });
  }
});

export default router;