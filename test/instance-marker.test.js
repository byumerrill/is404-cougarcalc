const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INSTANCE_MARKER_LENGTH,
  createInstanceMarker
} = require('../instance-marker');

test('instance markers are deterministic short hashes without raw hostnames', () => {
  const hostname = 'ip-10-0-1-42.us-west-2.compute.internal';
  const marker = createInstanceMarker(() => hostname);

  assert.equal(marker.length, INSTANCE_MARKER_LENGTH);
  assert.match(marker, /^[0-9a-f]{12}$/);
  assert.equal(marker, createInstanceMarker(() => hostname));
  assert.equal(marker.includes(hostname), false);
});

test('different supplied hostnames normally produce different markers', () => {
  assert.notEqual(
    createInstanceMarker(() => 'test-instance-a'),
    createInstanceMarker(() => 'test-instance-b')
  );
});

test('instance marker creation rejects an unavailable hostname safely', () => {
  for (const hostname of ['', null, undefined]) {
    assert.throws(
      () => createInstanceMarker(() => hostname),
      /machine hostname is required/
    );
  }
});
