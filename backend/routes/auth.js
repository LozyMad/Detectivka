const express = require('express');
const { login } = require('../controllers/authController');
const { roomLogin } = require('../controllers/roomAuthController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/login', login);
router.post('/room-login', roomLogin);
router.get('/session', authenticateToken, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(req.roomUser ? { room_user: req.roomUser } : { user: { id: req.user.id, is_admin: req.user.is_admin } });
});

module.exports = router;
