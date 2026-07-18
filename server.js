const express = require('express');
const http = require('http');
const { Centrifuge } = require('centrifuge');
const cors = require('cors');
const redis = require('redis');
const dotenv = require('dotenv');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./database/db');

dotenv.config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Centrifugo setup
const CENTRIFUGO_URL = process.env.CENTRIFUGO_URL || 'ws://localhost:8000/connection/websocket';
const CENTRIFUGO_SECRET = process.env.CENTRIFUGO_SECRET || 'your-secret-key';

console.log('🔌 Centrifugo URL:', CENTRIFUGO_URL);

const centrifuge = new Centrifuge({
  url: CENTRIFUGO_URL,
  token: generateCentrifugoToken('server'),
});

// Redis configuration
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = redis.createClient({ url: redisUrl });

// Connect Redis client
redisClient.connect().catch(err => {
  console.error('❌ Redis connection error:', err);
  console.log('⚠️  Continuing without Redis...');
});

redisClient.on('error', (err) => console.error('❌ Redis error:', err));
redisClient.on('connect', () => console.log('✅ Connected to Redis'));

// Initialize database
db.init();

// Generate JWT token for Centrifugo
function generateCentrifugoToken(userId) {
  const secret = CENTRIFUGO_SECRET;
  return jwt.sign({ sub: String(userId) }, secret, { expiresIn: '24h' });
}

// Routes
app.use('/api/messages', require('./routes/messages'));
app.use('/api/users', require('./routes/users'));
app.use('/api/rooms', require('./routes/rooms'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Centrifugo auth endpoint
app.post('/api/centrifugo/auth', (req, res) => {
  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const token = generateCentrifugoToken(user_id);
    res.json({ token });
  } catch (error) {
    console.error('❌ Auth error:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// Serve index.html for all other routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Centrifugo events handler
require('./sockets/chatCentrifugo')(centrifuge, redisClient);

// Connect Centrifugo client
centrifuge.connect();

centrifuge.on('connect', () => {
  console.log('✅ Connected to Centrifugo server');
});

centrifuge.on('disconnect', (ctx) => {
  console.log('⚠️  Disconnected from Centrifugo:', ctx.reason);
});

centrifuge.on('error', (error) => {
  console.error('❌ Centrifugo error:', error);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║          🚀 Chat WebSocket Server Running 🚀          ║');
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║  Server:       http://localhost:${PORT}`);
  console.log(`║  Centrifugo:   ${CENTRIFUGO_URL}`);
  console.log(`║  Environment:  ${process.env.NODE_ENV || 'development'}`);
  console.log('║                                                       ║');
  console.log('║  Admin Panel:  http://localhost:8000/admin            ║');
  console.log('║  Health:       http://localhost:' + PORT + '/health                 ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('');
  console.log('⚙️  SIGTERM signal received: closing server gracefully...');
  
  server.close(async () => {
    console.log('✅ HTTP server closed');
  });

  try {
    centrifuge.disconnect();
    console.log('✅ Centrifugo disconnected');
    
    await redisClient.quit();
    console.log('✅ Redis disconnected');
    
    await db.close();
    console.log('✅ Database closed');
    
    console.log('👋 Server shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('');
  console.log('⚙️  SIGINT signal received: closing server...');
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = server;
