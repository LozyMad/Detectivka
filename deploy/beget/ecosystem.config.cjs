const path = require('path');

module.exports = {
  apps: [{
    name: 'detectivka',
    cwd: path.resolve(__dirname, '../..'),
    script: 'backend/server.js',
    // SSE subscriptions are held in memory; keep one process.
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    restart_delay: 3000,
    time: true,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }],
};
