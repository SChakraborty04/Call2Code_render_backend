#!/bin/bash

echo "🚀 Starting Backend with Global Access"
echo "======================================"

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed. Installing..."
    npm install -g ngrok
fi

# Check if the server is already running
if lsof -Pi :8787 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  Port 8787 is already in use. Stopping existing process..."
    pkill -f "tsx watch" || true
    sleep 2
fi

echo "🔧 Starting Express server..."
npm run dev &
SERVER_PID=$!

echo "⏳ Waiting for server to start..."
sleep 5

echo "🌐 Starting ngrok tunnel..."
ngrok http 8787 &
NGROK_PID=$!

echo ""
echo "✅ Setup complete!"
echo "📍 Local server: http://localhost:8787"
echo "🌍 Global access: Check ngrok output above for your public URL"
echo "📊 Health check: http://localhost:8787/health"
echo "🔧 DB Status: http://localhost:8787/admin/db/status"
echo ""
echo "To stop both services, press Ctrl+C"

# Trap Ctrl+C and cleanup
trap 'echo "🛑 Stopping services..."; kill $SERVER_PID $NGROK_PID; exit 0' INT

# Wait for both processes
wait
