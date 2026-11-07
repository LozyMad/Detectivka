"""Check or explicitly restore the complete approved address-book backup.

Default mode only checks. --apply replaces this one table, after making a full
SQLite backup. Normal application startup and deployment never invoke restoration.
"""
import argparse
import hashlib
import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'backend/data/addressBookBackup20261018.json'
FIELDS = ('id', 'category', 'district', 'house_number', 'apartment', 'name', 'note', 'created_at', 'updated_at')
SOURCE_HASH = '6c3ed76579d61c5c83a9cbb6e1f3de92086ac32f5eaa4f23c257e960dda666e8'

def canonical(rows):
    return json.dumps(sorted(rows, key=lambda row: row['id']), ensure_ascii=False,
                      sort_keys=True, separators=(',', ':')).encode()

def source_rows():
    rows = json.loads(SOURCE.read_text(encoding='utf-8-sig'))
    if len(rows) != 1093 or hashlib.sha256(canonical(rows)).hexdigest() != SOURCE_HASH:
        raise ValueError('The approved backup changed; review it before restoring.')
    if not all(set(row) == set(FIELDS) for row in rows):
        raise ValueError('Unexpected backup columns.')
    return sorted(rows, key=lambda row: row['id'])

def book(connection):
    return [dict(row) for row in connection.execute('SELECT * FROM address_book_entries ORDER BY id')]

def other_data(connection):
    result = {}
    names = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'address_book_entries' ORDER BY name")]
    for name in names:
        quoted = '"' + name.replace('"', '""') + '"'
        rows = sorted(json.dumps(list(row), ensure_ascii=False, default=str)
                      for row in connection.execute('SELECT * FROM ' + quoted))
        result[name] = hashlib.sha256('\n'.join(rows).encode()).hexdigest()
    result['other_sequences'] = [tuple(row) for row in connection.execute("SELECT name,seq FROM sqlite_sequence WHERE name<>'address_book_entries' ORDER BY name")]
    return result

def restore(database, apply=False, backup_dir=None):
    target = source_rows()
    mode = 'rw' if apply else 'ro'
    connection = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=' + mode,
                                 uri=True, isolation_level=None, timeout=30)
    connection.row_factory = sqlite3.Row
    try:
        current = book(connection)
        result = {'entries': len(current), 'expected': len(target), 'exact_match': current == target, 'applied': False}
        if not apply or result['exact_match']:
            return result
        connection.execute('PRAGMA foreign_keys=ON')
        names = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for name in names:
            quoted = '"' + name.replace('"', '""') + '"'
            if any(row[2] == 'address_book_entries' for row in connection.execute('PRAGMA foreign_key_list(' + quoted + ')')):
                raise ValueError('Other tables reference address-book IDs; automatic replacement refused.')
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
        folder = Path(backup_dir) if backup_dir else ROOT / 'backups/address-book' / stamp
        folder.mkdir(parents=True, exist_ok=False)
        backup = folder / 'database-before.sqlite'
        with closing(sqlite3.connect(backup)) as destination:
            connection.backup(destination)
        os.chmod(backup, 0o600)
        connection.execute('BEGIN IMMEDIATE')
        try:
            if book(connection) != current:
                raise ValueError('The book changed during preparation; restore aborted.')
            other_before = other_data(connection)
            connection.execute('DELETE FROM address_book_entries')
            connection.executemany('INSERT INTO address_book_entries (' + ','.join(FIELDS) + ') VALUES (?,?,?,?,?,?,?,?,?)',
                                   [tuple(row[field] for field in FIELDS) for row in target])
            connection.execute("UPDATE sqlite_sequence SET seq=? WHERE name='address_book_entries'", (max(row['id'] for row in target),))
            if book(connection) != target or other_data(connection) != other_before:
                raise ValueError('Restored data did not match or unrelated data changed.')
            if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('SQLite integrity check failed.')
            connection.execute('COMMIT')
        except BaseException:
            connection.execute('ROLLBACK')
            raise
        result.update(entries=len(target), exact_match=True, applied=True, backup=str(backup), other_tables_unchanged=True)
        return result
    finally:
        connection.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=ROOT / 'backend/database.sqlite')
    parser.add_argument('--apply', action='store_true', help='Replace the book exactly, including original IDs, dates and legacy header rows.')
    parser.add_argument('--backup-dir', type=Path)
    args = parser.parse_args()
    result = restore(args.database, apply=args.apply, backup_dir=args.backup_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['exact_match'] else 1)
