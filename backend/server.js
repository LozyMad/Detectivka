const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
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

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/css', express.static(path.join(__dirname, '../frontend/css')));
app.use('/js', express.static(path.join(__dirname, '../frontend/js')));

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

// Explicit CSS route for Railway
app.get('/css/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/css/style.css'));
});

// Explicit JS routes for Railway
app.get('/js/:filename', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/js', req.params.filename));
});

// Initialize database and start server
database.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
});