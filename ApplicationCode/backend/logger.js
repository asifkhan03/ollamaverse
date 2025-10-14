import { createLogger, format, transports } from "winston";

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
  defaultMeta: { service: "ollamaverse-backend" },
  transports: [
    new transports.Console({
      format: consoleFormat
    }),
    new transports.File({ 
      filename: "logs/error.log", 
      level: "error",
      format: fileFormat
    }),
    new transports.File({ 
      filename: "logs/combined.log",
      format: fileFormat
    })
  ]
});

export default logger;
