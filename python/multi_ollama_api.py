from flask import Flask, request, jsonify
from flask_cors import CORS
import jwt
import requests
import logging
import time
import json
import os

app = Flask(__name__)
CORS(app)

# ---------------- Configuration ----------------
SECRET_KEY = os.getenv("JWT_SECRET", "supersecret")
OLLAMA_BASE_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")

# List of available models (mapped to actual Ollama model names)
AVAILABLE_MODELS = {
    "smollm2": "smollm2:135m-instruct-q8_0",
    "tinyllama": "tinyllama:latest"
}

# ---------------- Logging ----------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("ollamaverse-py-backend")
logger.info("🚀 Ollamaverse Python Backend starting...")

# ---------------- Token validation helper ----------------
def validate_token(token):
    try:
        jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return True
    except Exception as e:
        logger.warning(f"Token validation failed: {e}")
        return False

# ---------------- Helper Functions ----------------
def check_ollama_connection():
    """Check if Ollama is running and accessible"""
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5)
        return response.status_code == 200
    except requests.RequestException:
        return False

def get_available_ollama_models():
    """Get list of models available in local Ollama"""
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=10)
        if response.status_code == 200:
            models_data = response.json()
            return [model['name'] for model in models_data.get('models', [])]
        return []
    except requests.RequestException as e:
        logger.error(f"Failed to get Ollama models: {e}")
        return []

# ---------------- Routes ----------------
@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    ollama_status = check_ollama_connection()
    available_models = get_available_ollama_models() if ollama_status else []
    
    return jsonify({
        "status": "healthy",
        "ollama_connected": ollama_status,
        "ollama_url": OLLAMA_BASE_URL,
        "available_models": available_models,
        "configured_models": list(AVAILABLE_MODELS.keys())
    })

@app.route("/models", methods=["GET"])
def list_models():
    """List configured models"""
    logger.info("Listing configured models")
    return jsonify({
        "models": list(AVAILABLE_MODELS.keys()),
        "model_mapping": AVAILABLE_MODELS
    })

@app.route("/ask", methods=["POST"])
def chat_with_model():
    """Chat with Ollama models - matches the endpoint expected by your Node.js backend"""
    start_time = time.time()
    data = request.get_json()
    
    # Extract data from request
    token = data.get("token")
    prompt = data.get("prompt")
    model_key = data.get("model", "smollm2")  # Default to smollm2
    
    logger.info(f"🤖 Chat request - Model: {model_key}, Prompt length: {len(prompt) if prompt else 0}")

    # Validate inputs
    if not prompt:
        logger.warning("❌ Missing prompt in request")
        return jsonify({"error": "Missing prompt"}), 400

    if model_key not in AVAILABLE_MODELS:
        logger.warning(f"❌ Model '{model_key}' not configured")
        return jsonify({
            "error": f"Model '{model_key}' not available", 
            "available_models": list(AVAILABLE_MODELS.keys())
        }), 400

    # Check Ollama connection
    if not check_ollama_connection():
        logger.error("❌ Cannot connect to Ollama service")
        return jsonify({
            "error": "Ollama service is not available", 
            "ollama_url": OLLAMA_BASE_URL
        }), 503

    # Get actual model name for Ollama
    ollama_model = AVAILABLE_MODELS[model_key]
    
    # Prepare API request to Ollama
    api_endpoint = f"{OLLAMA_BASE_URL}/api/generate"
    payload = {
        "model": ollama_model,
        "prompt": prompt,
        "stream": False  # Get complete response at once for simplicity
    }

    try:
        logger.info(f"🔄 Sending request to Ollama: {api_endpoint}")
        response = requests.post(api_endpoint, json=payload, timeout=120)
        response.raise_for_status()

        result = response.json()
        generated_text = result.get("response", "").strip()
        
        if not generated_text:
            logger.warning("⚠️ Empty response from Ollama")
            return jsonify({"error": "Empty response from model"}), 500

        elapsed = round(time.time() - start_time, 2)
        logger.info(f"✅ Response generated in {elapsed}s - Length: {len(generated_text)} chars")
        
        return jsonify({
            "response": generated_text,
            "model": model_key,
            "ollama_model": ollama_model,
            "processing_time": elapsed
        })

    except requests.exceptions.Timeout:
        logger.error("⏰ Request timeout to Ollama")
        return jsonify({"error": "Request timeout - model took too long to respond"}), 504
    
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Error communicating with Ollama: {e}")
        return jsonify({
            "error": f"Failed to communicate with Ollama: {str(e)}",
            "ollama_url": OLLAMA_BASE_URL
        }), 500
    
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")
        return jsonify({"error": "Internal server error"}), 500

# ---------------- Startup Check ----------------
def startup_check():
    """Check Ollama connection on startup"""
    logger.info("🔍 Checking Ollama connection...")
    if check_ollama_connection():
        available = get_available_ollama_models()
        logger.info(f"✅ Ollama connected! Available models: {available}")
        
        # Check if our required models are available
        for model_key, ollama_model in AVAILABLE_MODELS.items():
            if ollama_model in available:
                logger.info(f"✅ Model '{model_key}' ({ollama_model}) is available")
            else:
                logger.warning(f"⚠️ Model '{model_key}' ({ollama_model}) not found in Ollama")
    else:
        logger.warning(f"⚠️ Ollama not reachable at {OLLAMA_BASE_URL}")

# ---------------- Run App ----------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))  # Changed default port to 8000
    logger.info(f"🚀 Starting Ollamaverse Python Backend on 0.0.0.0:{port}")
    logger.info(f"🔗 Ollama URL: {OLLAMA_BASE_URL}")
    logger.info(f"📋 Configured models: {list(AVAILABLE_MODELS.keys())}")
    
    # Run startup check
    startup_check()
    
    app.run(host="0.0.0.0", port=port, debug=False)
