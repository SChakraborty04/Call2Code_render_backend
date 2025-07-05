#!/bin/bash

# Create a .env file if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating default .env file..."
  echo "PORT=8787" > .env
  echo "FRONTEND_URL=http://localhost:8080" >> .env
  echo "NODE_ENV=development" >> .env
fi

# Build and start the server
echo "Building TypeScript..."
npm run build

echo "Starting server with CORS debugging enabled..."
npm start
