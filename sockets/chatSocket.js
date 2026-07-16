const db = require('../database/db');
const redis = require('redis');

// Redis client for storing online users
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined
});

redisClient.connect().catch(console.error);

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);

    // User comes online
    socket.on('user_online', async (data) => {
      const { user_id, username } = data;
      socket.userId = user_id;
      socket.username = username;

      try {
        // Update user online status in database
        await db.run(
          'UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?',
          [new Date(), user_id]
        );

        // Store in Redis for quick access
        await redisClient.hSet(`online_users`, `user_${user_id}`, JSON.stringify({
          user_id,
          username,
          socket_id: socket.id,
          online_at: new Date()
        }));

        // Get all online users
        const onlineUsers = await redisClient.hGetAll('online_users');
        const onlineUsersList = Object.values(onlineUsers).map(u => JSON.parse(u));

        console.log(`User ${username} (${user_id}) came online`);

        // Broadcast to all connected clients
        io.emit('user_status_changed', {
          user_id,
          username,
          status: 'online',
          timestamp: new Date()
        });

        // Send list of all online users to the newly connected user
        socket.emit('online_users_list', onlineUsersList);
      } catch (error) {
        console.error('Error marking user online:', error);
        socket.emit('error', { message: 'Failed to mark user online' });
      }
    });

    // Get online users
    socket.on('get_online_users', async (data) => {
      try {
        const onlineUsers = await redisClient.hGetAll('online_users');
        const onlineUsersList = Object.values(onlineUsers).map(u => JSON.parse(u));
        socket.emit('online_users_list', onlineUsersList);
      } catch (error) {
        console.error('Error fetching online users:', error);
        socket.emit('error', { message: 'Failed to fetch online users' });
      }
    });

    // User joins a room
    socket.on('join_room', async (data) => {
      const { user_id, room_id, username } = data;
      socket.join(`room_${room_id}`);
      socket.userId = user_id;
      socket.username = username;
      socket.roomId = room_id;

      console.log(`User ${username} joined room ${room_id}`);

      // Notify room members
      io.to(`room_${room_id}`).emit('user_joined', {
        user_id,
        username,
        message: `${username} joined the chat`,
        timestamp: new Date()
      });
    });

    // Receive and broadcast message
    socket.on('send_message', async (data) => {
      const { user_id, room_id, message, username } = data;
      const timestamp = new Date();

      try {
        // Save message to SQLite
        const result = await db.run(
          'INSERT INTO messages (user_id, room_id, message, created_at) VALUES (?, ?, ?, ?)',
          [user_id, room_id, message, timestamp]
        );

        const messageId = result.id;

        // Broadcast to room
        io.to(`room_${room_id}`).emit('receive_message', {
          id: messageId,
          user_id,
          username,
          message,
          timestamp,
          socket_id: socket.id,
          read_by: []
        });
      } catch (error) {
        console.error('Error saving message:', error);
        socket.emit('error', { message: 'Failed to save message' });
      }
    });

    // Mark message as read
    socket.on('mark_as_read', async (data) => {
      const { message_id, user_id, room_id, username } = data;

      try {
        // Check if already marked as read
        const existingReceipt = await db.get(
          'SELECT id FROM read_receipts WHERE message_id = ? AND user_id = ?',
          [message_id, user_id]
        );

        if (!existingReceipt) {
          // Save read receipt
          await db.run(
            'INSERT INTO read_receipts (message_id, user_id, read_at) VALUES (?, ?, ?)',
            [message_id, user_id, new Date()]
          );

          // Get all users who have read this message
          const readReceipts = await db.all(
            `SELECT r.user_id, u.username FROM read_receipts r 
             JOIN users u ON r.user_id = u.id 
             WHERE r.message_id = ?`,
            [message_id]
          );

          // Broadcast read receipt to room
          io.to(`room_${room_id}`).emit('message_read', {
            message_id,
            user_id,
            username,
            read_by: readReceipts,
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error('Error marking message as read:', error);
        socket.emit('error', { message: 'Failed to mark message as read' });
      }
    });

    // User typing
    socket.on('typing', (data) => {
      const { room_id, username } = data;
      socket.to(`room_${room_id}`).emit('user_typing', {
        username,
        is_typing: true
      });
    });

    // User stops typing
    socket.on('stop_typing', (data) => {
      const { room_id, username } = data;
      socket.to(`room_${room_id}`).emit('user_typing', {
        username,
        is_typing: false
      });
    });

    // Get room messages
    socket.on('get_messages', async (data) => {
      const { room_id, user_id, limit = 50, offset = 0 } = data;

      try {
        const messages = await db.all(
          `SELECT m.id, m.user_id, m.message, m.created_at, u.username,
           (SELECT COUNT(*) FROM read_receipts WHERE message_id = m.id) as read_count
           FROM messages m 
           JOIN users u ON m.user_id = u.id 
           WHERE m.room_id = ? 
           ORDER BY m.created_at DESC 
           LIMIT ? OFFSET ?`,
          [room_id, limit, offset]
        );

        // Get read receipts for each message
        const messagesWithReceipts = await Promise.all(
          messages.map(async (msg) => {
            const readReceipts = await db.all(
              `SELECT r.user_id, u.username FROM read_receipts r 
               JOIN users u ON r.user_id = u.id 
               WHERE r.message_id = ?`,
              [msg.id]
            );
            return {
              ...msg,
              read_by: readReceipts
            };
          })
        );

        socket.emit('messages_list', messagesWithReceipts.reverse());
      } catch (error) {
        console.error('Error fetching messages:', error);
        socket.emit('error', { message: 'Failed to fetch messages' });
      }
    });

    // User leaves room
    socket.on('leave_room', (data) => {
      const { room_id, username } = data;
      socket.leave(`room_${room_id}`);

      io.to(`room_${room_id}`).emit('user_left', {
        username,
        message: `${username} left the chat`,
        timestamp: new Date()
      });

      console.log(`User ${username} left room ${room_id}`);
    });

    // User goes offline
    socket.on('user_offline', async (data) => {
      const { user_id, username } = data;

      try {
        // Update user offline status in database
        await db.run(
          'UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?',
          [new Date(), user_id]
        );

        // Remove from Redis
        await redisClient.hDel('online_users', `user_${user_id}`);

        console.log(`User ${username} (${user_id}) went offline`);

        // Broadcast to all connected clients
        io.emit('user_status_changed', {
          user_id,
          username,
          status: 'offline',
          timestamp: new Date()
        });
      } catch (error) {
        console.error('Error marking user offline:', error);
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log('User disconnected:', socket.id);
      if (socket.userId && socket.username) {
        try {
          // Mark user as offline
          await db.run(
            'UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?',
            [new Date(), socket.userId]
          );

          // Remove from Redis
          await redisClient.hDel('online_users', `user_${socket.userId}`);

          io.emit('user_status_changed', {
            user_id: socket.userId,
            username: socket.username,
            status: 'offline',
            timestamp: new Date()
          });

          if (socket.roomId) {
            io.to(`room_${socket.roomId}`).emit('user_left', {
              username: socket.username,
              message: `${socket.username} disconnected`,
              timestamp: new Date()
            });
          }
        } catch (error) {
          console.error('Error handling disconnect:', error);
        }
      }
    });
  });
};
