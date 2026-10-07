const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { roomSessionFixture } = require('./room-session-fixture.cjs');

function briefingFixture() {
  const base = roomSessionFixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detectum-briefing-'));
  function load(file, dependencies, dirname) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, Buffer, console, __dirname: dirname,
      process: { env: { DB_TYPE: 'sqlite' } }, require: name => dependencies[name] || require(name)
    }, { filename: file });
    return module.exports;
  }
  const applications = load('backend/services/scenarioApplications.js', {}, path.join(root, 'services'));
  let addressLookups = 0;
  const visits = [];
  base.rooms.set(14, { id: 14, name: 'Проверка брифинга', scenario_id: 12, state: 'running', remaining: 7200 });
  base.rooms.set(16, { id: 16, name: 'Другое дело', scenario_id: 13, state: 'running' });
  const router = load('backend/routes/applications.js', {
    express: require('../../backend/node_modules/express'), multer: require('../../backend/node_modules/multer'),
    '../models/scenario': { getAvailableForAdmin: async () => [{ id: 12 }] },
    '../models/address': { getById: async (scenario, address) => { addressLookups++;
      return Number(scenario) === 12 && Number(address) === 50 ? { district: 'Ц', house_number: '31' } : null; } },
    '../models/room': base.Room,
    '../config/database': { db: {
      all(sql, values, callback) { callback(null, visits.map(address_id => ({ address_id }))); },
      get(sql, values, callback) { callback(null, visits.includes(Number(values[3])) ? { visited: 1 } : null); }
    } },
    '../services/scenarioApplications': applications,
    '../services/imagePreview': { previewWidth: () => 2400, imagePreview: async file => ({ path: file, type: 'image/png' }) },
    '../middleware/auth': { authenticateToken: base.authenticateToken }
  });
  base.app.use('/api/applications', router);
  base.app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: 'Fixture error' }); });
  const token = payload => base.jwt.sign(payload, base.secret, { expiresIn: '1h' });
  return { ...base, root, applications, visits, get addressLookups() { return addressLookups; },
    adminToken: token({ id: 99 }), playerToken: token({ room_user_id: 15, room_id: 14 }),
    otherPlayerToken: token({ room_user_id: 17, room_id: 16 }),
    cleanup: () => fs.promises.rm(root, { recursive: true, force: true }) };
}
module.exports = { briefingFixture };
