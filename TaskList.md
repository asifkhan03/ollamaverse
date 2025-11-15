# 🚀 Ollamaverse Project Task Breakdown

This document outlines the required tasks and infrastructure components for the project, focusing on core application deployment, observability (logging), and performance testing.

---

## I. Core Application Components Deployment

| Component | Endpoint/Files | Status | Action Required |
| :--- | :--- | :--- | :--- |
| **1. Frontend** | `asifahmadkhan.com/index.html`<br>`/signup.html`, `/login.html` | Defined | Deploy HTML files to an **AWS S3 bucket** configured for static website hosting. |
| **2. Backend (API)** | `api.asifahmadkhan.com/health`<br>`/auth/*`, `/ollama/*`, `/login.html`, `/signup.html` | Defined | Deploy API to EKS/Kubernetes. Ensure proper routing and security for all defined endpoints. |
| **3. Ollama Service** | `ollama.asifahmadkhan.com/health`<br>`/models` | Defined | Deploy Ollama service to EKS/Kubernetes. Expose endpoints and verify model availability. |
| **4. Token API** | `tokenapi.asifahmadkhan.com/v1/health`<br>`/v1/models`, `/v1/chat/completions` | Defined | Deploy Token API to EKS/Kubernetes. Securely expose all API endpoints. |

---

## II. Observability and Logging Stack

This section covers the deployment of the centralized logging infrastructure.

### 5. EFK Stack Implementation

* **Goal:** Deploy a centralized logging solution for the EKS cluster.
* **Components:**
    * **E**lasticsearch: Storage and indexing for log data.
    * **F**luentd (or Fluent Bit): Log collector/forwarder running as a DaemonSet on EKS nodes.
    * **K**ibana: Web interface for visualizing and analyzing logs.
* **Action:** Create and apply Kubernetes manifests (or use Helm charts) to deploy the EFK stack.

### 6. Application Logger Integration

* **Goal:** Ensure all application services generate logs that can be consumed by Fluentd.
* **Action:**
    * Implement **structured logging** (e.g., JSON format) within the Backend, Ollama, and Token API services.
    * Configure Fluentd/Fluent Bit agents to scrape logs from the application containers' standard output/error streams.

---

## III. Load Testing and Monitoring

This section outlines the performance testing strategy and result visualization.

### 7. Load Test Script 

* **Goal:** Create a script to simulate traffic against the deployed APIs.
* **Action:** Finalize a load test script (e.g., using Locust, k6, or Jmeter) targeting the Backend, Ollama, and Token API endpoints.

### 8. Automated Load Test CronJob

* **Goal:** Continuously monitor application performance.
* **Action:**
    * **Create a Kubernetes `CronJob` resource** in EKS.
    * **Schedule:** Configure the `CronJob` to run **every hour** (e.g., using cron schedule `0 * * * *`).
    * **Runtime:** The job must execute the load test script for a duration of **5 minutes** on each run.
    * **Artifacts:** Ensure the load test results are saved to a persistent location (e.g., S3 bucket or EFS volume) for later retrieval.

### 9. Dashboard for Load Test Results

* **Goal:** Visualize the results of the automated load tests.
* **Action:**
    * **Create a dedicated Kubernetes Pod/Deployment.**
    * This Pod must be configured to **fetch the load test result files** from the storage location (S3/EFS).
    * The Pod should run a simple web server or tool (e.g., a custom application or Grafana) to **parse and display the results** as a meaningful dashboard.

---

## Next Priority Tasks

1.  **Frontend S3 Deployment:** Deploy static HTML files to S3.
2.  **Backend Deployment:** Deploy the Core API service to EKS.

Which of these two priority tasks would you like to detail next? (e.g., **S3 Bucket Configuration** or **Backend EKS Deployment**)



