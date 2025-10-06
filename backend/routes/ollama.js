import express from "express";
import axios from "axios";
import jwt from "jsonwebtoken";

const router = express.Router();

router.post("/ask", async (req, res) => {
  const { token, prompt } = req.body;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const response = await axios.post(`${process.env.PYTHON_SERVICE}/ask`, { prompt });
    res.json(response.data);
  } catch (err) {
    res.status(401).json({ error: "Invalid token or Ollama error" });
  }
});

export default router;
