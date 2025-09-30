const express = require('express');
const { login } = require('../controllers/authController');
const { roomLogin } = require('../controllers/roomAuthController');

const router = express.Router();

router.post('/login', login);
router.post('/room-login', roomLogin);

module.exports = router;