const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'database',
    'migrations',
    '001-create-calculation-history.sql'
  ),
  'utf8'
);

test('migration 001 creates the complete Release 2 history table', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS/);
  assert.match(migration, /browser_token_hash text NOT NULL/i);
  assert.match(migration, /expression text NOT NULL/i);
  assert.match(migration, /result double precision NOT NULL/i);
});

test('migration 001 constrains hashes and creates only the scoped index', () => {
  assert.match(migration, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(
    migration,
    /CREATE INDEX IF NOT EXISTS calculation_history_browser_newest_idx/
  );
  assert.match(
    migration,
    /browser_token_hash,\s*calculated_at DESC,\s*calculation_id DESC/
  );
  assert.doesNotMatch(migration, /calculation_history_newest_idx/);
});
