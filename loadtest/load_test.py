from locust import HttpUser, task, between

# ==============================
# Ollamaverse Load Testing Script
# ==============================

class OllamaverseLoadTest(HttpUser):
    # Users will wait between 0.5 and 1.5 seconds between requests
    wait_time = between(0.5, 1.5)
    host = "https://asifahmadkhan.com"  # Default base host (required by Locust)

    # -----------------
    # FRONTEND ROUTES
    # -----------------
    @task(5)
    def frontend_routes(self):
        routes = [
            "https://asifahmadkhan.com/index.html",
            "https://asifahmadkhan.com/signup.html",
            "https://asifahmadkhan.com/login.html",
        ]
        for route in routes:
            self.client.get(route, name=f"Frontend {route}")

    # -----------------
    # BACKEND ROUTES
    # -----------------
    @task(8)
    def backend_routes(self):
        endpoints = [
            "https://api.asifahmadkhan.com/health",
            "https://api.asifahmadkhan.com/auth/login",
            "https://api.asifahmadkhan.com/auth/signup",
            "https://api.asifahmadkhan.com/ollama/info",
            "https://api.asifahmadkhan.com/ollama/stats",
        ]
        for ep in endpoints:
            self.client.get(ep, name=f"Backend {ep}")

    # -----------------
    # OLLAMA ROUTES
    # -----------------
    @task(6)
    def ollama_routes(self):
        self.client.get("https://ollama.asifahmadkhan.com/health", name="Ollama /health")
        self.client.get("https://ollama.asifahmadkhan.com/models", name="Ollama /models")
        # POST request to /ask with realistic payload
        payload = {"prompt": "Tell me a fun fact about space."}
        headers = {"Content-Type": "application/json"}
        self.client.post("https://ollama.asifahmadkhan.com/ask", json=payload, headers=headers, name="Ollama /ask")

    # -----------------
    # TOKEN API ROUTES
    # -----------------
    @task(6)
    def tokenapi_routes(self):
        self.client.get("https://tokenapi.asifahmadkhan.com/v1/health", name="TokenAPI /v1/health")
        self.client.get("https://tokenapi.asifahmadkhan.com/v1/models", name="TokenAPI /v1/models")
        payload = {
            "model": "smollm2",
            "messages": [{"role": "user", "content": "Generate a short poem about DevOps"}],
        }
        headers = {"Content-Type": "application/json"}
        self.client.post(
            "https://tokenapi.asifahmadkhan.com/v1/chat/completions",
            json=payload,
            headers=headers,
            name="TokenAPI /v1/chat/completions"
        )
