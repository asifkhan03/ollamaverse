#!/bin/bash

echo "🚀 Starting Ollamaverse Frontend"
echo "==============================="

cd "$(dirname "$0")"

# Check if Python is available
if command -v python3 &> /dev/null; then
    echo "📂 Serving frontend on http://localhost:3000"
    echo "🌐 Open your browser and go to: http://localhost:3000/login.html"
    echo ""
    echo "💡 Make sure your backend is running on http://localhost:8080"
    echo ""
    echo "Press Ctrl+C to stop the server"
    echo ""
    python3 -m http.server 3000
elif command -v python &> /dev/null; then
    echo "📂 Serving frontend on http://localhost:3000"
    echo "🌐 Open your browser and go to: http://localhost:3000/login.html"
    echo ""
    echo "💡 Make sure your backend is running on http://localhost:8080"
    echo ""
    echo "Press Ctrl+C to stop the server"
    echo ""
    python -m http.server 3000
else
    echo "❌ Python not found. Please install Python or use an alternative method."
    echo ""
    echo "Alternative methods:"
    echo "1. Install Node.js and use: npx http-server -p 3000"
    echo "2. Use VS Code Live Server extension"
    echo "3. Open index.html directly in your browser"
fi