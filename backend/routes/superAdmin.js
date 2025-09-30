const express = require('express');
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

const router = express.Router();

// Все маршруты требуют аутентификации и супер-админских прав
router.use(authenticateToken);
router.use(superAdminRequired);

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

module.exports = router;

