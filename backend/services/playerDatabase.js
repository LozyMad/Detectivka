const path = require('path');
const database = require('../config/database');
const postgres = process.env.DB_TYPE === 'postgresql';
let connection;
let pending = Promise.resolve();
function sqliteQuery(sql, values = []) {
  if (!connection) {
    connection = new (require('sqlite3').verbose().Database)(process.env.SQLITE_DB_PATH ? path.resolve(process.env.SQLITE_DB_PATH) : path.join(__dirname, '..', 'database.sqlite'));
    connection.configure('busyTimeout', 10000);
  }
  return new Promise((resolve, reject) => connection.all(sql, values, (error, rows) => error ? reject(error) : resolve({ rows })));
}
async function transaction(work) {
  const execute = async () => {
    const client = postgres ? await database.getClient() : { query: sqliteQuery, release() {} };
    try {
      await client.query(postgres ? 'BEGIN' : 'BEGIN IMMEDIATE');
      const result = await work((sql, params = []) => client.query(sql, params));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  };
  if (postgres) return execute();
  const result = pending.then(execute);
  pending = result.catch(() => {});
  return result;
}
module.exports = { query: database.query, transaction, postgres };
