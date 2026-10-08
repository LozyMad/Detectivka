const express = require('express');
const multer = require('multer');
const { authenticateToken, superAdminRequired } = require('../middleware/auth');
const backupController = require('../controllers/backupController');
const { MAX_BYTES, MAX_FILES } = require('../services/scenarioPackage');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xls|zip)$/i.test(file.originalname || '')) cb(null, true);
    else cb(new Error('Разрешены ZIP-пакеты и файлы Excel (.xlsx, .xls)'));
  }
});
const folderUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: MAX_FILES, fields: 1, fieldSize: 2 * 1024 * 1024 }
});
function receive(middleware) {
  return (req, res, next) => {
    const length = Number(req.headers['content-length']);
    if (length > MAX_BYTES + 10 * 1024 * 1024) return res.status(413).json({ success: false, error: 'Пакет сценария не должен превышать 250 МБ' });
    middleware(req, res, error => {
      if (error) return res.status(400).json({ success: false, error: error instanceof multer.MulterError ? 'Превышены ограничения загрузки (250 МБ на пакет, до 10000 файлов)' : error.message });
      next();
    });
  };
}
router.use(authenticateToken);
router.use(superAdminRequired);
router.get('/export', backupController.exportScenarios);
router.post('/import', receive(upload.single('backupFile')), backupController.importScenarios);
router.post('/import-folder', receive(folderUpload.array('files', MAX_FILES)), backupController.importFolder);
module.exports = router;
