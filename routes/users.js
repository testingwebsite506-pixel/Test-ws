const express = require('express');
const router = express.Router();
const db = require('../database/db');
const redis = require('redis');

const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.connect().catch(console.error);

// Get all users
router.get('/', async (req, res) => {
  try {
    const users = await db.all('SELECT id, username, email, is_online, last_seen, created_at FROM users');
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get all online users
router.get('/online', async (req, res) => {
  try {
    const onlineUsers = await redisClient.hGetAll('online_users');
    const onlineUsersList = Object.values(onlineUsers).map(u => JSON.parse(u));
    res.json(onlineUsersList);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch online users' });
  }
});

// Get user by id
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const user = await db.get(
      'SELECT id, username, email, is_online, last_seen, created_at FROM users WHERE id = ?',
      [id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create user (no auth)
router.post('/', async (req, res) => {
  const { username, email } = req.body;

  // Validation
  if (!username || !email) {
    return res.status(400).json({ error: 'Username and email are required' });
  }

  if (username.length < 2 || username.length > 50) {
    return res.status(400).json({ error: 'Username must be between 2 and 50 characters' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    const result = await db.run(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username.trim(), email.toLowerCase().trim(), 'no_auth']
    );

    res.status(201).json({
      id: result.id,
      username,
      email,
      is_online: false,
      created_at: new Date()
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { username, email } = req.body;

  try {
    let query = 'UPDATE users SET updated_at = CURRENT_TIMESTAMP';
    const params = [];

    if (username) {
      if (username.length < 2 || username.length > 50) {
        return res.status(400).json({ error: 'Username must be between 2 and 50 characters' });
      }
      query += ', username = ?';
      params.push(username.trim());
    }
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      query += ', email = ?';
      params.push(email.toLowerCase().trim());
    }

    query += ' WHERE id = ?';
    params.push(id);

    const result = await db.run(query, params);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.run('DELETE FROM users WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
