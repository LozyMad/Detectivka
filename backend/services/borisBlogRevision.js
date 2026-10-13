
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REVISION = 'boris-leschik-1999-v1';
const OLD_HTML_HASH = '6b09831c6704bc008c69256655a7711069ed9d98d76d4b3c3a1a4fb50323a9ad';
const TEMPLATE_PATH = path.join(__dirname, '../../frontend/internet/boris-leschik-1999.html');
const hashHtml = html => crypto.createHash('sha256').update(String(html).replace(/\r\n/g, '\n').trim()).digest('hex');

async function applyRevision({ client, dialect = 'sqlite', scenarioId, html = fs.readFileSync(TEMPLATE_PATH, 'utf8') }) {
  if (!Number.isSafeInteger(Number(scenarioId)) || Number(scenarioId) < 1) throw new Error('Invalid scenario ID');
  const prefix = dialect === 'postgresql' ? 'scenario_' + Number(scenarioId) + '.' : '';
  const p = n => dialect === 'postgresql' ? '$' + n : '?';
  await client.query('CREATE TABLE IF NOT EXISTS ' + prefix + 'internet_page_revisions (' +
    'revision TEXT NOT NULL, page_id INTEGER NOT NULL, previous_page_json TEXT NOT NULL, ' +
    'applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (revision, page_id))');
  await client.query(dialect === 'postgresql' ? 'BEGIN' : 'BEGIN IMMEDIATE');
  try {
    const pages = (await client.query('SELECT p.* FROM ' + prefix + 'internet_pages p JOIN ' + prefix +
      'addresses ca ON ca.id = p.cafe_address_id WHERE ca.district = ' + p(1) +
      ' AND ca.house_number = ' + p(2) + ' AND ca.apartment = ' + p(3) +
      ' AND ca.is_internet_cafe = ' + p(4) + (dialect === 'postgresql' ? ' FOR UPDATE OF p' : ''),
      ['Ц', '38', '', dialect === 'postgresql' ? true : 1])).rows;
    let updated = 0;
    for (const page of pages) {
      // Only replace the shipped old template; keep any administrator's custom content.
      if (hashHtml(page.content_html) !== OLD_HTML_HASH) continue;
      const applied = (await client.query('SELECT page_id FROM ' + prefix +
        'internet_page_revisions WHERE revision = ' + p(1) + ' AND page_id = ' + p(2),
        [REVISION, page.id])).rows;
      if (applied.length) continue;
      await client.query('INSERT INTO ' + prefix + 'internet_page_revisions (revision, page_id, previous_page_json) ' +
        'VALUES (' + p(1) + ', ' + p(2) + ', ' + p(3) + ')', [REVISION, page.id, JSON.stringify(page)]);
      await client.query('UPDATE ' + prefix + 'internet_pages SET title = ' + p(1) +
        ', content_html = ' + p(2) + ', updated_at = CURRENT_TIMESTAMP WHERE id = ' + p(3),
        ['Блог Бориса Лещика', html, page.id]);
      updated++;
    }
    await client.query('COMMIT');
    return { revision: REVISION, scenarioId: Number(scenarioId), updated };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function updateDefaultBorisBlogs() {
  const scenarios = await require('../models/scenario').getAll();
  const dialect = process.env.DB_TYPE || 'sqlite';
  const results = [];
  for (const scenario of scenarios) {
    if (String(scenario.name).trim().toLocaleLowerCase('ru') !== 'ставка на молчание') continue;
    if (dialect === 'postgresql') {
      const { getScenarioDb, ensureTables } = require('../config/scenarioPostgreSQL');
      await ensureTables(scenario.id);
      const client = await getScenarioDb(scenario.id).connect();
      try { results.push(await applyRevision({ client, dialect, scenarioId: scenario.id })); }
      finally { client.release(); }
    } else {
      const db = require('../config/scenarioDatabase').getScenarioDb(scenario.id);
      const client = { query: (sql, params = []) => new Promise((resolve, reject) =>
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve({ rows }))) };
      results.push(await applyRevision({ client, dialect, scenarioId: scenario.id }));
    }
  }
  console.log('[BorisBlog] Revision:', results);
  return results;
}

module.exports = { applyRevision, updateDefaultBorisBlogs, hashHtml, OLD_HTML_HASH };
