const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Cache of opened sqlite connections keyed by scenarioId
const scenarioIdToDb = new Map();

function getScenarioDbPath(scenarioId) {
  const dataDir = path.join(__dirname, '..', 'data', 'scenarios');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, `${scenarioId}.sqlite`);
}

function ensureTables(db) {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      district TEXT NOT NULL CHECK(district IN ('С', 'Ю', 'З', 'В', 'Ц', 'СВ', 'СЗ', 'ЮВ', 'ЮЗ')),
      house_number TEXT NOT NULL,
      description TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS visited_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      room_id INTEGER,
      address_id INTEGER NOT NULL,
      visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(address_id) REFERENCES addresses(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS visit_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      room_id INTEGER,
      district TEXT NOT NULL,
      house_number TEXT NOT NULL,
      found BOOLEAN NOT NULL,
      address_id INTEGER,
      attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(address_id) REFERENCES addresses(id)
    )`);
  });
}

function getScenarioDb(scenarioId) {
  if (scenarioIdToDb.has(scenarioId)) {
    return scenarioIdToDb.get(scenarioId);
  }
  const dbPath = getScenarioDbPath(scenarioId);
  const db = new sqlite3.Database(dbPath);
  ensureTables(db);
  scenarioIdToDb.set(scenarioId, db);
  return db;
}

function createScenarioDb(scenarioId) {
  const db = getScenarioDb(scenarioId);
  return db;
}

function deleteScenarioDb(scenarioId) {
  const dbPath = getScenarioDbPath(scenarioId);
  if (scenarioIdToDb.has(scenarioId)) {
    try {
      scenarioIdToDb.get(scenarioId).close();
    } catch (_) {}
    scenarioIdToDb.delete(scenarioId);
  }
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

module.exports = {
  getScenarioDb,
  createScenarioDb,
  deleteScenarioDb
};


