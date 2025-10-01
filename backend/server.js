const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

console.log('__dirname:', __dirname);
console.log('Static files path:', path.join(__dirname, '../frontend'));

// Check if frontend directory exists
const frontendPath = path.join(__dirname, '../frontend');
const cssPath = path.join(frontendPath, 'css');
const styleCssPath = path.join(cssPath, 'style.css');

console.log('Frontend directory exists:', fs.existsSync(frontendPath));
console.log('CSS directory exists:', fs.existsSync(cssPath));
console.log('style.css exists:', fs.existsSync(styleCssPath));

if (fs.existsSync(frontendPath)) {
  console.log('Frontend directory contents:', fs.readdirSync(frontendPath));
}
if (fs.existsSync(cssPath)) {
  console.log('CSS directory contents:', fs.readdirSync(cssPath));
}

const database = require('./config/database');

const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const adminRoutes = require('./routes/admin');
const superAdminRoutes = require('./routes/superAdmin');
const roomRoutes = require('./routes/room');
const roomPublicRoutes = require('./routes/roomPublic');
const scenarioRoutes = require('./routes/scenarios');
const questionRoutes = require('./routes/questions');
const backupRoutes = require('./routes/backup');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Serve static files from frontend directory with proper MIME types
const staticPath = path.join(__dirname, '../frontend');
console.log('Setting up static files from:', staticPath);

app.use(express.static(staticPath, {
  setHeaders: (res, filePath) => {
    console.log('Serving static file:', filePath);
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
      console.log('Set CSS Content-Type for:', filePath);
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
      console.log('Set JS Content-Type for:', filePath);
    }
  }
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/room', roomPublicRoutes);
app.use('/api/scenarios', scenarioRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/backup', backupRoutes);

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-login.html'));
});

app.get('/game-login', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/game-login.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/game.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});


// Initialize database and start server
database.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
});