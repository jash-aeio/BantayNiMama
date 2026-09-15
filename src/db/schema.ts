// Schema migrations — TR-44. Forward-only: a shipped migration is never edited; the next change
// is a new version. Keep this in step with ARCHITECTURE.md §5.

export interface Migration {
  readonly version: number;
  /** Run in order, inside one transaction, together with the schema_version bump. */
  readonly statements: readonly string[];
}

/** A price column: whole, non-negative centavos or NULL — enforced by SQLite itself (TR-41). */
const centavos = (column: string) =>
  `${column} INTEGER CHECK (${column} IS NULL OR (typeof(${column}) = 'integer' AND ${column} >= 0))`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE products (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
        ${centavos('price_piece')},
        ${centavos('price_pack')},
        unit_label      TEXT,
        category        TEXT,
        is_ambiguous    INTEGER NOT NULL DEFAULT 0 CHECK (is_ambiguous IN (0, 1)),
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        last_scanned_at INTEGER,
        deleted_at      INTEGER
      )`,
      // embedding: little-endian Float32 × embedding_dim, L2-normalized (TR-22, ADR-014).
      // photo_path: relative to the document directory (TR-43).
      `CREATE TABLE product_shots (
        id         TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        photo_path TEXT NOT NULL,
        model_id   TEXT NOT NULL,
        embedding  BLOB NOT NULL CHECK (typeof(embedding) = 'blob'),
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE price_history (
        id         TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        ${centavos('price_piece')},
        ${centavos('price_pack')},
        changed_at INTEGER NOT NULL
      )`,
      'CREATE INDEX idx_products_name ON products(name)',
      'CREATE INDEX idx_products_deleted ON products(deleted_at)',
      'CREATE INDEX idx_shots_product ON product_shots(product_id)',
      // Seeded once, as data (TR-35, ADR-008): the Phase 0 calibration from ARCHITECTURE.md §6.
      // From here on these are only ever read from app_meta, and retuned by writing the row —
      // never by editing code. confirm_below is deliberately absent: TR-38 has no value yet.
      `INSERT INTO app_meta (key, value) VALUES
        ('model_id', 'mobilenet_v3_large_embedder_v1'),
        ('embedding_dim', '1280'),
        ('tau', '0.46'),
        ('delta', '0.075')`,
    ],
  },
  {
    version: 2,
    // P2-2. The CHECK lists are literals, not built from SHOT_SOURCES / NEGATIVE_SOURCES: a shipped
    // migration must never change because a constant did. schema.test.ts checks the two agree.
    // confirm_below is still absent: no row means confirm every ACCEPT (TR-38, ADR-017).
    statements: [
      // SR-14, TR-39, ADR-017: store-local negatives. No name or price column, so no query can name
      // or price one. Same vector, model stamp and photo rules as product_shots (TR-23, TR-24, TR-43).
      `CREATE TABLE negative_shots (
        id         TEXT PRIMARY KEY,
        photo_path TEXT NOT NULL,
        model_id   TEXT NOT NULL,
        embedding  BLOB NOT NULL CHECK (typeof(embedding) = 'blob'),
        source     TEXT NOT NULL CHECK (source IN ('confirm_no', 'wrong_lock', 'wrong_chip')),
        created_at INTEGER NOT NULL
      )`,
      // SR-07, TR-42, ADR-019. Every shot written before this migration came from enrollment, so the
      // default labels the existing rows correctly.
      `ALTER TABLE product_shots ADD COLUMN source TEXT NOT NULL DEFAULT 'enroll'
        CHECK (source IN ('enroll', 'correction', 'teach'))`,
    ],
  },
];

/** The version migrate() brings every database to. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
