// Login "Entrar con Telegram" (deep link + confirmación en el bot).
//
// El navegador crea una solicitud y recibe DOS cosas distintas:
//   - `id`:     público, va en el link/QR (t.me/<bot>?start=login_<id>).
//   - `secret`: solo lo conoce ese navegador; es lo que permite esperar la
//               aprobación y recibir la sesión. Quien vea el QR o el link no puede
//               obtener la sesión de otro.
// La persona aprueba desde el bot; la identidad que se aprueba sale de Telegram
// (ctx.from.id), nunca del link. La sesión se entrega UNA sola vez.
//
// Estado en memoria con TTL corto: el bot y la API son el mismo proceso (una sola
// instancia) y un redeploy en medio de un login solo obliga a reintentar. Con
// varias instancias haría falta un almacén compartido (ver ARCHITECTURE.md).

const crypto = require('crypto');

const TTL_MS = 5 * 60 * 1000;
const MAX_PENDIENTES = 1000;
const ID_REGEX = /^[A-Za-z0-9_-]{22}$/;

// id -> { secretHash, expiraEn, estado, userId, ip, userAgent, creadaEn }
const solicitudes = new Map();

const hashSecret = (secret) => crypto.createHash('sha256').update(String(secret || '')).digest();

function purgarVencidas(ahora = Date.now()) {
  for (const [id, s] of solicitudes) {
    if (ahora > s.expiraEn) solicitudes.delete(id);
  }
}

// "Chrome en Windows", para mostrarle a la persona desde dónde se pidió el ingreso.
function resumirUserAgent(ua) {
  const s = String(ua || '');
  let navegador = 'Navegador desconocido';
  if (/Edg\//.test(s)) navegador = 'Edge';
  else if (/OPR\/|Opera/.test(s)) navegador = 'Opera';
  else if (/Firefox\/|FxiOS/.test(s)) navegador = 'Firefox';
  else if (/Chrome\/|CriOS/.test(s)) navegador = 'Chrome';
  else if (/Safari\//.test(s)) navegador = 'Safari';

  let sistema = '';
  if (/iPhone/.test(s)) sistema = 'iPhone';
  else if (/iPad/.test(s)) sistema = 'iPad';
  else if (/Android/.test(s)) sistema = 'Android';
  else if (/Windows/.test(s)) sistema = 'Windows';
  else if (/Macintosh|Mac OS X/.test(s)) sistema = 'Mac';
  else if (/CrOS/.test(s)) sistema = 'ChromeOS';
  else if (/Linux/.test(s)) sistema = 'Linux';

  return sistema ? `${navegador} en ${sistema}` : navegador;
}

function crearSolicitud({ ip, userAgent, google = null } = {}) {
  purgarVencidas();
  if (solicitudes.size >= MAX_PENDIENTES) throw new Error('demasiadas_solicitudes');

  const id = crypto.randomBytes(16).toString('base64url'); // 22 caracteres
  const secret = crypto.randomBytes(32).toString('base64url');
  const ahora = Date.now();
  solicitudes.set(id, {
    secretHash: hashSecret(secret),
    expiraEn: ahora + TTL_MS,
    estado: 'pendiente',
    userId: null,
    ip: String(ip || ''),
    userAgent: String(userAgent || '').slice(0, 200),
    creadaEn: ahora,
    // Si viene de "Entrar con Google" sin cuenta vinculada: qué cuenta de Google se
    // vincularía al aprobar. Nunca sale al navegador (el `sub` queda solo en el servidor).
    google: google && google.sub ? { sub: String(google.sub), email: String(google.email || ''), nombre: String(google.nombre || '') } : null,
  });
  return { id, secret, expiraEnSeg: Math.round(TTL_MS / 1000) };
}

function vigente(id) {
  if (!ID_REGEX.test(String(id || ''))) return null;
  const s = solicitudes.get(id);
  if (!s) return null;
  if (Date.now() > s.expiraEn) {
    solicitudes.delete(id);
    return null;
  }
  return s;
}

// Lo que se le muestra a la persona en el bot antes de aprobar. null si no
// existe, venció o ya se resolvió.
function obtenerParaAprobar(id) {
  const s = vigente(id);
  if (!s || s.estado !== 'pendiente') return null;
  return {
    id,
    ip: s.ip,
    userAgent: s.userAgent,
    navegador: resumirUserAgent(s.userAgent),
    creadaEn: s.creadaEn,
    google: s.google ? { sub: s.google.sub, email: s.google.email, nombre: s.google.nombre } : null,
  };
}

// Atómico e idempotente: solo se aprueba una solicitud pendiente y vigente.
function aprobar(id, userId) {
  const s = vigente(id);
  if (!s || s.estado !== 'pendiente') return false;
  s.estado = 'aprobada';
  s.userId = String(userId);
  return true;
}

function rechazar(id) {
  const s = vigente(id);
  if (!s || s.estado !== 'pendiente') return false;
  s.estado = 'rechazada';
  return true;
}

/**
 * Lo que consulta el navegador. Nunca revela por qué falló: un id o un secret
 * inválidos se ven igual que una solicitud vencida.
 * @returns {{estado:'pendiente'} | {estado:'aprobada', userId:string} | {estado:'rechazada'} | {estado:'vencida'}}
 */
function consultar(id, secret) {
  const s = vigente(id);
  if (!s) return { estado: 'vencida' };

  const esperado = s.secretHash;
  const recibido = hashSecret(secret);
  if (!crypto.timingSafeEqual(esperado, recibido)) return { estado: 'vencida' };

  if (s.estado === 'pendiente') return { estado: 'pendiente' };

  // Se entrega una sola vez: la solicitud desaparece apenas se informa.
  solicitudes.delete(id);
  if (s.estado === 'aprobada') return { estado: 'aprobada', userId: s.userId };
  return { estado: 'rechazada' };
}

function _reiniciar() { solicitudes.clear(); }
function _cantidad() { return solicitudes.size; }
// Solo para tests: lo que realmente queda guardado.
function _volcar() {
  return [...solicitudes].map(([id, s]) => ({ id, ...s, secretHash: s.secretHash.toString('hex') }));
}

module.exports = {
  TTL_MS,
  MAX_PENDIENTES,
  ID_REGEX,
  crearSolicitud,
  obtenerParaAprobar,
  aprobar,
  rechazar,
  consultar,
  resumirUserAgent,
  purgarVencidas,
  _reiniciar,
  _cantidad,
  _volcar,
};
