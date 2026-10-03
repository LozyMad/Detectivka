const { db, query } = require('../config/database');

const postgres = process.env.DB_TYPE === 'postgresql';
const marks = (count) => Array.from({ length: count }, (_, i) => postgres ? `$${i + 1}` : '?').join(', ');

function all(sql, params = []) {
  if (postgres) return query(sql, params).then(result => result.rows);
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function run(sql, params = []) {
  if (postgres) return query(sql, params).then(result => ({ id: result.rows[0]?.id, changes: result.rowCount }));
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

const scoped = (roomId, scenarioId) => [roomId, scenarioId];

async function list(roomId, scenarioId) {
  const where = `room_id = ${postgres ? '$1' : '?'} AND scenario_id = ${postgres ? '$2' : '?'}`;
  const [notes, links] = await Promise.all([
    all(`SELECT * FROM investigation_notes WHERE ${where} ORDER BY id`, scoped(roomId, scenarioId)),
    all(`SELECT * FROM investigation_links WHERE ${where} ORDER BY id`, scoped(roomId, scenarioId))
  ]);
  return { notes, links };
}

async function getNote(roomId, scenarioId, id) {
  const values = [roomId, scenarioId, id];
  const [note] = await all(`SELECT * FROM investigation_notes WHERE room_id = ${postgres ? '$1' : '?'} AND scenario_id = ${postgres ? '$2' : '?'} AND id = ${postgres ? '$3' : '?'}`, values);
  return note || null;
}

async function findByAddress(roomId, scenarioId, addressId) {
  const [note] = await all(`SELECT * FROM investigation_notes WHERE room_id = ${postgres ? '$1' : '?'} AND scenario_id = ${postgres ? '$2' : '?'} AND address_id = ${postgres ? '$3' : '?'}`, [roomId, scenarioId, addressId]);
  return note || null;
}

function nextPosition(notes) {
  // A grid starts near the centre; occupied cells are skipped without stacking notes.
  const stepX = 330;
  const stepY = 320;
  for (let ring = 0; ring < 100; ring++) {
    for (let row = -ring; row <= ring; row++) {
      for (let col = -ring; col <= ring; col++) {
        if (Math.max(Math.abs(col), Math.abs(row)) !== ring) continue;
        const x = 950 + col * stepX;
        const y = 600 + row * stepY;
        if (x < 100 || y < 100) continue;
        if (notes.every(note => Math.abs(note.x - x) >= 280 || Math.abs(note.y - y) >= 270)) {
          return { x, y };
        }
      }
    }
  }
  return { x: 950, y: 600 + notes.length * stepY };
}

async function createNote(data) {
  const { notes } = await list(data.room_id, data.scenario_id);
  const position = nextPosition(notes);
  const values = [data.room_id, data.scenario_id, data.address_id, data.title,
    data.address_label, data.comment, data.color, position.x, position.y];
  const result = await run(`INSERT INTO investigation_notes
    (room_id, scenario_id, address_id, title, address_label, comment, color, x, y)
    VALUES (${marks(values.length)})${postgres ? ' RETURNING id' : ''}`, values);
  return getNote(data.room_id, data.scenario_id, result.id);
}

async function createFreeNote(data) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { notes } = await list(data.room_id, data.scenario_id);
    const addressId = Math.min(0, ...notes.map(note => Number(note.address_id))) - 1;
    try {
      return await createNote({ ...data, address_id: addressId, address_label: '' });
    } catch (error) {
      if (error.code !== '23505' && error.code !== 'SQLITE_CONSTRAINT') throw error;
    }
  }
  throw new Error('Не удалось создать стикер. Попробуйте ещё раз.');
}

async function updateNote(roomId, scenarioId, id, { comment, color, title }) {
  const target = await getNote(roomId, scenarioId, id);
  if (!target) return null;
  const free = Number(target.address_id) < 0;
  const sql = postgres
    ? `UPDATE investigation_notes SET comment = $1, color = $2, ${free ? 'title = $3, ' : ''}updated_at = CURRENT_TIMESTAMP WHERE room_id = $${free ? 4 : 3} AND scenario_id = $${free ? 5 : 4} AND id = $${free ? 6 : 5}`
    : `UPDATE investigation_notes SET comment = ?, color = ?, ${free ? 'title = ?, ' : ''}updated_at = CURRENT_TIMESTAMP WHERE room_id = ? AND scenario_id = ? AND id = ?`;
  const result = await run(sql, [comment, color, ...(free ? [title] : []), roomId, scenarioId, id]);
  return result.changes ? getNote(roomId, scenarioId, id) : null;
}

async function moveNote(roomId, scenarioId, id, x, y) {
  const sql = postgres
    ? 'UPDATE investigation_notes SET x = $1, y = $2, updated_at = CURRENT_TIMESTAMP WHERE room_id = $3 AND scenario_id = $4 AND id = $5'
    : 'UPDATE investigation_notes SET x = ?, y = ?, updated_at = CURRENT_TIMESTAMP WHERE room_id = ? AND scenario_id = ? AND id = ?';
  const result = await run(sql, [x, y, roomId, scenarioId, id]);
  return result.changes ? getNote(roomId, scenarioId, id) : null;
}

async function deleteNote(roomId, scenarioId, id) {
  const target = await getNote(roomId, scenarioId, id);
  if (!target) return false;
  const params = [roomId, scenarioId, id, id];
  await run(`DELETE FROM investigation_links WHERE room_id = ${postgres ? '$1' : '?'} AND scenario_id = ${postgres ? '$2' : '?'} AND (note_a = ${postgres ? '$3' : '?'} OR note_b = ${postgres ? '$4' : '?'})`, params);
  await run(`DELETE FROM investigation_notes WHERE room_id = ${postgres ? '$1' : '?'} AND scenario_id = ${postgres ? '$2' : '?'} AND id = ${postgres ? '$3' : '?'}`, [roomId, scenarioId, id]);
  return true;
}

async function createLink(roomId, scenarioId, noteA, noteB) {
  const values = [roomId, scenarioId, noteA, noteB];
  const result = await run(`INSERT INTO investigation_links (room_id, scenario_id, note_a, note_b)
    VALUES (${marks(4)})${postgres ? ' RETURNING id' : ''}`, values);
  const [link] = await all(`SELECT * FROM investigation_links WHERE id = ${postgres ? '$1' : '?'} AND room_id = ${postgres ? '$2' : '?'} AND scenario_id = ${postgres ? '$3' : '?'}`, [result.id, roomId, scenarioId]);
  return link;
}

async function findLink(roomId, scenarioId, noteA, noteB) {
  const [link] = await all(`SELECT * FROM investigation_links WHERE room_id = ${postgres ? '$1' : '?'} AND scenario_id = ${postgres ? '$2' : '?'} AND note_a = ${postgres ? '$3' : '?'} AND note_b = ${postgres ? '$4' : '?'}`, [roomId, scenarioId, noteA, noteB]);
  return link || null;
}

async function deleteLink(roomId, scenarioId, id) {
  const result = await run(`DELETE FROM investigation_links WHERE room_id = ${postgres ? '$1' : '?'} AND scenario_id = ${postgres ? '$2' : '?'} AND id = ${postgres ? '$3' : '?'}`, [roomId, scenarioId, id]);
  return result.changes > 0;
}

module.exports = { list, getNote, findByAddress, createNote, createFreeNote, updateNote, moveNote, deleteNote, createLink, findLink, deleteLink };
