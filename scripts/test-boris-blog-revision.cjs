
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const sqlite3 = createRequire(path.resolve('backend/package.json'))('sqlite3');
const { applyRevision } = require('../backend/services/borisBlogRevision');
const oldHtml = fs.readFileSync(path.join(__dirname, 'fixtures/boris-blog-legacy.html'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../frontend/internet/boris-leschik-1999.html'), 'utf8');

async function fixture(t) {
  const db = new sqlite3.Database(':memory:');
  t.after(() => new Promise(resolve => db.close(resolve)));
  const client = { query: (sql, params = []) => new Promise((resolve, reject) =>
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve({ rows }))) };
  await client.query('CREATE TABLE addresses (id INTEGER PRIMARY KEY, district TEXT, house_number TEXT, apartment TEXT, is_internet_cafe INTEGER)');
  await client.query('CREATE TABLE internet_pages (id INTEGER PRIMARY KEY, title TEXT, content_html TEXT, cafe_address_id INTEGER, unlock_address_id INTEGER, page_order INTEGER, is_active INTEGER, updated_at TEXT)');
  await client.query("INSERT INTO addresses VALUES (20, 'Ц', '38', '', 1), (21, 'Ц', '39', '', 1)");
  for (const [id, cafe, content] of [[1,20,oldHtml],[2,20,'<p>Авторская страница</p>'],[3,21,oldHtml]]) {
    await client.query('INSERT INTO internet_pages VALUES (?, ?, ?, ?, ?, 3, 1, ?)',
      [id,'Блог Бориса Лещика',content,cafe,cafe,'old-date']);
  }
  return client;
}

test('updates only the shipped blog at Ц 38; preserves access, IDs and other pages; backs up the original', async t => {
  const client = await fixture(t);
  const before = (await client.query('SELECT * FROM internet_pages ORDER BY id')).rows;
  const result = await applyRevision({client,scenarioId:7});
  assert.equal(result.updated,1);
  const after = (await client.query('SELECT * FROM internet_pages ORDER BY id')).rows;
  assert.equal(after[0].content_html,html);
  for (const key of ['id','cafe_address_id','unlock_address_id','page_order','is_active']) assert.equal(after[0][key],before[0][key]);
  assert.deepEqual(after.slice(1),before.slice(1));
  const backup = (await client.query('SELECT * FROM internet_page_revisions')).rows;
  assert.equal(backup.length,1);
  assert.deepEqual(JSON.parse(backup[0].previous_page_json),before[0]);
});

test('does not overwrite later administrator edits or repeat a migration', async t => {
  const client = await fixture(t);
  await applyRevision({client,scenarioId:7});
  await client.query('UPDATE internet_pages SET content_html = ? WHERE id = 1',['<p>Правка автора</p>']);
  assert.equal((await applyRevision({client,scenarioId:7})).updated,0);
  assert.equal((await client.query('SELECT content_html FROM internet_pages WHERE id = 1')).rows[0].content_html,'<p>Правка автора</p>');
  await client.query('UPDATE internet_pages SET content_html = ? WHERE id = 1',[oldHtml]);
  assert.equal((await applyRevision({client,scenarioId:7})).updated,0);
});

test('rolls back both the backup and page update when writing fails', async t => {
  const client = await fixture(t);
  await client.query("CREATE TRIGGER reject_blog_update BEFORE UPDATE ON internet_pages BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  await assert.rejects(applyRevision({client,scenarioId:7}),/fixture failure/);
  assert.equal((await client.query('SELECT content_html FROM internet_pages WHERE id = 1')).rows[0].content_html,oldHtml);
  assert.equal((await client.query('SELECT * FROM internet_page_revisions')).rows.length,0);
});
