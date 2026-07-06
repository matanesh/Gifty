/**
 * @file database.ts
 * @description SQLite database initialization and schema management for Gifty.
 *
 * Implements the local database schema as defined in section 4.1 of the design doc.
 * Uses WAL (Write-Ahead Logging) for better concurrent read/write performance.
 *
 * Tables:
 *  - users          : Local user profile (mirrors Supabase Auth UID)
 *  - gift_cards     : Core card data (gift cards, loyalty, vouchers, prepaid)
 *  - usage_logs     : Spending history per card
 *  - sync_queue     : Pending changes to push to Supabase
 *  - brand_catalog  : Brand metadata for autocomplete & logos
 */

import * as SQLite from 'expo-sqlite';

/** Singleton database instance */
let db: SQLite.SQLiteDatabase | null = null;

/** Database filename */
const DB_NAME = 'gifty.db';

/** Current schema version — bump this when adding migrations */
const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// DDL Statements
// ---------------------------------------------------------------------------

const DDL_PRAGMA_WAL = `PRAGMA journal_mode=WAL;`;
const DDL_PRAGMA_FK = `PRAGMA foreign_keys=ON;`;

const DDL_USERS = `
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,                          -- Supabase Auth UID
  email           TEXT NOT NULL,
  display_name    TEXT,
  preferred_currency TEXT DEFAULT 'ILS',
  language        TEXT DEFAULT 'he',
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
`.trim();

const DDL_GIFT_CARDS = `
CREATE TABLE IF NOT EXISTS gift_cards (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id               TEXT NOT NULL REFERENCES users(id),

  -- Core info
  brand_name            TEXT NOT NULL,
  card_type             TEXT NOT NULL DEFAULT 'gift_card', -- 'gift_card' | 'loyalty' | 'voucher' | 'prepaid'
  code                  TEXT,                              -- Actual card code/number (encrypted at rest)
  barcode_data          TEXT,                             -- Raw barcode data for rendering
  barcode_format        TEXT,                             -- 'CODE128' | 'QR' | 'EAN13' | 'PDF417' etc.
  pin                   TEXT,                             -- PIN/CVV (encrypted at rest)
  card_number           TEXT,                             -- Additional card number

  -- Financial
  initial_amount        REAL,                             -- NULL for loyalty cards (points-based)
  current_balance       REAL,
  currency              TEXT DEFAULT 'ILS',
  points_balance        INTEGER,                          -- For loyalty cards

  -- Dates (ISO 8601 strings)
  issue_date            TEXT,
  valid_until           TEXT,                             -- NULL = no expiry

  -- Metadata
  category              TEXT DEFAULT 'general',           -- 'shopping'|'dining'|'entertainment'|'services'|'online'|'grocery'|'fuel'|'general'
  color                 TEXT DEFAULT 'blue',              -- UI accent color
  networks              TEXT DEFAULT '[]',                -- JSON array of accepted stores
  notes                 TEXT,
  tags                  TEXT DEFAULT '[]',                -- JSON array of user-defined tags
  is_favorite           INTEGER DEFAULT 0,
  is_archived           INTEGER DEFAULT 0,               -- Soft archive for used-up / expired cards

  -- Images
  image_front_url       TEXT,                            -- Remote URL (Supabase Storage)
  image_front_local     TEXT,                            -- Local file path (cache)
  image_back_url        TEXT,
  image_back_local      TEXT,

  -- Reminders
  reminder_days_before  INTEGER DEFAULT 7,
  reminder_enabled      INTEGER DEFAULT 1,

  -- Sync tracking
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now')),
  deleted_at            TEXT,                            -- Soft delete timestamp for sync
  is_synced             INTEGER DEFAULT 0,
  remote_version        INTEGER DEFAULT 0
);
`.trim();

const DDL_GIFT_CARDS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_gift_cards_user    ON gift_cards(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_gift_cards_brand   ON gift_cards(brand_name);`,
  `CREATE INDEX IF NOT EXISTS idx_gift_cards_expiry  ON gift_cards(valid_until);`,
  `CREATE INDEX IF NOT EXISTS idx_gift_cards_archived ON gift_cards(is_archived);`,
];

const DDL_USAGE_LOGS = `
CREATE TABLE IF NOT EXISTS usage_logs (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  gift_card_id    TEXT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id),

  amount_used     REAL NOT NULL,
  balance_after   REAL NOT NULL,
  store_name      TEXT,
  notes           TEXT,
  used_at         TEXT DEFAULT (datetime('now')),

  -- Sync tracking
  created_at      TEXT DEFAULT (datetime('now')),
  deleted_at      TEXT,
  is_synced       INTEGER DEFAULT 0
);
`.trim();

const DDL_USAGE_LOGS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_usage_logs_card ON usage_logs(gift_card_id);`,
];

const DDL_SYNC_QUEUE = `
CREATE TABLE IF NOT EXISTS sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL,
  record_id   TEXT NOT NULL,
  operation   TEXT NOT NULL,     -- 'INSERT' | 'UPDATE' | 'DELETE'
  payload     TEXT NOT NULL,     -- JSON of the changed data
  created_at  TEXT DEFAULT (datetime('now')),
  retry_count INTEGER DEFAULT 0,
  last_error  TEXT
);
`.trim();

const DDL_BRAND_CATALOG = `
CREATE TABLE IF NOT EXISTS brand_catalog (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_he     TEXT,             -- Hebrew display name
  logo_url    TEXT,
  category    TEXT,
  networks    TEXT DEFAULT '[]', -- JSON array of store names/locations
  website     TEXT,
  has_api     INTEGER DEFAULT 0, -- Future: supports automatic balance checking
  updated_at  TEXT
);
`.trim();

/** Internal schema_version table — tracks migration state */
const DDL_SCHEMA_VERSION = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
`.trim();

// ---------------------------------------------------------------------------
// Database Access
// ---------------------------------------------------------------------------

/**
 * Returns the singleton SQLite database instance.
 * Call `initDatabase()` before using this.
 *
 * @throws {Error} If the database has not been initialized yet.
 */
export function getDatabase(): SQLite.SQLiteDatabase {
  if (!db) {
    throw new Error(
      'Database is not initialized. Call initDatabase() first.'
    );
  }
  return db;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Opens (or creates) the SQLite database and runs all schema DDL statements.
 *
 * - Enables WAL journal mode for improved concurrent performance.
 * - Enables foreign key enforcement.
 * - Creates all tables and indexes if they do not already exist.
 * - Records the schema version for future migrations.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @returns {Promise<SQLite.SQLiteDatabase>} Resolved database instance.
 */
export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) {
    return db;
  }

  db = await SQLite.openDatabaseAsync(DB_NAME);

  await runInitialSchema(db);

  return db;
}

/**
 * Executes all DDL statements required to bring the schema to the current version.
 *
 * @param database - Open SQLiteDatabase instance.
 */
async function runInitialSchema(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.withTransactionAsync(async () => {
    // ---- PRAGMAs (must run outside a transaction in some SQLite builds,
    //      but expo-sqlite allows them inside withTransactionAsync) ----
    await database.execAsync(DDL_PRAGMA_WAL);
    await database.execAsync(DDL_PRAGMA_FK);

    // ---- Schema version table ----
    await database.execAsync(DDL_SCHEMA_VERSION);

    // ---- Core tables ----
    await database.execAsync(DDL_USERS);
    await database.execAsync(DDL_GIFT_CARDS);
    for (const idx of DDL_GIFT_CARDS_INDEXES) {
      await database.execAsync(idx);
    }
    await database.execAsync(DDL_USAGE_LOGS);
    for (const idx of DDL_USAGE_LOGS_INDEXES) {
      await database.execAsync(idx);
    }
    await database.execAsync(DDL_SYNC_QUEUE);
    await database.execAsync(DDL_BRAND_CATALOG);

    // ---- Record schema version (INSERT OR IGNORE so this is idempotent) ----
    await database.runAsync(
      `INSERT OR IGNORE INTO schema_version (version) VALUES (?);`,
      [SCHEMA_VERSION]
    );
  });
}

// ---------------------------------------------------------------------------
// Utility helpers (exported for use in other services)
// ---------------------------------------------------------------------------

/**
 * Verifies that WAL mode is active.
 * Useful in tests or diagnostics.
 *
 * @returns {Promise<string>} The journal mode string returned by SQLite (e.g. "wal").
 */
export async function getJournalMode(): Promise<string> {
  const database = getDatabase();
  const result = await database.getFirstAsync<{ journal_mode: string }>(
    `PRAGMA journal_mode;`
  );
  return result?.journal_mode ?? 'unknown';
}

/**
 * Returns the current schema version stored in the database.
 *
 * @returns {Promise<number | null>} Stored version, or null if the table is empty.
 */
export async function getSchemaVersion(): Promise<number | null> {
  const database = getDatabase();
  const result = await database.getFirstAsync<{ version: number }>(
    `SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;`
  );
  return result?.version ?? null;
}

/**
 * Closes the database connection and clears the singleton.
 * Primarily useful for testing teardown.
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
}
