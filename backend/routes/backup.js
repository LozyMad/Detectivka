const express = require('express');
const multer = require('multer');
const { authenticateToken, superAdminRequired } = require('../middleware/auth');
const backupController = require('../controllers/backupController');

const router = express.Router();

// Настройка multer для загрузки файлов
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB лимит
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Только JSON файлы разрешены'), false);
    }
  }
});

// Все маршруты требуют авторизации и права супер-админа
router.use(authenticateToken);
router.use(superAdminRequired);

// Экспорт сценариев
router.get('/export', backupController.exportScenarios);

// Импорт сценариев
router.post('/import', upload.single('backupFile'), backupController.importScenarios);

// Получить список бэкапов
router.get('/list', backupController.getBackupList);

module.exports = router;
