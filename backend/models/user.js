const { db } = require('../config/database');
const bcrypt = require('bcryptjs');

const User = {
    create: (userData) => {
        return new Promise((resolve, reject) => {
            const { username, password, is_admin = false, admin_level = 'user' } = userData;
            const hashedPassword = bcrypt.hashSync(password, 10);
            
            db.run(
                `INSERT INTO users (username, password, is_admin, admin_level) VALUES (?, ?, ?, ?)`,
                [username, hashedPassword, is_admin, admin_level],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, username, is_admin, admin_level });
                }
            );
        });
    },

    findByUsername: (username) => {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM users WHERE username = ?`,
                [username],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    },

    findById: (id) => {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT id, username, is_admin, admin_level FROM users WHERE id = ?`,
                [id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    },

    findAll: () => {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT id, username, is_admin, admin_level, created_at FROM users ORDER BY created_at DESC`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    },

    verifyPassword: (plainPassword, hashedPassword) => {
        return bcrypt.compareSync(plainPassword, hashedPassword);
    },

    delete: (userId) => {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM users WHERE id = ?`, [userId], function(err) {
                if (err) return reject(err);
                resolve({ deletedId: userId });
            });
        });
    },

    // Получить всех админов (не супер-админов)
    findAllAdmins: () => {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT id, username, is_admin, admin_level, created_at 
                 FROM users 
                 WHERE is_admin = 1 AND admin_level != 'super_admin'
                 ORDER BY created_at DESC`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    },

    // Обновить уровень админа
    updateAdminLevel: (userId, admin_level) => {
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE users SET admin_level = ? WHERE id = ?`,
                [admin_level, userId],
                function(err) {
                    if (err) return reject(err);
                    resolve({ updatedId: userId, admin_level });
                }
            );
        });
    }
};

module.exports = User;