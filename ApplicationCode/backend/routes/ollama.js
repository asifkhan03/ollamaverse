import express from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import logger from "../logger.js";

const router = express.Router();

router.post("/ask", async (req, res) => {
  const { token, prompt, model } = req.body;

  if (!token || !prompt) {
    logger.warn("Ollama request validation failed", { hasToken: !!token, hasPrompt: !!prompt });
    return res.status(400).json({ error: "Token and prompt are required" });
  }

  try {
    logger.info("Ollama request received", { 
      promptLength: prompt.length, 
      model: model || 'default' 
    });
    
    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "supersecret");
    logger.debug("Token verified for ollama request", { userId: decoded.id, model });

    // Call Python service with model parameter
    const pythonUrl = process.env.PYTHON_SERVICE || "http://localhost:8000";
    logger.debug("Calling Python service", { url: pythonUrl, model });
    
    const response = await axios.post(`${pythonUrl}/ask`, { 
      prompt, 
      model: model || 'smollm2'  // Default to smollm2 if no model specified
    }, {
      timeout: 30000 // 30 second timeout
    });

    logger.info("✅ Ollama request successful", { 
      userId: decoded.id, 
      responseLength: JSON.stringify(response.data).length 
    });
    
    res.json(response.data);
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      logger.warn("Invalid token in ollama request", { error: err.message });
      res.status(401).json({ error: "Invalid token" });
    } else if (err.code === 'ECONNREFUSED') {
      logger.error("❌ Python service unavailable", { error: err.message });
      res.status(503).json({ error: "Ollama service unavailable" });
    } else {
      logger.error("❌ Ollama request error", { error: err.message });
      res.status(500).json({ error: "Ollama service error" });
    }
  }
});

export default router;
