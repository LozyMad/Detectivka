const { Pool } = require('pg');

// Конфигурация подключения к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/detectivka',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Функция для выполнения запросов
const query = (text, params) => {
  return pool.query(text, params);
};

// Функция для получения клиента (для транзакций)
const getClient = () => {
  return pool.connect();
};

// Инициализация основной базы данных
const initMainDatabase = async () => {
  try {
    console.log('Initializing PostgreSQL database...');
    
    // Создание таблиц
    await createTables();
    
    // Создание супер-админа по умолчанию
    await createDefaultSuperAdmin();
    
    console.log('PostgreSQL database initialized successfully');
  } catch (error) {
    console.error('Error initializing PostgreSQL database:', error);
    throw error;
  }
};

// Создание всех таблиц
const createTables = async () => {
  // Users table
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      admin_level VARCHAR(50) DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Scenarios table
  await query(`
    CREATE TABLE IF NOT EXISTS scenarios (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      is_active BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER REFERENCES users(id)
    )
  `);

  // Admin permissions table
  await query(`
    CREATE TABLE IF NOT EXISTS admin_permissions (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(admin_id, scenario_id)
    )
  `);

  // Rooms table
  await query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      scenario_id INTEGER REFERENCES scenarios(id),
      created_by INTEGER REFERENCES users(id),
      duration_seconds INTEGER DEFAULT 3600,
      game_start_time TIMESTAMP,
      game_end_time TIMESTAMP,
      state VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Room users table
  await query(`
    CREATE TABLE IF NOT EXISTS room_users (
      id SERIAL PRIMARY KEY,
      room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
      username VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Visited locations table
  await query(`
    CREATE TABLE IF NOT EXISTS visited_locations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      scenario_id INTEGER REFERENCES scenarios(id),
      address_id INTEGER NOT NULL,
      visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Visit attempts table
  await query(`
    CREATE TABLE IF NOT EXISTS visit_attempts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      scenario_id INTEGER REFERENCES scenarios(id),
      room_id INTEGER REFERENCES rooms(id),
      district VARCHAR(255) NOT NULL,
      house_number VARCHAR(255) NOT NULL,
      found BOOLEAN NOT NULL,
      address_id INTEGER,
      attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Questions table
  await query(`
    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      question_order INTEGER DEFAULT 1,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Question answers table
  await query(`
    CREATE TABLE IF NOT EXISTS question_answers (
      id SERIAL PRIMARY KEY,
      question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
      user_id INTEGER,
      room_user_id INTEGER,
      answer_text TEXT NOT NULL,
      answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Game choices table
  await query(`
    CREATE TABLE IF NOT EXISTS game_choices (
      id SERIAL PRIMARY KEY,
      room_user_id INTEGER NOT NULL,
      scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
      address_id INTEGER NOT NULL,
      choice_id INTEGER NOT NULL,
      choice_text TEXT NOT NULL,
      response_text TEXT NOT NULL,
      visited_location_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(room_user_id, scenario_id, address_id)
    )
  `);

  console.log('All tables created successfully');
};

// Создание супер-админа по умолчанию
const createDefaultSuperAdmin = async () => {
  try {
    const bcrypt = require('bcryptjs');
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    
    await query(
      `INSERT INTO users (username, password, is_admin, admin_level) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (username) DO NOTHING`,
      ['admin', hashedPassword, true, 'super_admin']
    );
    
    console.log('Default super admin created/verified');
  } catch (error) {
    console.error('Error creating default super admin:', error);
  }
};

module.exports = {
  query,
  getClient,
  pool,
  initMainDatabase
};
