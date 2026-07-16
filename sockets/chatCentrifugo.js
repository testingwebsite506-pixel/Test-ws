const db = require('../database/db');
const redis = require('redis');

module.exports = (centrifuge, redisClient) => {
  // Store user connections: userId -> { centrifugeUserId, username, rooms: [...] }
  const userConnections = new Map();

  centrifuge.on('subscribe', async (ctx) => {
    const channel = ctx.channel;
    const userId = ctx.client.state?.user_id;
    const username = ctx.client.state?.username;

    console.log(`User ${username} subscribed to ${channel}`);

    if (channel.startsWith('room_')) {
      const roomId = channel.replace('room_', '');
      
      try {
        // Track user subscription
        const key = `${userId}`;
        const userData = userConnections.get(key) || {
          user_id: userId,
          username,
          rooms: new Set(),
          centrifugeUserId: ctx.client.state?.centrifugeUserId
        };
        userData.rooms.add(roomId);
        userConnections.set(key, userData);

        // Broadcast user joined message
        centrifuge.publish(`room_${roomId}`, {
          type: 'user_joined',
          data: {
            user_id: userId,
            username,
            message: `${username} joined the chat`,
            timestamp: new Date()
          }
        });
      } catch (error) {
        console.error('Error on room subscription:', error);
      }
    }
  });

  centrifuge.on('unsubscribe', (ctx) => {
    const channel = ctx.channel;
    const userId = ctx.client.state?.user_id;
    const username = ctx.client.state?.username;

    console.log(`User ${username} unsubscribed from ${channel}`);

    if (channel.startsWith('room_')) {
      const roomId = channel.replace('room_', '');
      
      try {
        // Remove room from user's subscription list
        const key = `${userId}`;
        const userData = userConnections.get(key);
        if (userData) {
          userData.rooms.delete(roomId);
          if (userData.rooms.size === 0) {
            userConnections.delete(key);
          }
        }

        // Broadcast user left message
        centrifuge.publish(`room_${roomId}`, {
          type: 'user_left',
          data: {
            username,
            message: `${username} left the chat`,
            timestamp: new Date()
          }
        });
      } catch (error) {
        console.error('Error on room unsubscription:', error);
      }
    }
  });

  centrifuge.on('connect', (ctx) => {
    console.log('Client connected:', ctx.client.id);
  });

  centrifuge.on('disconnect', async (ctx) => {
    console.log('Client disconnected:', ctx.client.id);
    
    try {
      // Find and clean up user data
      for (const [key, userData] of userConnections.entries()) {
        if (userData.centrifugeUserId === ctx.client.id) {
          const userId = userData.user_id;
          const username = userData.username;

          // Update user offline status
          await db.run(
            'UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?',
            [new Date(), userId]
          );

          // Remove from Redis
          await redisClient.hDel('online_users', `user_${userId}`);

          // Notify all rooms user was in
          for (const roomId of userData.rooms) {
            centrifuge.publish(`room_${roomId}`, {
              type: 'user_left',
              data: {
                username,
                message: `${username} disconnected`,
                timestamp: new Date()
              }
            });
          }

          // Broadcast offline status
          centrifuge.publish('user_status', {
            type: 'user_status_changed',
            data: {
              user_id: userId,
              username,
              status: 'offline',
              timestamp: new Date()
            }
          });

          userConnections.delete(key);
          break;
        }
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });

  // RPC handlers
  centrifuge.on('call', async (ctx) => {
    const { method, data } = ctx;

    try {
      switch (method) {
        case 'user_online':
          return await handleUserOnline(data, ctx.client, centrifuge, redisClient);
        
        case 'get_online_users':
          return await handleGetOnlineUsers(centrifuge, redisClient);
        
        case 'join_room':
          return await handleJoinRoom(data, ctx.client, centrifuge);
        
        case 'send_message':
          return await handleSendMessage(data, centrifuge);
        
        case 'mark_as_read':
          return await handleMarkAsRead(data, centrifuge);
        
        case 'typing':
          return await handleTyping(data, centrifuge);
        
        case 'stop_typing':
          return await handleStopTyping(data, centrifuge);
        
        case 'get_messages':
          return await handleGetMessages(data, centrifuge);
        
        case 'leave_room':
          return await handleLeaveRoom(data, ctx.client, centrifuge);
        
        case 'user_offline':
          return await handleUserOffline(data, centrifuge, redisClient);
        
        default:
          throw new Error(`Unknown method: ${method}`);
      }
    } catch (error) {
      console.error(`Error handling RPC ${method}:`, error);
      throw error;
    }
  });
};

async function handleUserOnline(data, client, centrifuge, redisClient) {
  const { user_id, username } = data;
  
  try {
    // Update client state
    client.state = { user_id, username, centrifugeUserId: client.id };

    // Update database
    await db.run(
      'UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?',
      [new Date(), user_id]
    );

    // Store in Redis
    await redisClient.hSet(`online_users`, `user_${user_id}`, JSON.stringify({
      user_id,
      username,
      centrifugo_id: client.id,
      online_at: new Date()
    }));

    console.log(`User ${username} (${user_id}) came online`);

    // Broadcast to all users
    centrifuge.publish('user_status', {
      type: 'user_status_changed',
      data: {
        user_id,
        username,
        status: 'online',
        timestamp: new Date()
      }
    });

    // Get and return all online users
    const onlineUsers = await redisClient.hGetAll('online_users');
    const onlineUsersList = Object.values(onlineUsers).map(u => JSON.parse(u));
    
    return { success: true, online_users: onlineUsersList };
  } catch (error) {
    console.error('Error marking user online:', error);
    throw error;
  }
}

async function handleGetOnlineUsers(centrifuge, redisClient) {
  try {
    const onlineUsers = await redisClient.hGetAll('online_users');
    const onlineUsersList = Object.values(onlineUsers).map(u => JSON.parse(u));
    return { success: true, online_users: onlineUsersList };
  } catch (error) {
    console.error('Error fetching online users:', error);
    throw error;
  }
}

async function handleJoinRoom(data, client, centrifuge) {
  const { user_id, room_id, username } = data;
  
  try {
    // Subscribe to room channel
    await client.subscribe(`room_${room_id}`);
    
    console.log(`User ${username} joined room ${room_id}`);
    
    return { success: true };
  } catch (error) {
    console.error('Error joining room:', error);
    throw error;
  }
}

async function handleSendMessage(data, centrifuge) {
  const { user_id, room_id, message, username } = data;
  const timestamp = new Date();

  try {
    // Save message to database
    const result = await db.run(
      'INSERT INTO messages (user_id, room_id, message, created_at) VALUES (?, ?, ?, ?)',
      [user_id, room_id, message, timestamp]
    );

    // Broadcast to room
    centrifuge.publish(`room_${room_id}`, {
      type: 'receive_message',
      data: {
        id: result.id,
        user_id,
        username,
        message,
        timestamp,
        read_by: []
      }
    });

    return { success: true, message_id: result.id };
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}

async function handleMarkAsRead(data, centrifuge) {
  const { message_id, user_id, room_id, username } = data;

  try {
    // Check if already marked
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

      // Get all read receipts for this message
      const readReceipts = await db.all(
        `SELECT r.user_id, u.username FROM read_receipts r 
         JOIN users u ON r.user_id = u.id 
         WHERE r.message_id = ?`,
        [message_id]
      );

      // Broadcast read status
      centrifuge.publish(`room_${room_id}`, {
        type: 'message_read',
        data: {
          message_id,
          user_id,
          username,
          read_by: readReceipts,
          timestamp: new Date()
        }
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Error marking message as read:', error);
    throw error;
  }
}

async function handleTyping(data, centrifuge) {
  const { room_id, username } = data;

  try {
    centrifuge.publish(`room_${room_id}`, {
      type: 'user_typing',
      data: {
        username,
        is_typing: true
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error handling typing:', error);
    throw error;
  }
}

async function handleStopTyping(data, centrifuge) {
  const { room_id, username } = data;

  try {
    centrifuge.publish(`room_${room_id}`, {
      type: 'user_typing',
      data: {
        username,
        is_typing: false
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error stopping typing:', error);
    throw error;
  }
}

async function handleGetMessages(data, centrifuge) {
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

    return { success: true, messages: messagesWithReceipts.reverse() };
  } catch (error) {
    console.error('Error fetching messages:', error);
    throw error;
  }
}

async function handleLeaveRoom(data, client, centrifuge) {
  const { room_id, username } = data;

  try {
    await client.unsubscribe(`room_${room_id}`);

    centrifuge.publish(`room_${room_id}`, {
      type: 'user_left',
      data: {
        username,
        message: `${username} left the chat`,
        timestamp: new Date()
      }
    });

    console.log(`User ${username} left room ${room_id}`);

    return { success: true };
  } catch (error) {
    console.error('Error leaving room:', error);
    throw error;
  }
}

async function handleUserOffline(data, centrifuge, redisClient) {
  const { user_id, username } = data;

  try {
    // Update database
    await db.run(
      'UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?',
      [new Date(), user_id]
    );

    // Remove from Redis
    await redisClient.hDel('online_users', `user_${user_id}`);

    console.log(`User ${username} (${user_id}) went offline`);

    // Broadcast offline status
    centrifuge.publish('user_status', {
      type: 'user_status_changed',
      data: {
        user_id,
        username,
        status: 'offline',
        timestamp: new Date()
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error marking user offline:', error);
    throw error;
  }
}
