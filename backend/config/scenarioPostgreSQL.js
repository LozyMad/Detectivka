const { Pool } = require('pg');

// Кэш подключений к базам данных сценариев
const scenarioConnections = new Map();

// Получение подключения к базе данных сценария
const getScenarioDb = (scenarioId) => {
  if (!scenarioConnections.has(scenarioId)) {
    // Для PostgreSQL все сценарии будут в одной базе, но в разных схемах
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/detectivka',
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    scenarioConnections.set(scenarioId, pool);
  }
  
  return scenarioConnections.get(scenarioId);
};

// Инициализация таблиц для сценария
const ensureTables = async (scenarioId) => {
  const pool = getScenarioDb(scenarioId);
  
  try {
    // Создаем схему для сценария если её нет
    await pool.query(`CREATE SCHEMA IF NOT EXISTS scenario_${scenarioId}`);
    
    // Addresses table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scenario_${scenarioId}.addresses (
        id SERIAL PRIMARY KEY,
        district VARCHAR(255) NOT NULL,
        house_number VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Visited locations table (в схеме сценария)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scenario_${scenarioId}.visited_locations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        room_id INTEGER,
        address_id INTEGER NOT NULL,
        visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Visit attempts table (в схеме сценария)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scenario_${scenarioId}.visit_attempts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        room_id INTEGER,
        district VARCHAR(255) NOT NULL,
        house_number VARCHAR(255) NOT NULL,
        found BOOLEAN NOT NULL,
        address_id INTEGER,
        attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Address choices table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scenario_${scenarioId}.address_choices (
        id SERIAL PRIMARY KEY,
        address_id INTEGER NOT NULL,
        choice_text TEXT NOT NULL,
        response_text TEXT NOT NULL,
        choice_order INTEGER NOT NULL DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log(`Tables ensured for scenario ${scenarioId}`);
  } catch (error) {
    console.error(`Error ensuring tables for scenario ${scenarioId}:`, error);
    throw error;
  }
};

// Выполнение запроса к базе сценария
const queryScenario = async (scenarioId, text, params = []) => {
  const pool = getScenarioDb(scenarioId);
  return pool.query(text, params);
};

// Закрытие всех подключений
const closeAllConnections = async () => {
  for (const [scenarioId, pool] of scenarioConnections) {
    try {
      await pool.end();
      console.log(`Closed connection for scenario ${scenarioId}`);
    } catch (error) {
      console.error(`Error closing connection for scenario ${scenarioId}:`, error);
    }
  }
  scenarioConnections.clear();
};

module.exports = {
  getScenarioDb,
  ensureTables,
  queryScenario,
  closeAllConnections
};
