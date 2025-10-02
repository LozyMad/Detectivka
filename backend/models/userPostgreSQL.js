const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

const User = {
    create: async (userData) => {
        const { username, password, is_admin = false, admin_level = 'user' } = userData;
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        const result = await query(
            `INSERT INTO users (username, password, is_admin, admin_level) 
             VALUES ($1, $2, $3, $4) RETURNING id, username, is_admin, admin_level`,
            [username, hashedPassword, is_admin, admin_level]
        );
        
        return result.rows[0];
    },

    findByUsername: async (username) => {
        const result = await query(
            `SELECT * FROM users WHERE username = $1`,
            [username]
        );
        
        return result.rows[0] || null;
    },

    findById: async (id) => {
        const result = await query(
            `SELECT * FROM users WHERE id = $1`,
            [id]
        );
        
        return result.rows[0] || null;
    },

    getAll: async () => {
        const result = await query(
            `SELECT id, username, is_admin, admin_level, created_at FROM users ORDER BY created_at DESC`
        );
        
        return result.rows;
    },

    update: async (id, userData) => {
        const { username, is_admin, admin_level } = userData;
        
        const result = await query(
            `UPDATE users SET username = $1, is_admin = $2, admin_level = $3 
             WHERE id = $4 RETURNING id, username, is_admin, admin_level`,
            [username, is_admin, admin_level, id]
        );
        
        return result.rows[0] || null;
    },

    updatePassword: async (id, newPassword) => {
        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        
        const result = await query(
            `UPDATE users SET password = $1 WHERE id = $2 RETURNING id`,
            [hashedPassword, id]
        );
        
        return result.rows[0] || null;
    },

    delete: async (id) => {
        const result = await query(
            `DELETE FROM users WHERE id = $1 RETURNING id, username`,
            [id]
        );
        
        return result.rows[0] || null;
    },

    verifyPassword: (plainPassword, hashedPassword) => {
        return bcrypt.compareSync(plainPassword, hashedPassword);
    },

    // Получить всех админов
    getAdmins: async () => {
        const result = await query(
            `SELECT id, username, admin_level, created_at 
             FROM users 
             WHERE is_admin = true 
             ORDER BY admin_level DESC, created_at DESC`
        );
        
        return result.rows;
    },

    // Получить админов с определенным уровнем
    getAdminsByLevel: async (level) => {
        const result = await query(
            `SELECT id, username, admin_level, created_at 
             FROM users 
             WHERE is_admin = true AND admin_level = $1 
             ORDER BY created_at DESC`,
            [level]
        );
        
        return result.rows;
    }
};

module.exports = User;
