// Synchronous SQLite interface shared with the existing transactional business rules.
export function sqlDatabase(storage) {
  return {
    exec(query) { storage.sql.exec(query); },
    transactionSync(fn) { return storage.transactionSync(fn); },
    prepare(query) {
      return {
        get(...values) { return storage.sql.exec(query, ...values).toArray()[0]; },
        all(...values) { return storage.sql.exec(query, ...values).toArray(); },
        run(...values) { const cursor = storage.sql.exec(query, ...values); cursor.toArray(); return { changes: cursor.rowsWritten }; },
      };
    },
  };
}
export function memberDirectory(members) {
  return { prepare(query) {
    if (query === 'SELECT name FROM users WHERE id=?') return { get(id) { const user = members.find(m => m.id === id); return user ? { name: user.name } : undefined; } };
    if (query.startsWith('SELECT u.id,u.name,u.email,m.role FROM memberships')) return { all() { return members; } };
    throw Error('Unsupported registry operation inside a tenant database');
  } };
}
