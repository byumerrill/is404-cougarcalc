const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  REQUIRED_ENTRIES,
  buildBundle,
  inspectBundle,
  validateEntryNames
} = require('../scripts/deployment-bundle');

const projectRoot = path.resolve(__dirname, '..');

test('the deterministic deployment bundle contains exactly the runtime allowlist', () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'cougarcalc-bundle-test-')
  );
  const firstPath = path.join(temporaryDirectory, 'first.zip');
  const secondPath = path.join(temporaryDirectory, 'second.zip');

  try {
    const first = buildBundle({ root: projectRoot, outputPath: firstPath });
    const second = buildBundle({ root: projectRoot, outputPath: secondPath });
    const listing = inspectBundle(firstPath);

    assert.deepEqual(
      listing.map(({ name }) => name),
      REQUIRED_ENTRIES
    );
    assert.deepEqual(first.listing, listing);
    assert.deepEqual(second.listing, listing);
    assert.equal(listing[0].name, 'app.js');
    assert.equal(listing.some(({ name }) => name.endsWith('.md')), false);
    assert.equal(listing.some(({ name }) => name.includes('node_modules')), false);
    assert.equal(listing.some(({ name }) => name.startsWith('test/')), false);
    assert.equal(listing.some(({ name }) => name.startsWith('.git/')), false);
    assert.equal(listing.some(({ name }) => /(^|\/)\.env/.test(name)), false);
    assert.equal(listing.some(({ name }) => name === 'package.json'), true);
    assert.equal(
      listing.some(({ name }) => name === 'database/certs/global-bundle.pem'),
      true
    );
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(firstPath)).digest('hex'),
      crypto.createHash('sha256').update(fs.readFileSync(secondPath)).digest('hex')
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('bundle validation fails closed for local, documentation, and credential paths', () => {
  const forbidden = [
    'guide.md',
    'docs/nested/guide.MD',
    '.env',
    '.env.production',
    '.git/config',
    'node_modules/express/index.js',
    'test/app.test.js',
    'credentials',
    'private-key.pem',
    '../app.js',
    'parent/app.js'
  ];

  for (const entry of forbidden) {
    assert.throws(
      () => validateEntryNames([...REQUIRED_ENTRIES, entry]),
      /not allowed|Unsafe|differ|unexpected/
    );
  }
  assert.throws(
    () => validateEntryNames(REQUIRED_ENTRIES.filter((name) => name !== 'app.js')),
    /missing|differ/
  );
});

test('.ebignore excludes local state and Markdown at every depth', () => {
  const ebignore = fs.readFileSync(path.join(projectRoot, '.ebignore'), 'utf8');

  for (const pattern of [
    '.git/',
    '.env',
    'node_modules/',
    'test/',
    'dist/',
    '*.md',
    '**/*.md'
  ]) {
    assert.match(ebignore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
});

test('package metadata pins the Node.js major and patched transitive dependency', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  );
  const packageLock = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8')
  );

  assert.equal(packageJson.engines.node, '22.x');
  assert.equal(packageLock.packages[''].engines.node, '22.x');
  assert.equal(packageJson.overrides['body-parser'], '1.20.6');
  assert.equal(
    packageLock.packages['node_modules/body-parser'].version,
    '1.20.6'
  );
  assert.equal(packageJson.scripts.bundle, 'node scripts/deployment-bundle.js');
  assert.equal(
    packageJson.scripts['bundle:inspect'],
    'node scripts/deployment-bundle.js --inspect'
  );
});
