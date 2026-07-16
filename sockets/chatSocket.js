const db = require('../database/db');

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);

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
        await db.run(
          'INSERT INTO messages (user_id, room_id, message, created_at) VALUES (?, ?, ?, ?)',
          [user_id, room_id, message, timestamp]
        );

        // Broadcast to room
        io.to(`room_${room_id}`).emit('receive_message', {
          user_id,
          username,
          message,
          timestamp,
          socket_id: socket.id
        });
      } catch (error) {
        console.error('Error saving message:', error);
        socket.emit('error', { message: 'Failed to save message' });
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
      const { room_id, limit = 50, offset = 0 } = data;

      try {
        const messages = await db.all(
          `SELECT m.id, m.user_id, m.message, m.created_at, u.username 
           FROM messages m 
           JOIN users u ON m.user_id = u.id 
           WHERE m.room_id = ? 
           ORDER BY m.created_at DESC 
           LIMIT ? OFFSET ?`,
          [room_id, limit, offset]
        );

        socket.emit('messages_list', messages.reverse());
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

    // Disconnect
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      if (socket.roomId && socket.username) {
        io.to(`room_${socket.roomId}`).emit('user_left', {
          username: socket.username,
          message: `${socket.username} disconnected`,
          timestamp: new Date()
        });
      }
    });
  });
};
