from locust import HttpUser, task, between

class LoadTestAPIs(HttpUser):
    # Users wait between requests
    wait_time = between(0.5, 1.5)

    # Base backend host
    host = "https://api.asifahmadkhan.com"

    # -----------------------------------------
    # DEFAULT HEADERS for token API requests
    # -----------------------------------------
    common_headers = {
        "accept": "*/*",
        "content-type": "application/json",
        "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZWU0ZWFkMTk2MzQzNzg3YzM2NjdkOCIsInVzZXJuYW1lIjoiYWRtaW4iLCJlbWFpbCI6ImFkbWluQGFkbWluLmNvbSIsImlhdCI6MTc2MzEyMDkzMiwiZXhwIjoxNzYzMjA3MzMyfQ.4q9mwvLnFCLM0EQSlzdrTvPJRmazOdKIELls0bFAvcU",
        "user-agent": "LocustLoadTester"
    }

    # ---------------------
    # HEALTH CHECK
    # ---------------------
    @task(2)
    def health(self):
        self.client.get("/health", name="Backend /health")

    # ---------------------
    # LOGIN
    # ---------------------
    @task(2)
    def login_api(self):
        payload = {"email": "admin@admin.com", "password": "admin"}
        self.client.post(
            "/auth/login",
            json=payload,
            headers={"content-type": "application/json"},
            name="Backend /auth/login"
        )

    # ---------------------
    # TOKEN API: VERIFY
    # ---------------------
    @task(3)
    def token_verify(self):
        self.client.get(
            "https://tokenapi.asifahmadkhan.com/v1/health",
            name="TokenAPI /v1/health"
        )

  


    # ------------------------------------------------
    # NEW TASK 1 — /tokens/generate  (POST)
    # ------------------------------------------------
    @task(3)
    def token_generate(self):
        payload = {
            "name": "xxx",
            "scopes": ["chat", "models"],
            "expiryDays": 365
        }

        self.client.post(
            "https://tokenapi.asifahmadkhan.com/tokens/generate",
            json=payload,
            headers=self.common_headers,
            name="TokenAPI /tokens/generate"
        )

    # ------------------------------------------------
    # NEW TASK 2 — /tokens/list  (GET)
    # ------------------------------------------------
    @task(3)
    def token_list(self):
        self.client.get(
            "https://tokenapi.asifahmadkhan.com/tokens/list",
            headers=self.common_headers,
            name="TokenAPI /tokens/list"
        )

    # ------------------------------------------------
    # NEW TASK 3 — Backend /auth/login (POST)
    # ------------------------------------------------
    @task(3)
    def backend_login(self):
        payload = {"email": "admin@admin.com", "password": "admin"}

        self.client.post(
            "https://api.asifahmadkhan.com/auth/login",
            json=payload,
            headers={"content-type": "application/json"},
            name="Backend /auth/login (curl)"
        )
