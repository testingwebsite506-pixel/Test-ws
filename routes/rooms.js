const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Get all rooms
router.get('/', async (req, res) => {
  try {
    const rooms = await db.all(
      `SELECT r.id, r.name, r.description, r.created_by, r.created_at, u.username as creator 
       FROM rooms r 
       LEFT JOIN users u ON r.created_by = u.id 
       ORDER BY r.created_at DESC`
    );
    res.json(rooms);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Get room by id
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const room = await db.get(
      `SELECT r.id, r.name, r.description, r.created_by, r.created_at, u.username as creator 
       FROM rooms r 
       LEFT JOIN users u ON r.created_by = u.id 
       WHERE r.id = ?`,
      [id]
    );

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json(room);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

// Create room
router.post('/', async (req, res) => {
  const { name, description, created_by } = req.body;

  if (!name || !created_by) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await db.run(
      'INSERT INTO rooms (name, description, created_by) VALUES (?, ?, ?)',
      [name, description || null, created_by]
    );

    res.status(201).json({
      id: result.id,
      name,
      description,
      created_by,
      created_at: new Date()
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Room name already exists' });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Get room members
router.get('/:id/members', async (req, res) => {
  const { id } = req.params;

  try {
    const members = await db.all(
      `SELECT u.id, u.username, u.email, rm.joined_at 
       FROM room_members rm 
       JOIN users u ON rm.user_id = u.id 
       WHERE rm.room_id = ? 
       ORDER BY rm.joined_at`,
      [id]
    );

    res.json(members);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch room members' });
  }
});

// Add member to room
router.post('/:id/members', async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  try {
    const result = await db.run(
      'INSERT INTO room_members (room_id, user_id) VALUES (?, ?)',
      [id, user_id]
    );

    res.status(201).json({ message: 'Member added to room' });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'User is already a member of this room' });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to add member to room' });
  }
});

// Remove member from room
router.delete('/:id/members/:user_id', async (req, res) => {
  const { id, user_id } = req.params;

  try {
    const result = await db.run(
      'DELETE FROM room_members WHERE room_id = ? AND user_id = ?',
      [id, user_id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Member not found in room' });
    }

    res.json({ message: 'Member removed from room' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to remove member from room' });
  }
});

module.exports = router;
