/**
 * Structured logger with PII redaction. Never log token, email, uid, or full request payload.
 * Use for all server/route logs that might touch user data.
 */

const PII_KEYS = new Set([
  'uid', 'userId', 'email', 'token', 'authorization', 'toAddress', 'password',
  'body', 'payload', 'req', 'headers', 'messageId', 'accepted'
]);

function redactValue(val) {
  if (val == null) return val;
  if (typeof val === 'object' && !Array.isArray(val)) {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      const key = k.toLowerCase();
      if (PII_KEYS.has(key) || key.includes('email') || key.includes('token') || key.includes('password')) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactValue(v);
      }
    }
    return out;
  }
  if (Array.isArray(val)) return val.map(redactValue);
  return val;
}

function redact(meta) {
  if (meta == null) return meta;
  if (typeof meta === 'object') return redactValue(meta);
  return '[REDACTED]';
}

function format(level, message, meta) {
  if (meta !== undefined && meta !== null) {
    return [level, message, redact(meta)].filter(Boolean);
  }
  return [level, message];
}

module.exports = {
  redact,
  info(message, meta) {
    console.log(...format('INFO', message, meta));
  },
  warn(message, meta) {
    console.warn(...format('WARN', message, meta));
  },
  error(message, errOrMeta) {
    const meta = errOrMeta instanceof Error
      ? { code: errOrMeta.code, message: errOrMeta.message }
      : errOrMeta;
    console.error(...format('ERROR', message, meta));
  }
};
