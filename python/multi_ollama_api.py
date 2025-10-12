from flask import Flask, request, jsonify
from flask_cors import CORS
import jwt
import requests
import logging
import time
import json

app = Flask(__name__)
CORS(app)

# ---------------- Configuration ----------------
SECRET_KEY = "supersecret"

# List of available models
AVAILABLE_MODELS = [
    "tinyllama",
    "smollm2"
]

# Map model names to their Kubernetes service endpoints
MODEL_ENDPOINTS = {
    "tinyllama": "http://ollama-tinyllama.aiops.svc.cluster.local:11434",
    "smollm2": "http://ollama-smollm2.aiops.svc.cluster.local:11434"
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

# ---------------- Routes ----------------
@app.route("/models", methods=["GET"])
def list_models():
    logger.info("Listing available models")
    return jsonify({"models": AVAILABLE_MODELS})

@app.route("/ollama/chat", methods=["POST"])
def chat_with_model():
    start_time = time.time()
    data = request.get_json()
    token = data.get("token")
    model = data.get("model")
    prompt = data.get("prompt")

    logger.info(f"Incoming request for model '{model}' with prompt: {prompt}")

    # Optional auth
    # if not validate_token(token):
    #     logger.warning("Invalid token")
    #     return jsonify({"error": "Invalid token"}), 401

    if model not in AVAILABLE_MODELS:
        logger.error(f"Model '{model}' not available")
        return jsonify({"error": f"Model '{model}' not available"}), 400

    if not prompt:
        logger.error("Missing prompt in request")
        return jsonify({"error": "Missing prompt"}), 400

    model_url = MODEL_ENDPOINTS[model]

    # Use different payload and endpoint for smollm2
    if model == "smollm2":
        api_endpoint = f"{model_url}/api/generate"
        payload = {"prompt": prompt}  # simple prompt
    else:
        api_endpoint = f"{model_url}/api/chat"
        payload = {"model": model, "messages": [{"role": "user", "content": prompt}]}

    try:
        response = requests.post(api_endpoint, json=payload, stream=True, timeout=120)
        response.raise_for_status()

        final_message = ""
        for line in response.iter_lines():
            if line:
                try:
                    obj = line.decode("utf-8")
                    parsed = json.loads(obj)

                    # Extract message based on model
                    if model == "smollm2":
                        msg = parsed.get("response", "")
                    else:
                        msg = parsed.get("message", {}).get("content", "")

                    final_message += msg
                except Exception as e:
                    logger.debug(f"Skipping malformed line: {e}")
                    continue

        elapsed = round(time.time() - start_time, 2)
        logger.info(f"Response from model '{model}' in {elapsed}s: {final_message[:100]}...")
        return jsonify({"response": final_message})

    except requests.exceptions.RequestException as e:
        logger.error(f"Error communicating with model '{model}': {e}")
        return jsonify({"error": str(e)}), 500

# ---------------- Run App ----------------
if __name__ == "__main__":
    logger.info("Starting Flask server on 0.0.0.0:5001")
    app.run(host="0.0.0.0", port=5001)
