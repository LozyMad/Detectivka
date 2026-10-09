const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

const RoomUser = {
  add: async ({ room_id, username, password }) => {
    const hashed = bcrypt.hashSync(password, 10);
    const result = await query(
      `INSERT INTO room_users (room_id, username, password) 
       VALUES ($1, $2, $3) RETURNING id, room_id, username`,
      [room_id, username, hashed]
    );
    return result.rows[0];
  },

  listByRoom: async (room_id) => {
    const result = await query(
      `SELECT id, room_id, username, created_at 
       FROM room_users 
       WHERE room_id = $1 
       ORDER BY created_at DESC`,
      [room_id]
    );
    return result.rows;
  },

  getByRoomId: async (room_id) => {
    const result = await query(
      `SELECT id, room_id, username, created_at 
       FROM room_users 
       WHERE room_id = $1 
       ORDER BY created_at DESC`,
      [room_id]
    );
    return result.rows;
  },

  remove: async (room_user_id) => {
    const result = await query(
      `DELETE FROM room_users WHERE id = $1 RETURNING id`,
      [room_user_id]
    );
    return result.rows[0] || { deletedId: room_user_id };
  },

  findByCredentials: async (username, password) => {
    const result = await query(
      `SELECT u.id, u.room_id, u.username, u.password FROM room_users u
       JOIN rooms r ON r.id = u.room_id WHERE u.username = $1 AND r.is_test = FALSE`, [username]
    );
    const matches = [];
    for (const row of result.rows) {
      if (await bcrypt.compare(password, row.password)) matches.push({ id: row.id, room_id: row.room_id, username: row.username });
    }
    return matches;
  },

  verifyCredentials: async (room_id, username, password) => {
    const result = await query(
      `SELECT * FROM room_users WHERE room_id = $1 AND username = $2`,
      [room_id, username]
    );
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    const ok = bcrypt.compareSync(password, row.password);
    if (!ok) return null;
    
    return { id: row.id, room_id: row.room_id, username: row.username };
  },

  getById: async (id) => {
    const result = await query(
      `SELECT * FROM room_users WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  // Получить всех пользователей комнат (для экспорта)
  getAll: async () => {
    const result = await query(
      `SELECT id, room_id, username, created_at 
       FROM room_users 
       ORDER BY room_id, created_at DESC`
    );
    return result.rows;
  }
};

module.exports = RoomUser;
