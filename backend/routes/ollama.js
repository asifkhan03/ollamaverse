import express from "express";
import axios from "axios";
import jwt from "jsonwebtoken";

const router = express.Router();

router.post("/ask", async (req, res) => {
  const { token, prompt } = req.body;

  if (!token || !prompt) {
    return res.status(400).json({ error: "Token and prompt are required" });
  }

  try {
    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "supersecret");

    // Call Python service
    const response = await axios.post(`${process.env.PYTHON_SERVICE}/ask`, { prompt });

    res.json(response.data);
  } catch (err) {
    console.error("Ask route error:", err.message);
    res.status(401).json({ error: "Invalid token or Ollama service error" });
  }
});

export default router;
