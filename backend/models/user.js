const bcrypt = require('bcryptjs');
const db = require('../db/DbAdapter');
const logger = require('../utils/logger');

class User {
  constructor(data) {
    this.id = data.id;
    this.username = data.username;
    this.password = data.password;
    this.is_admin = data.is_admin;
    this.admin_level = data.admin_level;
    this.created_at = data.created_at;
  }

  // Создать нового пользователя
  static async create(userData) {
    try {
      const { username, password, is_admin = false, admin_level = 'user' } = userData;
      
      // Хешируем пароль
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const sql = `
        INSERT INTO users (username, password, is_admin, admin_level) 
        VALUES ($1, $2, $3, $4) 
        RETURNING *
      `;
      
      const result = await db.insert(sql, [username, hashedPassword, is_admin, admin_level]);
      
      if (result.insertId) {
        const user = await User.findById(result.insertId);
        return user;
      }
      
      throw new Error('Failed to create user');
    } catch (error) {
      logger.error('User creation error:', error);
      throw error;
    }
  }

  // Найти пользователя по ID
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM users WHERE id = $1';
      const result = await db.query(sql, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new User(result.rows[0]);
    } catch (error) {
      logger.error('User findById error:', error);
      throw error;
    }
  }

  // Найти пользователя по имени
  static async findByUsername(username) {
    try {
      const sql = 'SELECT * FROM users WHERE username = $1';
      const result = await db.query(sql, [username]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return new User(result.rows[0]);
    } catch (error) {
      logger.error('User findByUsername error:', error);
      throw error;
    }
  }

  // Получить всех пользователей
  static async getAll() {
    try {
      const sql = 'SELECT id, username, is_admin, admin_level, created_at FROM users ORDER BY created_at DESC';
      const result = await db.query(sql);
      
      return result.rows.map(row => new User(row));
    } catch (error) {
      logger.error('User getAll error:', error);
      throw error;
    }
  }

  // Обновить пользователя
  async update(updateData) {
    try {
      const { username, password, is_admin, admin_level } = updateData;
      const updates = [];
      const values = [];
      let paramCount = 1;

      if (username !== undefined) {
        updates.push(`username = $${paramCount++}`);
        values.push(username);
      }

      if (password !== undefined) {
        const hashedPassword = await bcrypt.hash(password, 10);
        updates.push(`password = $${paramCount++}`);
        values.push(hashedPassword);
      }

      if (is_admin !== undefined) {
        updates.push(`is_admin = $${paramCount++}`);
        values.push(is_admin);
      }

      if (admin_level !== undefined) {
        updates.push(`admin_level = $${paramCount++}`);
        values.push(admin_level);
      }

      if (updates.length === 0) {
        return this;
      }

      values.push(this.id);
      const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`;
      
      await db.update(sql, values);
      
      // Обновляем локальные данные
      Object.assign(this, updateData);
      
      return this;
    } catch (error) {
      logger.error('User update error:', error);
      throw error;
    }
  }

  // Удалить пользователя
  async delete() {
    try {
      const sql = 'DELETE FROM users WHERE id = $1';
      await db.delete(sql, [this.id]);
      return true;
    } catch (error) {
      logger.error('User delete error:', error);
      throw error;
    }
  }

  // Проверить пароль
  static async verifyPassword(plainPassword, hashedPassword) {
    try {
      return await bcrypt.compare(plainPassword, hashedPassword);
    } catch (error) {
      logger.error('Password verification error:', error);
      throw error;
    }
  }

  // Проверить, является ли пользователь админом
  isAdmin() {
    return this.is_admin === true;
  }

  // Проверить, является ли пользователь супер-админом
  isSuperAdmin() {
    return this.is_admin === true && this.admin_level === 'super_admin';
  }

  // Получить безопасные данные пользователя (без пароля)
  toSafeObject() {
    return {
      id: this.id,
      username: this.username,
      is_admin: this.is_admin,
      admin_level: this.admin_level,
      created_at: this.created_at
    };
  }
}

module.exports = User;