from flask import Flask, request, jsonify
from flask_cors import CORS
from ollama import chat as ollama_chat
import jwt

app = Flask(__name__)
CORS(app)

SECRET_KEY = "supersecret"
AVAILABLE_MODELS = ["llama3", "codellama", "mistral", "tinyllama"]

# --- Token validation helper ---
def validate_token(token):
    try:
        jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return True
    except Exception:
        return False


# --- Route: list all available models ---
@app.route("/models", methods=["GET"])
def list_models():
    return jsonify({"models": AVAILABLE_MODELS})


# --- Route: chat with selected model ---
@app.route("/ollama/chat", methods=["POST"])
def chat_with_model():
    data = request.get_json()
    token = data.get("token")
    model = data.get("model")
    prompt = data.get("prompt")

    # if not validate_token(token):
    #     return jsonify({"error": "Invalid token"}), 401

    if model not in AVAILABLE_MODELS:
        return jsonify({"error": "Model not available"}), 400

    if not prompt:
        return jsonify({"error": "Missing prompt"}), 400

    try:
        response = ollama_chat(model=model, messages=[{"role": "user", "content": prompt}])
        text = response["message"]["content"]
        return jsonify({"response": text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- Run app on port 5001 ---
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
