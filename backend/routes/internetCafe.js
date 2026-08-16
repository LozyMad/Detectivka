const express = require('express');
const router = express.Router();
const internetCafeController = require('../controllers/internetCafeController');
const { authenticateToken } = require('../middleware/auth');

// ===== АДМИН =====
router.get(
  '/admin/scenarios/:scenario_id/pages',
  authenticateToken,
  internetCafeController.getAdminPages
);

router.post(
  '/admin/scenarios/:scenario_id/pages',
  authenticateToken,
  internetCafeController.createAdminPage
);

router.put(
  '/admin/scenarios/:scenario_id/pages/:page_id',
  authenticateToken,
  internetCafeController.updateAdminPage
);

router.delete(
  '/admin/scenarios/:scenario_id/pages/:page_id',
  authenticateToken,
  internetCafeController.deleteAdminPage
);

// ===== ИГРОК =====
// Статический путь /pages/:pageId должен быть раньше /:addressId/pages
router.get(
  '/game/pages/:pageId',
  authenticateToken,
  internetCafeController.getCafePageContent
);

router.get(
  '/game/:addressId/pages',
  authenticateToken,
  internetCafeController.getCafePages
);

module.exports = router;
