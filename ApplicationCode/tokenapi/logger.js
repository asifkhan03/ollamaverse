import { createLogger, format, transports } from "winston";
import path from "path";

const isDev = process.env.NODE_ENV !== "production";

// Console format - readable for development
const consoleFormat = format.combine(
  format.timestamp({ format: "HH:mm:ss" }),
  format.colorize(),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// File format - JSON for production
const fileFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.splat(),
  format.json()
);

const logger = createLogger({
  level: isDev ? "debug" : "info",
  defaultMeta: { service: "tokenapi" },
  transports: [
    new transports.Console({
      format: consoleFormat
    }),
    new transports.File({ 
      filename: "logs/error.log", 
      level: "error",
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new transports.File({ 
      filename: "logs/combined.log",
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 10
    })
  ]
});

// API request logging helper
logger.apiRequest = (req, additionalMeta = {}) => {
  const { method, url, ip, headers } = req;
  logger.info(`🌐 ${method} ${url}`, {
    method,
    url,
    ip,
    userAgent: headers['user-agent'],
    requestId: req.id,
    ...additionalMeta
  });
};

// API response logging helper  
logger.apiResponse = (req, res, duration, additionalMeta = {}) => {
  const { method, url } = req;
  const { statusCode } = res;
  
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  const emoji = statusCode >= 500 ? '💥' : statusCode >= 400 ? '⚠️' : '✅';
  
  logger[level](`${emoji} ${method} ${url} - ${statusCode}`, {
    method,
    url,
    statusCode,
    duration: `${duration}ms`,
    requestId: req.id,
    ...additionalMeta
  });
};

// Token operation logging
logger.tokenOperation = (operation, tokenData, additionalMeta = {}) => {
  logger.info(`🔑 Token ${operation}`, {
    operation,
    tokenName: tokenData?.token_name || tokenData?.tokenName,
    userEmail: tokenData?.user_email || tokenData?.userEmail,
    tokenPrefix: tokenData?.token_prefix || tokenData?.tokenPrefix,
    ...additionalMeta
  });
};

export default logger;