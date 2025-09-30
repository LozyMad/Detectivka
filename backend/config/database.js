const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const init = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users table
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        admin_level TEXT DEFAULT 'user' CHECK(admin_level IN ('user', 'admin', 'super_admin')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Scenarios table
      db.run(`CREATE TABLE IF NOT EXISTS scenarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT FALSE,
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(created_by) REFERENCES users(id)
      )`);

      // Admin scenario permissions table
      db.run(`CREATE TABLE IF NOT EXISTS admin_scenario_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        scenario_id INTEGER NOT NULL,
        granted_by INTEGER NOT NULL,
        granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(admin_id, scenario_id),
        FOREIGN KEY(admin_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
        FOREIGN KEY(granted_by) REFERENCES users(id)
      )`);

      // Questions table
      db.run(`CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scenario_id INTEGER NOT NULL,
        question_text TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(scenario_id) REFERENCES scenarios(id)
      )`);

      // Question answers table
      db.run(`CREATE TABLE IF NOT EXISTS question_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id INTEGER NOT NULL,
        user_id INTEGER,
        room_user_id INTEGER,
        answer_text TEXT NOT NULL,
        answered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(question_id) REFERENCES questions(id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(room_user_id) REFERENCES room_users(id)
      )`);

      // Addresses table
      db.run(`CREATE TABLE IF NOT EXISTS addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scenario_id INTEGER NOT NULL,
        district TEXT NOT NULL CHECK(district IN ('С', 'Ю', 'З', 'В', 'Ц', 'СВ', 'СЗ', 'ЮВ', 'ЮЗ')),
        house_number TEXT NOT NULL,
        description TEXT NOT NULL,
        FOREIGN KEY(scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
      )`);

      // Visited locations table
      db.run(`CREATE TABLE IF NOT EXISTS visited_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        scenario_id INTEGER NOT NULL,
        address_id INTEGER NOT NULL,
        visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(scenario_id) REFERENCES scenarios(id),
        FOREIGN KEY(address_id) REFERENCES addresses(id)
      )`);

      // Visit attempts table - ДОБАВЬТЕ ЭТУ ТАБЛИЦУ
      db.run(`CREATE TABLE IF NOT EXISTS visit_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        scenario_id INTEGER NOT NULL,
        room_id INTEGER,
        district TEXT NOT NULL,
        house_number TEXT NOT NULL,
        found BOOLEAN NOT NULL,
        address_id INTEGER,
        attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(scenario_id) REFERENCES scenarios(id),
        FOREIGN KEY(room_id) REFERENCES rooms(id),
        FOREIGN KEY(address_id) REFERENCES addresses(id)
      )`);

      // Добавляем колонку room_id если её нет
      db.run(`ALTER TABLE visit_attempts ADD COLUMN room_id INTEGER`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error adding room_id column:', err);
        }
      });

      // Rooms (games) table
      db.run(`CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        scenario_id INTEGER NOT NULL,
        created_by INTEGER NOT NULL,
        duration_seconds INTEGER DEFAULT 3600,
        game_start_time DATETIME,
        game_end_time DATETIME,
        state TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(scenario_id) REFERENCES scenarios(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      )`);

      // Add missing columns to existing tables if they don't exist
      db.run(`ALTER TABLE users ADD COLUMN admin_level TEXT DEFAULT 'user'`, (err) => {
        // Ignore error if column already exists
      });
      db.run(`ALTER TABLE scenarios ADD COLUMN created_by INTEGER`, (err) => {
        // Ignore error if column already exists
      });
      db.run(`ALTER TABLE rooms ADD COLUMN game_start_time DATETIME`, (err) => {
        // Ignore error if column already exists
      });
      db.run(`ALTER TABLE rooms ADD COLUMN game_end_time DATETIME`, (err) => {
        // Ignore error if column already exists
      });
      db.run(`ALTER TABLE rooms ADD COLUMN state TEXT DEFAULT 'pending'`, (err) => {
        // Ignore error if column already exists
      });

      // Room users (players for a room) table
      db.run(`CREATE TABLE IF NOT EXISTS room_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(room_id, username),
        FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
      )`);

      // Create default super admin user
      const bcrypt = require('bcryptjs');
      const hashedPassword = bcrypt.hashSync('admin123', 10);
      
      db.run(`INSERT OR IGNORE INTO users (username, password, is_admin, admin_level) 
              VALUES (?, ?, ?, ?)`, ['admin', hashedPassword, true, 'super_admin'], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
};

module.exports = {
  db,
  init
};