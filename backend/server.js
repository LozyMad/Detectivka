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
const choiceRoutes = require('./routes/choices');
const nuclearRoutes = require('./routes/nuclear');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Serve static files from frontend directory with proper MIME types
app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/questions', questionRoutes); // Админские вопросы
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/room', roomPublicRoutes);
app.use('/api/scenarios', scenarioRoutes);
app.use('/api/questions', questionRoutes); // Публичные вопросы
app.use('/api/backup', backupRoutes);
app.use('/api/choices', choiceRoutes);
app.use('/api/nuclear', nuclearRoutes);

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
database.init().then(async () => {
  // РАДИКАЛЬНАЯ инициализация вариантов выбора для ВСЕХ адресов
  try {
    const { initializeAllChoices } = require('./scripts/init_all_choices');
    await initializeAllChoices();
  } catch (error) {
    console.error('Failed to initialize all choices:', error);
  }
  
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
});