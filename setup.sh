#!/bin/bash

# Setup script for Chat WebSocket Application

echo "🚀 Setting up Chat WebSocket Application..."

# Check if Docker is installed
if ! command -v docker &> /dev/null
then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

echo "✅ Docker found"

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null
then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker Compose found"

# Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install

# Create .env if not exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env 2>/dev/null || cat > .env << 'EOF'
NODE_ENV=development
PORT=3000
CENTRIFUGO_URL=ws://localhost:8000/connection/websocket
CENTRIFUGO_SECRET=your-secret-key-change-this-in-production
REDIS_URL=redis://localhost:6379
DATABASE_PATH=./database.db
EOF
    echo "✅ .env file created. Please update it with your configuration."
else
    echo "✅ .env file already exists"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "To start the application, run:"
echo "  docker-compose up"
echo ""
echo "Then open http://localhost:3000 in your browser"
echo ""
echo "Centrifugo Admin Panel: http://localhost:8000/admin"
echo ""
