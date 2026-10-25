// Application cards share the board's positions, comments and threads. Negative
// address_id values remain reserved for cards that are not location stickers.
async function init({ db, query, postgres }) {
  const fields = { application_address_id: 'INTEGER', application_number: 'INTEGER',
    application_file_id: "TEXT NOT NULL DEFAULT ''", application_file_type: "TEXT NOT NULL DEFAULT ''" };
  if (postgres) {
    for (const [name, type] of Object.entries(fields)) {
      await query(`ALTER TABLE investigation_notes ADD COLUMN IF NOT EXISTS ${name} ${type}`);
    }
  } else {
    const columns = await new Promise((resolve, reject) => db.all('PRAGMA table_info(investigation_notes)',
      (error, rows) => error ? reject(error) : resolve(rows)));
    for (const [name, type] of Object.entries(fields)) {
      if (!columns.some(column => column.name === name)) {
        await new Promise((resolve, reject) => db.run(`ALTER TABLE investigation_notes ADD COLUMN ${name} ${type}`,
          error => error ? reject(error) : resolve()));
      }
    }
  }
  // Briefing uses (0, 0); ordinary applications use their address and number.
  // NULLs leave existing location and free notes outside this uniqueness rule.
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_investigation_application_file
    ON investigation_notes(room_id, scenario_id, application_address_id, application_number, application_file_id)`);
  await query('DROP INDEX IF EXISTS idx_investigation_application');
}

module.exports = { init };
