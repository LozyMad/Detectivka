// Run on the target VPS before exposing a copied local SQLite database.
const path = require('node:path');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcryptjs');

async function readPassword(prompt) {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const reader = readline.createInterface({ input: process.stdin, output, terminal: true });
  try {
    return await new Promise(resolve => {
      reader.question(prompt, resolve);
      muted = true;
    });
  } finally {
    muted = false;
    reader.close();
    process.stdout.write('\n');
  }
}

async function main() {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive SSH terminal.');
  const password = await readPassword('New password for admin (12+ characters; input hidden): ');
  if (password.length < 12) throw new Error('Password must contain at least 12 characters.');
  const confirmation = await readPassword('Repeat password: ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  const hash = bcrypt.hashSync(password, 12);
  const databasePath = path.resolve(__dirname, '../../backend/database.sqlite');
  await new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READWRITE, error => {
      if (error) return reject(error);
      database.run(
        "UPDATE users SET password = ? WHERE username = 'admin' AND admin_level = 'super_admin'",
        [hash],
        function (updateError) {
          const updated = this.changes;
          database.close(closeError => {
            if (updateError || closeError) return reject(updateError || closeError);
            if (updated !== 1) return reject(new Error('Expected one existing super_admin account named admin.'));
            resolve();
          });
        },
      );
    });
  });
  console.log('Admin password updated.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
