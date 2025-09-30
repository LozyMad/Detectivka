const express = require('express');
const { authenticateToken, adminRequired } = require('../middleware/auth');
const {
  createRoom,
  listRooms,
  addRoomUser,
  listRoomUsers,
  removeRoomUser,
  startRoomTimer,
  pauseRoomTimer,
  resumeRoomTimer,
  stopRoomTimer,
  deleteRoom
} = require('../controllers/roomController');

const router = express.Router();

router.use(authenticateToken);
router.use(adminRequired);

router.post('/', createRoom);
router.get('/', listRooms);
router.delete('/:room_id', deleteRoom);
router.post('/:room_id/users', addRoomUser);
router.get('/:room_id/users', listRoomUsers);
router.delete('/users/:user_id', removeRoomUser);
router.post('/:room_id/start', startRoomTimer);
router.post('/:room_id/pause', pauseRoomTimer);
router.post('/:room_id/resume', resumeRoomTimer);
router.post('/:room_id/stop', stopRoomTimer);

module.exports = router;


