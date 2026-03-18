const express = require('express');
const multer = require('multer');
const { authenticateToken, superAdminRequired } = require('../middleware/auth');
const {
  createAdmin,
  getAdmins,
  createScenario,
  grantScenarioPermission,
  revokeScenarioPermission,
  getAllPermissions,
  getAdminPermissions,
  getScenarioPermissions
} = require('../controllers/superAdminController');
const {
  createAddressBookEntry,
  updateAddressBookEntry,
  deleteAddressBookEntry,
  uploadAddressBookXlsx
} = require('../controllers/addressBookController');

const router = express.Router();

// Все маршруты требуют аутентификации и супер-админских прав
router.use(authenticateToken);
router.use(superAdminRequired);

const uploadAddressBook = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      return cb(null, true);
    }
    return cb(new Error('Разрешены только файлы .xlsx'), false);
  }
});

// Управление админами
router.post('/admins', createAdmin);
router.get('/admins', getAdmins);

// Управление сценариями
router.post('/scenarios', createScenario);

// Управление разрешениями
router.post('/permissions/grant', grantScenarioPermission);
router.post('/permissions/revoke', revokeScenarioPermission);
router.get('/permissions', getAllPermissions);
router.get('/permissions/admin/:admin_id', getAdminPermissions);
router.get('/permissions/scenario/:scenario_id', getScenarioPermissions);

// Адресная книга: редактирование доступно только супер-админу
router.post('/address-book/entries', createAddressBookEntry);
router.put('/address-book/entries/:id', updateAddressBookEntry);
router.delete('/address-book/entries/:id', deleteAddressBookEntry);

// Загрузка XLSX адресной книги (чтобы работало даже если файла нет на сервере)
router.post('/address-book/upload', uploadAddressBook.single('addressBookFile'), uploadAddressBookXlsx);

module.exports = router;


