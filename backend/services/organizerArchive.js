'use strict';

const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
function createOrganizerArchive({ query, transaction }) {
  async function init() {
    await query(`CREATE TABLE IF NOT EXISTS room_archives (
      room_id INTEGER PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
      archived_at TEXT NOT NULL)`);
  }
  async function roomArchives() {
    return (await query('SELECT room_id,archived_at FROM room_archives')).rows;
  }
  async function setRoom(admin, roomId, body = {}) {
    if (!admin?.is_admin) fail(403, 'Нужны права организатора');
    if (typeof body.archived !== 'boolean') fail(400, 'Укажите, нужно ли архивировать комнату');
    return transaction(async q => {
      await q('UPDATE rooms SET name=name WHERE id=$1', [roomId]);
      const room = (await q('SELECT * FROM rooms WHERE id=$1', [roomId])).rows[0];
      if (!room || (admin.admin_level !== 'super_admin' && Number(room.created_by) !== Number(admin.id))) fail(404, 'Комната не найдена или недоступна');
      if ((await q('SELECT room_id FROM house_teams WHERE room_id=$1', [roomId])).rows.length) fail(409, 'Управляйте агентством через его дом');
      if (body.archived) await q('INSERT INTO room_archives (room_id,archived_at) VALUES ($1,$2) ON CONFLICT(room_id) DO NOTHING', [roomId, new Date().toISOString()]);
      else await q('DELETE FROM room_archives WHERE room_id=$1', [roomId]);
      return { ok: true, archived: body.archived };
    });
  }
  return { init, roomArchives, setRoom };
}
module.exports = { createOrganizerArchive };
