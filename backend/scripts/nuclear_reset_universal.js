// Универсальный скрипт для ядерного сброса
// Автоматически определяет тип базы данных (SQLite или PostgreSQL)

const DB_TYPE = process.env.DB_TYPE || (process.env.DATABASE_URL ? 'postgresql' : 'sqlite');

console.log(`🔍 Обнаружен тип базы данных: ${DB_TYPE.toUpperCase()}`);

if (DB_TYPE === 'postgresql') {
    console.log('🔄 Запускаем ядерный сброс для PostgreSQL...');
    const { nuclearResetPostgreSQL } = require('./nuclear_reset_postgresql');
    nuclearResetPostgreSQL().catch(console.error);
} else {
    console.log('🔄 Запускаем ядерный сброс для SQLite...');
    const { nuclearReset } = require('./nuclear_reset');
    nuclearReset().catch(console.error);
}
