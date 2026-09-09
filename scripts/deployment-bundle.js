const fs = require('node:fs');
const path = require('node:path');

const BUNDLE_FILE_NAME = 'cougarcalc-release-03.zip';
const REQUIRED_ENTRIES = Object.freeze([
  'app.js',
  'browser-identity.js',
  'cougar-icon-v2.png',
  'database-diagnostics.js',
  'database.js',
  'database/certs/global-bundle.pem',
  'database/migrations/001-create-calculation-history.sql',
  'instance-marker.js',
  'package-lock.json',
  'package.json',
  'public/calculator-logic.js',
  'public/index.html'
]);
const RDS_CA_ENTRY = 'database/certs/global-bundle.pem';
const DOS_DATE_1980_01_01 = 0x0021;

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  }
  return (value ^ 0xffffffff) >>> 0;
}

function validateEntryNames(entryNames) {
  const seen = new Set();
  for (const name of entryNames) {
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      name.includes('\\') ||
      name.startsWith('/') ||
      path.posix.normalize(name) !== name ||
      name.split('/').includes('..')
    ) {
      throw new Error(`Unsafe deployment bundle path: ${name}`);
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate deployment bundle entry: ${name}`);
    }
    seen.add(name);

    if (/\.md$/i.test(name)) {
      throw new Error(`Markdown is not allowed in the deployment bundle: ${name}`);
    }
    if (/(^|\/)(\.git|node_modules|tests?|coverage)(\/|$)/i.test(name)) {
      throw new Error(`Local-only path is not allowed in the deployment bundle: ${name}`);
    }
    if (/(^|\/)\.env(?:\.|$)/i.test(name)) {
      throw new Error(`Environment files are not allowed in the deployment bundle: ${name}`);
    }
    if (
      name !== RDS_CA_ENTRY &&
      (/\.(?:pem|key|p12|pfx)$/i.test(name) ||
        /(^|\/)(?:credentials|id_rsa|id_ed25519)(?:\.|$)/i.test(name))
    ) {
      throw new Error(`Credential-like file is not allowed in the deployment bundle: ${name}`);
    }
  }

  const expected = [...REQUIRED_ENTRIES].sort();
  const actual = [...entryNames].sort();
  if (actual.length !== expected.length) {
    throw new Error('Deployment bundle has missing or unexpected entries.');
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(
        `Deployment bundle entries differ from the allowlist near ${actual[index] || '(missing)'}.`
      );
    }
  }
}

function validateEntryData(name, data) {
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new Error(`Required deployment file is empty: ${name}`);
  }

  const content = data.toString('utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    throw new Error(`Private key material detected in deployment file: ${name}`);
  }
  if (/\bAKIA[0-9A-Z]{16}\b/.test(content)) {
    throw new Error(`AWS access-key-shaped content detected in deployment file: ${name}`);
  }
  if (name === RDS_CA_ENTRY) {
    if (
      !content.includes('-----BEGIN CERTIFICATE-----') ||
      content.includes('PRIVATE KEY')
    ) {
      throw new Error('The bundled RDS CA file is not a public certificate bundle.');
    }
  }
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBuffer);

    localOffset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function readStoredZip(zipBuffer) {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) {
    throw new Error('Deployment bundle is not a valid ZIP archive.');
  }

  const endOffset = zipBuffer.length - 22;
  if (zipBuffer.readUInt32LE(endOffset) !== 0x06054b50) {
    throw new Error('Deployment bundle ZIP directory is missing.');
  }

  const entryCount = zipBuffer.readUInt16LE(endOffset + 10);
  let centralOffset = zipBuffer.readUInt32LE(endOffset + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (zipBuffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error('Deployment bundle central directory is invalid.');
    }
    const method = zipBuffer.readUInt16LE(centralOffset + 10);
    const checksum = zipBuffer.readUInt32LE(centralOffset + 16);
    const compressedSize = zipBuffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(centralOffset + 24);
    const nameLength = zipBuffer.readUInt16LE(centralOffset + 28);
    const extraLength = zipBuffer.readUInt16LE(centralOffset + 30);
    const commentLength = zipBuffer.readUInt16LE(centralOffset + 32);
    const localOffset = zipBuffer.readUInt32LE(centralOffset + 42);
    const name = zipBuffer
      .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
      .toString('utf8');

    if (method !== 0 || compressedSize !== uncompressedSize) {
      throw new Error(`Deployment bundle entry is not deterministically stored: ${name}`);
    }
    if (zipBuffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Deployment bundle local entry is invalid: ${name}`);
    }
    const localNameLength = zipBuffer.readUInt16LE(localOffset + 26);
    const localExtraLength = zipBuffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const data = zipBuffer.subarray(dataOffset, dataOffset + uncompressedSize);
    if (data.length !== uncompressedSize || crc32(data) !== checksum) {
      throw new Error(`Deployment bundle entry checksum failed: ${name}`);
    }

    entries.push({ name, data });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function inspectBundle(bundlePath) {
  const entries = readStoredZip(fs.readFileSync(bundlePath));
  validateEntryNames(entries.map(({ name }) => name));
  for (const { name, data } of entries) {
    validateEntryData(name, data);
  }
  return entries.map(({ name, data }) => ({ name, size: data.length }));
}

function buildBundle({
  root = path.resolve(__dirname, '..'),
  outputPath = path.join(root, 'dist', BUNDLE_FILE_NAME)
} = {}) {
  validateEntryNames(REQUIRED_ENTRIES);
  const entries = REQUIRED_ENTRIES.map((name) => {
    const sourcePath = path.join(root, ...name.split('/'));
    const stat = fs.lstatSync(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Deployment source must be a regular file: ${name}`);
    }
    const data = fs.readFileSync(sourcePath);
    validateEntryData(name, data);
    return { name, data };
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, createStoredZip(entries));
  const listing = inspectBundle(outputPath);
  return { outputPath, listing };
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const outputPath = path.join(root, 'dist', BUNDLE_FILE_NAME);
    const result = process.argv.includes('--inspect')
      ? { outputPath, listing: inspectBundle(outputPath) }
      : buildBundle({ root, outputPath });
    console.log(`Verified deployment bundle: ${result.outputPath}`);
    for (const entry of result.listing) {
      console.log(`${entry.name} (${entry.size} bytes)`);
    }
  } catch (error) {
    console.error(`Deployment bundle failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  BUNDLE_FILE_NAME,
  REQUIRED_ENTRIES,
  buildBundle,
  inspectBundle,
  readStoredZip,
  validateEntryNames
};
