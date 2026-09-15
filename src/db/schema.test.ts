// Migration 2 against real SQLite — PHASE_2_PLAN.md P2-2. It runs on the only copy of the 20-product
// gate catalog (§2), so it is proven here before it reaches the phone.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { NEGATIVE_SOURCES, SHOT_SOURCES } from '../domain/correction.ts';
import { vectorToBlob } from '../domain/vector.ts';
import { migrate } from './migrate.ts';
import { openTestDatabase } from './nodeSqlite.testing.ts';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './schema.ts';

const blob = (...values: number[]) => vectorToBlob(Float32Array.from(values));

/** A database exactly as a Phase 1 install left it, with a small catalog in it. */
function phase1Catalog() {
  const db = openTestDatabase();
  assert.deepEqual(migrate(db, MIGRATIONS.slice(0, 1)), { from: 0, to: 1 });

  db.executeSync(
    "INSERT INTO products (id, name, price_piece, price_pack, unit_label, category, is_ambiguous, created_at, updated_at, last_scanned_at, deleted_at) VALUES " +
      "('p1', 'Argentina Corned Beef 260g', 3500, NULL, 'lata', 'de lata', 0, 100, 100, NULL, NULL), " +
      "('p2', 'Asukal (repack)', 1500, 14000, NULL, NULL, 1, 200, 250, 300, 400)",
  );
  for (const [id, product, x] of [['s1', 'p1', 1], ['s2', 'p1', 2], ['s3', 'p2', 3]] as const) {
    db.executeSync('INSERT INTO product_shots (id, product_id, photo_path, model_id, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      product,
      `photos/${id}.jpg`,
      'mobilenet_v3_large_embedder_v1',
      blob(x, 0.5, -0.25),
      500,
    ]);
  }
  db.executeSync("INSERT INTO price_history (id, product_id, price_piece, price_pack, changed_at) VALUES ('h1', 'p1', 3200, NULL, 90)");
  db.executeSync("INSERT INTO app_meta (key, value) VALUES ('ui_language', 'fil')");
  return db;
}

function snapshot(db: ReturnType<typeof openTestDatabase>) {
  const all = (sql: string) => db.executeSync(sql).rows;
  return {
    products: all('SELECT * FROM products ORDER BY id'),
    shots: all('SELECT id, product_id, photo_path, model_id, hex(embedding) AS embedding, created_at FROM product_shots ORDER BY id'),
    history: all('SELECT * FROM price_history ORDER BY id'),
    meta: all("SELECT key, value FROM app_meta WHERE key <> 'schema_version' ORDER BY key"),
  };
}

describe('migration 2 (TR-44, P2-2)', () => {
  test('upgrades a Phase 1 catalog 1 → 2 with every row and byte intact', () => {
    const db = phase1Catalog();
    const before = snapshot(db);

    assert.deepEqual(migrate(db), { from: 1, to: 2 });

    assert.deepEqual(snapshot(db), before);
    assert.deepEqual(
      db.executeSync('SELECT id, source FROM product_shots ORDER BY id').rows,
      [
        { id: 's1', source: 'enroll' },
        { id: 's2', source: 'enroll' },
        { id: 's3', source: 'enroll' },
      ],
    );
    assert.equal(db.executeSync('SELECT count(*) AS n FROM negative_shots').rows[0]?.n, 0);
    assert.equal(db.executeSync("SELECT value FROM app_meta WHERE key = 'schema_version'").rows[0]?.value, '2');
  });

  test('writes no confirm_below row, so every ACCEPT stays a question (TR-38, ADR-017)', () => {
    const db = phase1Catalog();
    migrate(db);
    assert.equal(db.executeSync("SELECT count(*) AS n FROM app_meta WHERE key = 'confirm_below'").rows[0]?.n, 0);
  });

  test('a fresh install runs every migration, and a second run changes nothing', () => {
    const db = openTestDatabase();
    assert.deepEqual(migrate(db), { from: 0, to: LATEST_SCHEMA_VERSION });
    assert.equal(LATEST_SCHEMA_VERSION, 2);
    assert.deepEqual(migrate(db), { from: 2, to: 2 });
  });

  test('negative_shots has no column that could name or price a negative (E-1)', () => {
    const db = openTestDatabase();
    migrate(db);
    assert.deepEqual(
      db.executeSync('PRAGMA table_info(negative_shots)').rows.map((c) => c.name),
      ['id', 'photo_path', 'model_id', 'embedding', 'source', 'created_at'],
    );
  });

  test("the CHECK lists accept exactly the domain's sources", () => {
    const db = openTestDatabase();
    migrate(db);
    db.executeSync("INSERT INTO products (id, name, price_piece, created_at, updated_at) VALUES ('p', 'Kape', 1000, 1, 1)");

    const shot = (id: string, source: string) =>
      db.executeSync(
        "INSERT INTO product_shots (id, product_id, photo_path, model_id, embedding, source, created_at) VALUES (?, 'p', 'photos/x.jpg', 'm', ?, ?, 1)",
        [id, blob(1), source],
      );
    SHOT_SOURCES.forEach((source, i) => shot(`s${i}`, source));
    assert.throws(() => shot('bad', 'guess'), /CHECK/);

    const negative = (id: string, source: string, embedding: ArrayBuffer | string = blob(1)) =>
      db.executeSync(
        "INSERT INTO negative_shots (id, photo_path, model_id, embedding, source, created_at) VALUES (?, 'photos/n.jpg', 'm', ?, ?, 1)",
        [id, embedding, source],
      );
    NEGATIVE_SOURCES.forEach((source, i) => negative(`n${i}`, source));
    assert.throws(() => negative('bad', 'guess'), /CHECK/);
    assert.throws(() => negative('text', 'confirm_no', 'not a blob'), /CHECK/);
  });

  test('a migration that fails part-way leaves the catalog at the last version that fully applied', () => {
    const db = phase1Catalog();
    const before = snapshot(db);
    const broken = [MIGRATIONS[0]!, { version: 2, statements: ['CREATE TABLE negative_shots (id TEXT)', 'THIS IS NOT SQL'] }];

    assert.throws(() => migrate(db, broken));

    assert.equal(db.executeSync("SELECT value FROM app_meta WHERE key = 'schema_version'").rows[0]?.value, '1');
    assert.equal(db.executeSync("SELECT count(*) AS n FROM sqlite_master WHERE name = 'negative_shots'").rows[0]?.n, 0);
    assert.deepEqual(snapshot(db), before);
  });
});
