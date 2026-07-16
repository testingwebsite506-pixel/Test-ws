const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const redis = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const dotenv = require('dotenv');
const db = require('./database/db');

dotenv.config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Socket.io setup
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Redis clients for Socket.io adapter
const pubClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined
});

const subClient = pubClient.duplicate();

// Connect Redis clients
pubClient.connect().catch(console.error);
subClient.connect().catch(console.error);

// Setup Socket.io Redis adapter for multiple server instances
io.adapter(createAdapter(pubClient, subClient));

// Initialize database
db.init();

// Routes
app.use('/api/messages', require('./routes/messages'));
app.use('/api/users', require('./routes/users'));
app.use('/api/rooms', require('./routes/rooms'));

app.get('/', (req, res) => {
  res.send('Chat Backend Server is running');
});

// Socket.io events
require('./sockets/chatSocket')(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
