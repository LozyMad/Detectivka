require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const database = require('./config/database');

// --- Глобальная обработка ошибок (чтобы процесс не падал молча) ---
process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException:', err);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRASH] unhandledRejection at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

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
const internetCafeRoutes = require('./routes/internetCafe');
const applicationRoutes = require('./routes/applications');
const enquiryRoutes = require('./routes/enquiries');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

// Вебхук автодеплоя — до bodyParser, чтобы для GitHub иметь raw body
const DEPLOY_SECRET = process.env.DEPLOY_SECRET;
const projectRoot = path.join(__dirname, '..');
function runDeploy(res) {
  exec(`cd "${projectRoot}" && git pull origin main`, (err, stdout, stderr) => {
    if (err) {
      console.error('[Deploy]', err, stderr);
      return res.status(500).json({ ok: false, error: stderr || err.message, log: stdout });
    }
    console.log('[Deploy] git pull OK', stdout);
    // Устанавливаем зависимости (в т.ч. новые, например xlsx)
    const backendDir = path.join(projectRoot, 'backend');
    exec(`cd "${backendDir}" && npm install --omit=dev --include=optional`, (errInstall, outInstall, errOutInstall) => {
      if (errInstall) {
        console.error('[Deploy] npm install error', errInstall, errOutInstall);
        return res.status(500).json({ ok: false, error: 'Dependency installation failed; application was not restarted', log: errOutInstall || outInstall });
      }
      console.log('[Deploy] npm install OK', outInstall);
      res.json({ ok: true, log: stdout });
      setTimeout(() => {
        exec(`pm2 restart detectivka`, (e, out, errOut) => {
          if (e) console.error('[Deploy] pm2 restart error', e, errOut);
          else console.log('[Deploy] pm2 restart OK', out);
        });
      }, 2000);
    });
  });
}
app.post('/api/deploy', express.raw({ type: 'application/json' }), (req, res) => {
  if (!DEPLOY_SECRET) {
    return res.status(501).json({ ok: false, error: 'Deploy not configured' });
  }
  const handleAuthorizedDeploy = () => {
    let body = {};
    try { body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8') || '{}') : (req.body || {}); }
    catch (_) { return res.status(400).json({ error: 'Invalid deployment request' }); }
    if (body.verifyOnly === true) {
      return require('./services/addressBookRevision').getAddressBookStatus()
        .then(status => res.status(status.ready ? 200 : 503).json({ ok: status.ready, address_book: status }))
        .catch(error => { console.error('[Deploy] verification:', error); res.status(503).json({ ok: false, error: 'Deployment verification failed' }); });
    }
    return runDeploy(res);
  };
  const sig = req.headers['x-hub-signature-256'];
  if (sig && req.body && Buffer.isBuffer(req.body)) {
    const hmac = crypto.createHmac('sha256', DEPLOY_SECRET).update(req.body).digest('hex');
    if (hmac === sig.replace('sha256=', '')) {
      return handleAuthorizedDeploy();
    }
  }
  const raw = req.headers['x-deploy-secret'] || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const secret = (raw && String(raw).trim()) || '';
  const expected = (DEPLOY_SECRET && String(DEPLOY_SECRET).trim()) || '';
  if (secret && expected && secret === expected) {
    return handleAuthorizedDeploy();
  }
  // Диагностика без раскрытия секрета: длины помогают понять лишний символ (например 49 vs 48)
  console.log('[Deploy] 403: received length=', secret.length, 'expected length=', expected.length);
  res.status(403).json({
    ok: false,
    error: 'Invalid secret',
    hint: expected ? `expected_length=${expected.length}, received_length=${secret.length}` : 'DEPLOY_SECRET not set on server'
  });
});

app.use(bodyParser.json());

// Логирование запросов (для диагностики)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// Redirect old HTML page URLs to their readable routes before static files are served.
const pageUrls = {
  '/index.html': '/',
  '/landing.html': '/',
  '/landing': '/',
  '/landing/': '/',
  '/corporate.html': '/corporate',
  '/corporate/': '/corporate',
  '/korporativ': '/corporate',
  '/korporativ/': '/corporate',
  '/enter.html': '/login',
  '/enter': '/login',
  '/enter/': '/login',
  '/login.html': '/login',
  '/login/': '/login',
  '/game-login.html': '/game-login',
  '/admin-login.html': '/admin-login',
  '/game.html': '/game',
  '/admin.html': '/admin'
};

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const destination = pageUrls[req.path];
  if (!destination) return next();
  const queryIndex = req.originalUrl.indexOf('?');
  const query = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex);
  res.redirect(301, destination + query);
});

// Serve the landing page explicitly so restored HTML is not cached as the old home.
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Serve static files from frontend directory with proper MIME types
app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders: (res, filePath) => {
    if (/\.(?:webp|png|jpe?g|svg|gif|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
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
app.use('/api/enquiries', enquiryRoutes.publicRouter);
app.use('/api/admin/enquiries', enquiryRoutes.adminRouter);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/questions', questionRoutes); // Админские вопросы
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/room', roomPublicRoutes);
app.use('/api/scenarios', scenarioRoutes);
app.use('/api/questions', questionRoutes); // Публичные вопросы
app.use('/api/backup', backupRoutes);
app.use('/api/choices', choiceRoutes);
app.use('/api/internet-cafe', internetCafeRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/nuclear', nuclearRoutes);

// Serve frontend
app.get('/corporate', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/corporate.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/enter.html'));
});

app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin-login.html'));
});

app.get('/game-login', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/game-login.html'));
});

app.get('/game', (req, res) => {
  // Load the current stylesheet/controller revisions after each deployment.
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../frontend/game.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

// Централизованная обработка ошибок маршрутов (любая ошибка из роутов попадёт сюда)
app.use((err, req, res, next) => {
  console.error('[Express error]', err);
  console.error(err.stack);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialize database and start server
database.init().then(async () => {
  await require('./services/addressBookRevision').updateAddressBook();
  // РАДИКАЛЬНАЯ инициализация вариантов выбора для ВСЕХ адресов
  try {
    const { initializeAllChoices } = require('./scripts/init_all_choices');
    await initializeAllChoices();
  } catch (error) {
    console.error('Failed to initialize all choices:', error);
  }
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
});
