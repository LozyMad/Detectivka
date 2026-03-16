const express = require('express');
const multer = require('multer');
const { authenticateToken, superAdminRequired } = require('../middleware/auth');
const backupController = require('../controllers/backupController');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только файлы .xlsx'), false);
    }
  }
});

router.use(authenticateToken);
router.use(superAdminRequired);

router.get('/export', backupController.exportScenarios);
router.post('/import', upload.single('backupFile'), backupController.importScenarios);

module.exports = router;
