const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Get messages for a room
router.get('/room/:room_id', async (req, res) => {
  const { room_id } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  try {
    const messages = await db.all(
      `SELECT m.id, m.user_id, m.message, m.created_at, u.username 
       FROM messages m 
       JOIN users u ON m.user_id = u.id 
       WHERE m.room_id = ? 
       ORDER BY m.created_at DESC 
       LIMIT ? OFFSET ?`,
      [room_id, parseInt(limit), parseInt(offset)]
    );

    res.json(messages.reverse());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get message by id
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const message = await db.get(
      `SELECT m.id, m.user_id, m.message, m.created_at, u.username 
       FROM messages m 
       JOIN users u ON m.user_id = u.id 
       WHERE m.id = ?`,
      [id]
    );

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

// Delete message
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.run('DELETE FROM messages WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

module.exports = router;
