PostgreSQL Setup

Run this once:

CREATE DATABASE aiopsdb;
\c aiopsdb;
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50),
  email VARCHAR(100) UNIQUE,
  password TEXT
);



----------------------------------

🚀 Run the System
# Terminal 1
cd aiops-ollama-app/backend
npm install
node server.js

# Terminal 2
cd aiops-ollama-app/python
pip install -r requirements.txt
python ollama_api.py

# Terminal 3
# Serve frontend
cd aiops-ollama-app/frontend
python -m http.server 8080


Then open 👉 http://localhost:8080/signup.html




--------------------------

# Step 1: create a virtual environment
python3 -m venv venv

# Step 2: activate it
source venv/bin/activate

# Step 3: install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Step 4: run your script
python3 multi_ollama_api.py
