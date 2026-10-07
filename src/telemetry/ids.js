import crypto from 'node:crypto';

/**
 * Generate a 32-character lowercase hex string for W3C trace context.
 */
export function newTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a 16-character lowercase hex string for W3C span context.
 */
export function newSpanId() {
  return crypto.randomBytes(8).toString('hex');
}
