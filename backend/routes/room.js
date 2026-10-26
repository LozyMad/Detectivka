const express = require('express');
const { authenticateToken, adminRequired } = require('../middleware/auth');
const {
  createRoom,
  changeTestRoomScenario,
  enterTestRoom,
  listRooms,
  addRoomUser,
  listRoomUsers,
  removeRoomUser,
  startRoomTimer,
  pauseRoomTimer,
  resumeRoomTimer,
  stopRoomTimer,
  archiveRoom,
  deleteRoom
} = require('../controllers/roomController');

const router = express.Router();

router.use(authenticateToken);
router.use(adminRequired);
router.use(async (req,res,next) => {
  try {
    if (['GET','HEAD'].includes(req.method)) return next();
    let roomId=Number(req.path.split('/')[1]);
    if (req.path.startsWith('/users/')) {
      const row=(await require('../services/playerDatabase').query('SELECT room_id FROM room_users WHERE id=$1',[Number(req.path.split('/')[2])])).rows[0];
      roomId=row?.room_id;
    }
    if(roomId && await require('../services/playerRuntime').cabinet.houses.membership(roomId))return res.status(409).json({error:'Управляйте агентством через его дом'});
    next();
  } catch(error) { next(error); }
});

router.post('/:room_id/invite', (req,res,next)=> {
  require('../services/playerRuntime').cabinet.shared.adminInvite(Number(req.params.room_id),req.user)
    .then(data=>res.json(data)).catch(error=>error.status?res.status(error.status).json({error:error.message}):next(error));
});
router.post('/', createRoom);
router.get('/', listRooms);
router.delete('/:room_id', deleteRoom);
router.patch('/:room_id/archive', archiveRoom);
router.patch('/:room_id/scenario', changeTestRoomScenario);
router.post('/:room_id/test-login', enterTestRoom);
router.post('/:room_id/users', addRoomUser);
router.get('/:room_id/users', listRoomUsers);
router.delete('/users/:user_id', removeRoomUser);
router.post('/:room_id/start', startRoomTimer);
router.post('/:room_id/pause', pauseRoomTimer);
router.post('/:room_id/resume', resumeRoomTimer);
router.post('/:room_id/stop', stopRoomTimer);

module.exports = router;


