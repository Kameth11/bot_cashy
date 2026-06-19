// Logger liviano sin dependencias: redacta secretos y emite JSON lines.
// info/warn -> stdout, error/audit -> stderr (para no perderlos en filtros stdout-only).

const REDACT_KEY_RE = /token|secret|password|code|jwt/i;

function redact(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (REDACT_KEY_RE.test(key) && value !== undefined && value !== null) {
      out[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redact(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function write(stream, level, scope, message, meta) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope, message, ...redact(meta) });
  stream(line);
}

function info(scope, message, meta) { write(console.log, 'info', scope, message, meta); }
function warn(scope, message, meta) { write(console.error, 'warn', scope, message, meta); }
function error(scope, message, meta) { write(console.error, 'error', scope, message, meta); }
function audit(event, meta) { write(console.error, 'audit', event, undefined, meta); }

module.exports = { info, warn, error, audit, redact };
