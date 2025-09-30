const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'backend', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('Проверяем уровень админа в базе данных...');

db.get('SELECT id, username, admin_level FROM users WHERE username = ?', ['admin'], (err, row) => {
  if (err) {
    console.error('Ошибка:', err);
  } else if (row) {
    console.log('Найден пользователь admin:');
    console.log('ID:', row.id);
    console.log('Username:', row.username);
    console.log('Admin Level:', row.admin_level);
    
    if (row.admin_level !== 'super_admin') {
      console.log('\n❌ ПРОБЛЕМА: admin_level не равен "super_admin"');
      console.log('Исправляем...');
      
      db.run('UPDATE users SET admin_level = ? WHERE username = ?', ['super_admin', 'admin'], function(err) {
        if (err) {
          console.error('Ошибка обновления:', err);
        } else {
          console.log('✅ Исправлено! admin_level установлен в "super_admin"');
        }
        db.close();
      });
    } else {
      console.log('✅ admin_level корректный');
      db.close();
    }
  } else {
    console.log('❌ Пользователь admin не найден!');
    db.close();
  }
});
