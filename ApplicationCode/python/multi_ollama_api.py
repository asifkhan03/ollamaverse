from flask import Flask, request, jsonify
from flask_cors import CORS
import jwt
import requests
import logging
import time
import json
import os

app = Flask(__name__)
# CORS configuration - Allow all origins
CORS(app, 
     origins='*',
     allow_headers=['Content-Type', 'Authorization', 'X-Requested-With'],
     methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
     expose_headers=['Content-Length', 'Content-Type'],
     supports_credentials=False)

# ---------------- Configuration ----------------
SECRET_KEY = os.getenv("JWT_SECRET", "supersecret")
OLLAMA_BASE_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")

# Configuration for multiple Ollama instances
OLLAMA_SERVICES = {
    "smollm2": os.getenv("OLLAMA_SMOLLM2_URL", "http://ollama-smollm2:11434"),
    "tinyllama": os.getenv("OLLAMA_TINYLLAMA_URL", "http://ollama-tinyllama:11434")
}

# List of available models (mapped to actual Ollama model names)
AVAILABLE_MODELS = {
    "smollm2": "smollm2:135m-instruct-q8_0",
    "tinyllama": "tinyllama:latest"
}

def get_ollama_url(model_key):
    """Get the appropriate Ollama service URL for a model"""
    return OLLAMA_SERVICES.get(model_key, OLLAMA_BASE_URL)

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
def check_ollama_connection(ollama_url=None):
    """Check if Ollama is running and accessible"""
    if ollama_url is None:
        ollama_url = OLLAMA_BASE_URL
    try:
        response = requests.get(f"{ollama_url}/api/tags", timeout=5)
        return response.status_code == 200
    except requests.RequestException:
        return False

def get_available_ollama_models(ollama_url=None):
    """Get list of models available in local Ollama"""
    if ollama_url is None:
        ollama_url = OLLAMA_BASE_URL
    try:
        response = requests.get(f"{ollama_url}/api/tags", timeout=10)
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
    # Check all Ollama services
    services_status = {}
    for model_key, ollama_url in OLLAMA_SERVICES.items():
        is_connected = check_ollama_connection(ollama_url)
        available_models = get_available_ollama_models(ollama_url) if is_connected else []
        services_status[model_key] = {
            "url": ollama_url,
            "connected": is_connected,
            "models": available_models
        }
    
    # Overall status is healthy if at least one service is available
    overall_healthy = any(s["connected"] for s in services_status.values())
    
    return jsonify({
        "status": "healthy" if overall_healthy else "degraded",
        "services": services_status,
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

    # Get actual model name for Ollama
    ollama_model = AVAILABLE_MODELS[model_key]
    
    # Get the appropriate Ollama service URL for this model
    ollama_url = get_ollama_url(model_key)
    
    # Check Ollama connection for this specific service
    if not check_ollama_connection(ollama_url):
        logger.error(f"❌ Cannot connect to Ollama service for model '{model_key}' at {ollama_url}")
        return jsonify({
            "error": f"Ollama service for '{model_key}' is not available", 
            "ollama_url": ollama_url
        }), 503
    
    # Prepare API request to Ollama
    api_endpoint = f"{ollama_url}/api/generate"
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
            "ollama_url": ollama_url
        }), 500
    
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")
        return jsonify({"error": "Internal server error"}), 500

# ---------------- Startup Check ----------------
def startup_check():
    """Check Ollama connection on startup"""
    logger.info("🔍 Checking Ollama services...")
    
    # Check all configured Ollama services
    for model_key, ollama_url in OLLAMA_SERVICES.items():
        logger.info(f"🔍 Checking {model_key} at {ollama_url}")
        if check_ollama_connection(ollama_url):
            available = get_available_ollama_models(ollama_url)
            logger.info(f"✅ {model_key} connected! Available models: {available}")
            
            # Check if our required model is available
            ollama_model = AVAILABLE_MODELS[model_key]
            if ollama_model in available:
                logger.info(f"✅ Model '{model_key}' ({ollama_model}) is available")
            else:
                logger.warning(f"⚠️ Model '{model_key}' ({ollama_model}) not found in Ollama")
        else:
            logger.warning(f"⚠️ {model_key} not reachable at {ollama_url}")

# ---------------- Run App ----------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))  # Changed default port to 8000
    logger.info(f"🚀 Starting Ollamaverse Python Backend on 0.0.0.0:{port}")
    logger.info(f"🔗 Ollama Services: {OLLAMA_SERVICES}")
    logger.info(f"📋 Configured models: {list(AVAILABLE_MODELS.keys())}")
    
    # Run startup check
    startup_check()
    
    app.run(host="0.0.0.0", port=port, debug=False)
