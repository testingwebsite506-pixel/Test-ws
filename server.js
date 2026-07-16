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
const centrifuge = new Centrifuge([
  {
    url: process.env.CENTRIFUGO_URL || 'ws://localhost:8000/connection/websocket',
  },
], {
  token: generateCentrifugoToken('server'),
});

// Redis configuration
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = redis.createClient({ url: redisUrl });

// Connect Redis client
redisClient.connect().catch(err => console.error('Redis connection error:', err));

// Initialize database
db.init();

// Generate JWT token for Centrifugo
function generateCentrifugoToken(userId) {
  const secret = process.env.CENTRIFUGO_SECRET || 'your-secret-key';
  return jwt.sign({ sub: String(userId) }, secret, { expiresIn: '24h' });
}

// Routes
app.use('/api/messages', require('./routes/messages'));
app.use('/api/users', require('./routes/users'));
app.use('/api/rooms', require('./routes/rooms'));

// Centrifugo auth endpoint
app.post('/api/centrifugo/auth', (req, res) => {
  try {
    const { user_id } = req.body;
    const token = generateCentrifugoToken(user_id);
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Centrifugo events
require('./sockets/chatCentrifugo')(centrifuge, redisClient);

// Connect Centrifugo client
centrifuge.connect();

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Centrifugo URL: ${process.env.CENTRIFUGO_URL || 'ws://localhost:8000/connection/websocket'}`);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
  centrifuge.disconnect();
  await redisClient.quit();
  await db.close();
});
