process.env.PLAYER_LOCAL_MODE = '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '3001';
process.env.HOST = '127.0.0.1';
require('../backend/server');
