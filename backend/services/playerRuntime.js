const database = require('./playerDatabase');
const {createPlayerCabinet,SESSION_MS} = require('./playerCabinet');
const {syncRoomTimer,remainingSeconds} = require('./roomTimer');
const localMode = process.env.PLAYER_LOCAL_MODE === '1' && process.env.NODE_ENV !== 'production';
const cabinet = createPlayerCabinet({...database,localMode,roomSync:syncRoomTimer,remainingSeconds,findTeams:require('../models/roomUser').findByCredentials});
module.exports = {cabinet,localMode,SESSION_MS};
