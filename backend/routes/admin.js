const express = require('express');
const multer = require('multer');
const Scenario = require('../models/scenario');
const { saveBanner } = require('../services/scenarioBanner');
const { 
  createUser, 
  getUsers,
  deleteUser,
  createScenario, 
  getScenarios,
  updateScenario,
  deleteScenario,
  copyScenario,
  createAddress,
  getAddresses,
  updateAddress,
  deleteAddress,
  setAddressInternetCafe,
  getStatistics
} = require('../controllers/adminController');
const {
  getAddressBookSections,
  getAddressBookEntries,
  getAddressBookEntryById
} = require('../controllers/addressBookController');
const { authenticateToken, adminRequired } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);
router.use(adminRequired);

// User routes
router.post('/users', createUser);
router.get('/users', getUsers);
router.delete('/users/:user_id', deleteUser);

// Scenario routes
router.post('/scenarios', createScenario);
router.post('/scenarios/copy', copyScenario);
router.get('/scenarios', getScenarios);
router.put('/scenarios/:id', updateScenario);
router.delete('/scenarios/:id', deleteScenario);
const bannerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.post('/scenarios/:id/banner', (req, res, next) => {
  bannerUpload.single('banner')(req, res, error => {
    if (error) return res.status(400).json({ error: 'Изображение должно быть не больше 5 МБ' });
    next();
  });
}, async (req, res) => {
  try {
    const scenarioId = Number(req.params.id);
    if (!Number.isSafeInteger(scenarioId) || scenarioId < 1) return res.status(400).json({ error: 'Неверный ID сценария' });
    const available = await Scenario.getAvailableForAdmin(req.user.id, req.user.admin_level);
    if (!available.some(scenario => Number(scenario.id) === scenarioId)) return res.status(403).json({ error: 'Нет доступа к сценарию' });
    if (!req.file) return res.status(400).json({ error: 'Выберите изображение' });
    await saveBanner(scenarioId, req.file.buffer);
    res.json({ banner_url: `/api/scenarios/${scenarioId}/banner` });
  } catch (error) {
    if (error.message.startsWith('Supported image')) return res.status(400).json({ error: 'Поддерживаются JPG, PNG и WEBP' });
    console.error('Upload scenario banner error:', error);
    res.status(500).json({ error: 'Не удалось сохранить изображение' });
  }
});
router.get('/statistics/:scenario_id', getStatistics);

// Address routes
router.post('/addresses', createAddress);
router.get('/addresses/:scenario_id', getAddresses);
router.put('/addresses/:scenario_id/:id', updateAddress);
router.patch('/addresses/:scenario_id/:id/internet-cafe', setAddressInternetCafe);
router.delete('/addresses/:scenario_id/:id', deleteAddress);

// Address book routes (просмотр доступен любому администратору)
router.get('/address-book/sections', getAddressBookSections);
router.get('/address-book/entries', getAddressBookEntries);
router.get('/address-book/entries/:id', getAddressBookEntryById);

module.exports = router;
