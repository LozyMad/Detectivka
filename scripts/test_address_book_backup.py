import importlib.util
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

spec = importlib.util.spec_from_file_location('book_restore', Path(__file__).with_name('restore-address-book-backup.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RestorationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'database.sqlite'
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.executescript('''CREATE TABLE address_book_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,category TEXT NOT NULL,district TEXT NOT NULL,
                house_number TEXT NOT NULL,apartment TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',created_at TEXT,updated_at TEXT,
                UNIQUE(category,district,house_number,apartment,name));
                CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO users VALUES (1,'Preserve this account');
                INSERT INTO address_book_entries VALUES (1,'Old','Ц','999','','Old record','','old date','old date');''')

    def read(self, path=None):
        with closing(sqlite3.connect(path or self.path)) as connection:
            connection.row_factory = sqlite3.Row
            return module.book(connection)

    def test_check_is_read_only_and_does_not_create_backups(self):
        before = self.read()
        result = module.restore(self.path, backup_dir=self.root / 'backup')
        self.assertFalse(result['exact_match'])
        self.assertEqual(self.read(), before)
        self.assertFalse((self.root / 'backup').exists())

    def test_exact_restore_includes_legacy_rows_and_metadata_and_preserves_other_tables(self):
        before = self.read()
        result = module.restore(self.path, apply=True, backup_dir=self.root / 'backup')
        self.assertEqual(self.read(), module.source_rows())
        self.assertEqual(self.read(Path(result['backup'])), before)
        self.assertEqual(sum(row['district'] == 'Район' for row in self.read()), 14)
        with closing(sqlite3.connect(self.path)) as connection:
            self.assertEqual(connection.execute('SELECT * FROM users').fetchall(), [(1,'Preserve this account')])
        self.assertTrue(result['other_tables_unchanged'])
        repeated = module.restore(self.path, apply=True, backup_dir=self.root / 'second-backup')
        self.assertFalse(repeated['applied'])
        self.assertFalse((self.root / 'second-backup').exists())

    def test_references_prevent_replacing_ids_without_changing_the_book(self):
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute('CREATE TABLE refs (entry_id INTEGER REFERENCES address_book_entries(id))')
            connection.execute('INSERT INTO refs VALUES (1)')
        before = self.read()
        with self.assertRaisesRegex(ValueError,'reference'):
            module.restore(self.path, apply=True, backup_dir=self.root / 'backup')
        self.assertEqual(self.read(), before)

if __name__ == '__main__':
    unittest.main()
