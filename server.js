const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const redis = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const dotenv = require('dotenv');
const path = require('path');
const db = require('./database/db');

dotenv.config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Socket.io setup
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Redis configuration
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const pubClient = redis.createClient({ url: redisUrl });
const subClient = pubClient.duplicate();

// Connect Redis clients
pubClient.connect().catch(err => console.error('Redis connection error:', err));
subClient.connect().catch(err => console.error('Redis subscription connection error:', err));

// Setup Socket.io Redis adapter for multiple server instances
io.adapter(createAdapter(pubClient, subClient));

// Initialize database
db.init();

// Routes
app.use('/api/messages', require('./routes/messages'));
app.use('/api/users', require('./routes/users'));
app.use('/api/rooms', require('./routes/rooms'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Socket.io events
require('./sockets/chatSocket')(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
  await pubClient.quit();
  await subClient.quit();
  await db.close();
});
