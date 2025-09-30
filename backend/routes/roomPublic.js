const express = require('express');
const { getRoomState } = require('../controllers/roomPublicController');

const router = express.Router();

router.get('/:room_id/state', getRoomState);

module.exports = router;




