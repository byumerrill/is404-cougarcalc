const { createHash } = require('node:crypto');
const os = require('node:os');

const INSTANCE_MARKER_LENGTH = 12;

function createInstanceMarker(hostnameSource = os.hostname) {
  const hostname = hostnameSource();
  if (typeof hostname !== 'string' || hostname.length === 0) {
    throw new Error('A machine hostname is required to create the instance marker.');
  }

  return createHash('sha256')
    .update(hostname, 'utf8')
    .digest('hex')
    .slice(0, INSTANCE_MARKER_LENGTH);
}

module.exports = {
  INSTANCE_MARKER_LENGTH,
  createInstanceMarker
};
