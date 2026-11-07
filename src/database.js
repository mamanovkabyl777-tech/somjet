const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');
const { safeErrorSummary } = require('./bot/safeLog');

const dbFile = path.resolve(config.database.path);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new Database(dbFile);

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value))) {
    throw new Error('Invalid internal SQL identifier');
  }
  return `"${value}"`;
}

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(table, column, ddl) {
  const allowed = new Set([
    'requisites.kind', 'requisites.provider', 'requisites.payment_link_fragment',
    'requisites.wallet_address', 'requisites.site', 'transactions.provider',
    'transactions.withdraw_details', 'transactions.site', 'users.broadcast_blocked',
  ]);
  if (!allowed.has(`${table}.${column}`)) throw new Error('Unexpected schema migration identifier');
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${ddl}`);
  }
}

function columnType(table, column) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
    .find((item) => item.name === column)?.type?.toUpperCase() || '';
}

async function migrateAmountsToTiyin() {
  const needsMigration = [
    columnType('transactions', 'amount'),
    columnType('requisites', 'amount'),
    columnType('statistics', 'value'),
  ].some((type) => type !== 'INTEGER');
  if (!needsMigration) return;

  const backup = await createDatabaseBackup();
  if (!backup) throw new Error('DB_BACKUP_DIR is required before amount migration');

  const rowCounts = {
    transactions: db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count,
    requisites: db.prepare('SELECT COUNT(*) AS count FROM requisites').get().count,
    statistics: db.prepare('SELECT COUNT(*) AS count FROM statistics').get().count,
  };

  db.pragma('foreign_keys = OFF');
  try {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE requisites_amount_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT DEFAULT 'bank_qr',
          provider TEXT,
          qr_code_photo_id TEXT,
          qr_code_file TEXT,
          payment_link_fragment TEXT,
          wallet_address TEXT,
          details TEXT,
          amount INTEGER DEFAULT 0,
          currency TEXT DEFAULT 'KGS',
          is_active INTEGER DEFAULT 1,
          created_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          site TEXT
        );
        INSERT INTO requisites_amount_new
        SELECT id, kind, provider, qr_code_photo_id, qr_code_file, payment_link_fragment,
               wallet_address, details,
               CASE WHEN amount IS NULL THEN NULL ELSE CAST(ROUND(amount * 100) AS INTEGER) END,
               currency, is_active, created_by, created_at, updated_at, site
        FROM requisites;
        DROP TABLE requisites;
        ALTER TABLE requisites_amount_new RENAME TO requisites;

        CREATE TABLE transactions_amount_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id TEXT UNIQUE NOT NULL,
          user_id INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('topup', 'withdraw')),
          amount INTEGER NOT NULL,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
          requisite_id INTEGER,
          provider TEXT,
          receipt_photo_id TEXT,
          receipt_file TEXT,
          payment_id TEXT,
          withdraw_details TEXT,
          confirmed_by INTEGER,
          confirmed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          site TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (requisite_id) REFERENCES requisites(id),
          FOREIGN KEY (confirmed_by) REFERENCES admins(id)
        );
        INSERT INTO transactions_amount_new
        SELECT id, transaction_id, user_id, type, CAST(ROUND(amount * 100) AS INTEGER), status,
               requisite_id, provider, receipt_photo_id, receipt_file, payment_id,
               withdraw_details, confirmed_by, confirmed_at, created_at, updated_at, site
        FROM transactions;
        DROP TABLE transactions;
        ALTER TABLE transactions_amount_new RENAME TO transactions;

        CREATE TABLE statistics_amount_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          metric TEXT NOT NULL UNIQUE,
          value INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO statistics_amount_new
        SELECT id, metric,
               CASE WHEN value IS NULL THEN NULL
                    WHEN metric = 'total_volume' THEN CAST(ROUND(value * 100) AS INTEGER)
                    ELSE CAST(ROUND(value) AS INTEGER) END,
               updated_at
        FROM statistics;
        DROP TABLE statistics;
        ALTER TABLE statistics_amount_new RENAME TO statistics;
      `);

      for (const [table, count] of Object.entries(rowCounts)) {
        const actual = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count;
        if (actual !== count) throw new Error('Amount migration changed row count');
      }
    });
    migrate();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const invalidAmountRows = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM transactions WHERE typeof(amount) != 'integer') +
      (SELECT COUNT(*) FROM requisites WHERE amount IS NOT NULL AND typeof(amount) != 'integer') +
      (SELECT COUNT(*) FROM statistics WHERE value IS NOT NULL AND typeof(value) != 'integer') AS count
  `).get().count;
  const foreignKeyViolations = db.pragma('foreign_key_check');
  if (invalidAmountRows || foreignKeyViolations.length) {
    throw new Error('Amount migration validation failed; restore from DB_BACKUP_DIR backup');
  }
}

async function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      role TEXT DEFAULT 'admin',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS requisites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT DEFAULT 'bank_qr',
      provider TEXT,
      qr_code_photo_id TEXT,
      qr_code_file TEXT,
      payment_link_fragment TEXT,
      wallet_address TEXT,
      details TEXT,
      amount INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'KGS',
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('topup', 'withdraw')),
      amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
      requisite_id INTEGER,
      provider TEXT,
      receipt_photo_id TEXT,
      receipt_file TEXT,
      payment_id TEXT,
      withdraw_details TEXT,
      confirmed_by INTEGER,
      confirmed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (requisite_id) REFERENCES requisites(id),
      FOREIGN KEY (confirmed_by) REFERENCES admins(id)
    );

    CREATE TABLE IF NOT EXISTS statistics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric TEXT NOT NULL UNIQUE,
      value INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS player_ids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      site TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(telegram_id, site, payment_id)
    );

    CREATE TABLE IF NOT EXISTS bot_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

  `);

  migratePlayerIdsBySite();

  db.exec(`
    UPDATE requisites SET provider = 'qr_bank'
    WHERE provider IN ('mbank', 'elqr', 'bakai')
  `);
  const extraActiveQr = db.prepare(`
    SELECT id FROM requisites
    WHERE provider = 'qr_bank' AND is_active = 1
    ORDER BY created_at DESC
  `).all();
  if (extraActiveQr.length > 1) {
    const keepId = extraActiveQr[0].id;
    db.prepare(`
      UPDATE requisites SET is_active = 0
      WHERE provider = 'qr_bank' AND id != ?
    `).run(keepId);
  }

  addColumnIfMissing('requisites', 'kind', "TEXT DEFAULT 'bank_qr'");
  addColumnIfMissing('requisites', 'provider', 'TEXT');
  addColumnIfMissing('requisites', 'payment_link_fragment', 'TEXT');
  addColumnIfMissing('requisites', 'wallet_address', 'TEXT');
  addColumnIfMissing('requisites', 'site', 'TEXT');
  addColumnIfMissing('transactions', 'provider', 'TEXT');
  addColumnIfMissing('transactions', 'withdraw_details', 'TEXT');
  addColumnIfMissing('transactions', 'site', 'TEXT');
  addColumnIfMissing('users', 'broadcast_blocked', 'INTEGER NOT NULL DEFAULT 0');

  await migrateAmountsToTiyin();

  const insertStat = db.prepare('INSERT OR IGNORE INTO statistics (metric, value) VALUES (?, ?)');
  insertStat.run('total_topups', 0);
  insertStat.run('total_withdrawals', 0);
  insertStat.run('total_transactions', 0);
  insertStat.run('total_volume', 0);


  syncAdminsFromEnv();
}

function playerIdsNeedsSiteRebuild() {
  const cols = db.prepare('PRAGMA table_info(player_ids)').all();
  if (!cols.length) return false;
  if (!cols.some((c) => c.name === 'site')) return true;
  const indexes = db.prepare('PRAGMA index_list(player_ids)').all();
  for (const idx of indexes) {
    if (!idx.unique) continue;
    const info = db.prepare(`PRAGMA index_info(${quoteIdentifier(idx.name)})`).all();
    const names = info.map((i) => i.name).join(',');
    if (names === 'telegram_id,payment_id') return true;
  }
  return false;
}

function migratePlayerIdsBySite() {
  const cols = db.prepare('PRAGMA table_info(player_ids)').all();
  if (!cols.length) return;

  if (playerIdsNeedsSiteRebuild()) {
    db.exec(`
      CREATE TABLE player_ids_by_site (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER NOT NULL,
        site TEXT NOT NULL,
        payment_id TEXT NOT NULL,
        used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(telegram_id, site, payment_id)
      );
    `);
    if (cols.some((c) => c.name === 'site')) {
      db.exec(`
        INSERT INTO player_ids_by_site (telegram_id, site, payment_id, used_at)
        SELECT telegram_id, site, payment_id, used_at
        FROM player_ids
        WHERE site IS NOT NULL AND TRIM(site) != ''
      `);
    }
    db.exec(`
      DROP TABLE player_ids;
      ALTER TABLE player_ids_by_site RENAME TO player_ids;
    `);
    return;
  }

  db.exec(`DELETE FROM player_ids WHERE site IS NULL OR TRIM(site) = ''`);
}

function syncAdminsFromEnv() {
  const adminIds = config.admin.telegramIds;
  if (adminIds.length === 0) {
    console.warn('[DB] ADMIN_TELEGRAM_IDS is empty — no bot admins until you set it in .env');
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO admins (user_id, username, role, active)
    VALUES (?, ?, 'admin', 1)
    ON CONFLICT(user_id) DO UPDATE SET active = 1, username = excluded.username
  `);

  adminIds.forEach((tgId, i) => {
    upsert.run(tgId, 'admin' + (i + 1));
  });
  console.log(`[DB] Synced ${adminIds.length} admin(s) from ADMIN_TELEGRAM_IDS`);
}

async function createDatabaseBackup() {
  if (!config.database.backupDir) return null;

  const databaseDirectory = path.dirname(dbFile);
  const backupDirectory = path.resolve(config.database.backupDir);
  if (!backupDirectory.startsWith(databaseDirectory + path.sep)) {
    throw new Error('DB_BACKUP_DIR must be on the database disk');
  }
  fs.mkdirSync(backupDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(backupDirectory, `somjet-backup-${timestamp}.db`);
  await db.backup(destination);

  const backups = fs.readdirSync(backupDirectory)
    .filter((name) => /^somjet-backup-\d{4}-\d{2}-\d{2}T.*\.db$/.test(name))
    .map((name) => ({ name, mtime: fs.statSync(path.join(backupDirectory, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const backup of backups.slice(7)) {
    fs.unlinkSync(path.join(backupDirectory, backup.name));
  }
  return destination;
}

async function startDatabaseBackups() {
  if (!config.database.backupDir) {
    console.warn('[DB] Backups disabled; DB_BACKUP_DIR is not set');
    return null;
  }

  const backupOnce = () => createDatabaseBackup().catch((error) => {
    console.error('[DB] Backup failed:', safeErrorSummary(error));
  });
  await createDatabaseBackup();
  const timer = setInterval(backupOnce, 24 * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}

function getDb() {
  return db;
}

module.exports = { db, initDatabase, getDb, createDatabaseBackup, startDatabaseBackups };
