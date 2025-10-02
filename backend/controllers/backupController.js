const fs = require('fs').promises;
const path = require('path');
// Определяем тип базы данных
const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let db, query;
if (DB_TYPE === 'postgresql') {
  const pgConfig = require('../config/database');
  db = pgConfig.db;
  query = pgConfig.query;
} else {
  const sqliteConfig = require('../config/database');
  db = sqliteConfig.db;
}
const Scenario = require('../models/scenario');
const Question = require('../models/question');
const Address = require('../models/address');

const backupController = {
  // Экспорт всех сценариев в JSON
  exportScenarios: async (req, res) => {
    try {
      console.log('Starting scenarios export...');
      
      // Получаем все сценарии
      let scenarios;
      if (DB_TYPE === 'postgresql') {
        const result = await query('SELECT * FROM scenarios ORDER BY id');
        scenarios = result.rows;
      } else {
        scenarios = await new Promise((resolve, reject) => {
          db.all('SELECT * FROM scenarios ORDER BY id', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });
      }

      console.log(`Found ${scenarios.length} scenarios`);

      // Для каждого сценария получаем связанные данные
      const exportData = {
        export_date: new Date().toISOString(),
        version: '1.0',
        scenarios: []
      };

      for (const scenario of scenarios) {
        console.log(`Processing scenario: ${scenario.name} (ID: ${scenario.id})`);
        
        // Получаем вопросы для сценария
        let questions;
        if (DB_TYPE === 'postgresql') {
          const result = await query('SELECT * FROM questions WHERE scenario_id = $1 ORDER BY id', [scenario.id]);
          questions = result.rows;
        } else {
          questions = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM questions WHERE scenario_id = ? ORDER BY id', [scenario.id], (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });
        }

        // Получаем адреса для сценария
        let addresses;
        if (DB_TYPE === 'postgresql') {
          const result = await query('SELECT * FROM addresses WHERE scenario_id = $1 ORDER BY id', [scenario.id]);
          addresses = result.rows;
        } else {
          addresses = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM addresses WHERE scenario_id = ? ORDER BY id', [scenario.id], (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });
        }

        // Получаем разрешения для сценария
        let permissions;
        if (DB_TYPE === 'postgresql') {
          const result = await query('SELECT * FROM admin_permissions WHERE scenario_id = $1', [scenario.id]);
          permissions = result.rows;
        } else {
          permissions = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM admin_scenario_permissions WHERE scenario_id = ?', [scenario.id], (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });
        }

        exportData.scenarios.push({
          scenario: scenario,
          questions: questions,
          addresses: addresses,
          permissions: permissions
        });
      }

      // Создаем имя файла с датой
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `scenarios_export_${timestamp}.json`;
      const filepath = path.join(__dirname, '../../backups/scenarios', filename);

      // Сохраняем файл
      await fs.writeFile(filepath, JSON.stringify(exportData, null, 2), 'utf8');
      
      // Также сохраняем как latest.json
      const latestPath = path.join(__dirname, '../../backups/scenarios', 'latest.json');
      await fs.writeFile(latestPath, JSON.stringify(exportData, null, 2), 'utf8');

      console.log(`Export completed: ${filename}`);
      
      if (res.json && typeof res.json === 'function') {
        res.json({
          success: true,
          message: 'Сценарии успешно экспортированы',
          filename: filename,
          scenarios_count: scenarios.length,
          export_date: exportData.export_date
        });
      }

    } catch (error) {
      console.error('Export error:', error);
      if (res.status && typeof res.status === 'function') {
        res.status(500).json({
          success: false,
          error: 'Ошибка экспорта сценариев',
          details: error.message
        });
      }
      throw error; // Пробрасываем ошибку для автоэкспорта
    }
  },

  // Импорт сценариев из JSON
  importScenarios: async (req, res) => {
    try {
      console.log('Starting scenarios import...');
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Файл не загружен'
        });
      }

      // Читаем содержимое файла
      const fileContent = req.file.buffer.toString('utf8');
      const importData = JSON.parse(fileContent);

      // Проверяем структуру файла
      if (!importData.scenarios || !Array.isArray(importData.scenarios)) {
        return res.status(400).json({
          success: false,
          error: 'Неверный формат файла'
        });
      }

      console.log(`Importing ${importData.scenarios.length} scenarios`);

      let importedCount = 0;
      let skippedCount = 0;

      for (const scenarioData of importData.scenarios) {
        const { scenario, questions, addresses, permissions } = scenarioData;

        try {
          // Проверяем, существует ли сценарий с таким именем
          const existingScenario = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM scenarios WHERE name = ?', [scenario.name], (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          });

          if (existingScenario) {
            console.log(`Scenario "${scenario.name}" already exists, skipping...`);
            skippedCount++;
            continue;
          }

          // Создаем сценарий
          const newScenario = await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO scenarios (name, description, is_active, created_by) VALUES (?, ?, ?, ?)',
              [scenario.name, scenario.description, false, req.user.id], // is_active = false для безопасности
              function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, ...scenario });
              }
            );
          });

          console.log(`Created scenario: ${scenario.name} (ID: ${newScenario.id})`);

          // Импортируем вопросы
          for (const question of questions) {
            await new Promise((resolve, reject) => {
              db.run(
                'INSERT INTO questions (scenario_id, question_text, answer_type) VALUES (?, ?, ?)',
                [newScenario.id, question.question_text, question.answer_type],
                function(err) {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }

          // Импортируем адреса
          for (const address of addresses) {
            await new Promise((resolve, reject) => {
              db.run(
                'INSERT INTO addresses (scenario_id, district, house_number, description) VALUES (?, ?, ?, ?)',
                [newScenario.id, address.district, address.house_number, address.description],
                function(err) {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }

          // Импортируем разрешения (если есть)
          for (const permission of permissions) {
            await new Promise((resolve, reject) => {
              db.run(
                'INSERT INTO admin_scenario_permissions (admin_id, scenario_id) VALUES (?, ?)',
                [permission.admin_id, newScenario.id],
                function(err) {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }

          importedCount++;

        } catch (scenarioError) {
          console.error(`Error importing scenario "${scenario.name}":`, scenarioError);
          // Продолжаем импорт других сценариев
        }
      }

      console.log(`Import completed: ${importedCount} imported, ${skippedCount} skipped`);

      res.json({
        success: true,
        message: 'Импорт сценариев завершен',
        imported_count: importedCount,
        skipped_count: skippedCount,
        total_processed: importData.scenarios.length
      });

    } catch (error) {
      console.error('Import error:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка импорта сценариев',
        details: error.message
      });
    }
  },

  // Получить список доступных бэкапов
  getBackupList: async (req, res) => {
    try {
      const backupDir = path.join(__dirname, '../backups/scenarios');
      console.log('Backup directory:', backupDir);
      
      try {
        const files = await fs.readdir(backupDir);
        console.log('Found files:', files);
        
        const backupFiles = await Promise.all(
          files
            .filter(file => file.endsWith('.json') && file !== 'latest.json')
            .map(async (file) => {
              const filePath = path.join(backupDir, file);
              const stats = await fs.stat(filePath);
              console.log(`File ${file}: size=${stats.size}, created=${stats.birthtime}`);
              return {
                filename: file,
                size: stats.size,
                created: stats.birthtime
              };
            })
        );

        backupFiles.sort((a, b) => new Date(b.created) - new Date(a.created));
        console.log('Final backup files:', backupFiles);

        res.json({
          success: true,
          backups: backupFiles
        });
      } catch (dirError) {
        console.log('Directory error:', dirError);
        // Папка не существует
        res.json({
          success: true,
          backups: []
        });
      }

    } catch (error) {
      console.error('Get backup list error:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка получения списка бэкапов'
      });
    }
  },

  // Скачать бэкап
  downloadBackup: async (req, res) => {
    try {
      const { filename } = req.params;
      const { token } = req.query;
      
      // Проверяем токен из query параметра
      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Токен авторизации не предоставлен'
        });
      }
      
      // Проверяем безопасность имени файла
      if (!filename || filename.includes('..') || !filename.endsWith('.json')) {
        return res.status(400).json({
          success: false,
          error: 'Неверное имя файла'
        });
      }

      const backupDir = path.join(__dirname, '../backups/scenarios');
      const filePath = path.join(backupDir, filename);

      try {
        // Проверяем, что файл существует
        await fs.access(filePath);
        
        // Отправляем файл
        res.download(filePath, filename);
      } catch (fileError) {
        res.status(404).json({
          success: false,
          error: 'Файл не найден'
        });
      }

    } catch (error) {
      console.error('Download backup error:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка скачивания бэкапа'
      });
    }
  },

  // Удалить бэкап
  deleteBackup: async (req, res) => {
    try {
      const { filename } = req.params;
      
      // Проверяем безопасность имени файла
      if (!filename || filename.includes('..') || !filename.endsWith('.json')) {
        return res.status(400).json({
          success: false,
          error: 'Неверное имя файла'
        });
      }

      const backupDir = path.join(__dirname, '../backups/scenarios');
      const filePath = path.join(backupDir, filename);

      try {
        // Проверяем, что файл существует
        await fs.access(filePath);
        
        // Удаляем файл
        await fs.unlink(filePath);
        
        res.json({
          success: true,
          message: 'Бэкап успешно удален'
        });
      } catch (fileError) {
        res.status(404).json({
          success: false,
          error: 'Файл не найден'
        });
      }

    } catch (error) {
      console.error('Delete backup error:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка удаления бэкапа'
      });
    }
  }
};

module.exports = backupController;
