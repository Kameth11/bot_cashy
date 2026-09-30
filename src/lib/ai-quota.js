// Cuota diaria de uso de IA (Gemini/OpenRouter) por consultorio (dueño + sus
// invitados comparten el cupo). Sin esto cualquier invitado podía consumir sin
// tope la API key del negocio, y no había forma de acotar ni atribuir el costo
// por cliente. Los límites son por día calendario argentino.
//
// En memoria: se reinicia con cada deploy (aceptable como freno de abuso; si
// pasa a ser una restricción comercial, persistir en Supabase). Límite 0 =
// sin tope. Se configuran por env sin redeploy de código.

const { obtenerClientePorUserId } = require('../auth');
const dateUtils = require('../utils/date');
const logger = require('./logger');

const DEFAULTS = { texto: 300, media: 60 };
const ENV = { texto: 'AI_LIMIT_TEXTO_DIA', media: 'AI_LIMIT_MEDIA_DIA' };

function limiteDe(tipo) {
  const raw = process.env[ENV[tipo]];
  if (raw === undefined || raw === '') return DEFAULTS[tipo];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULTS[tipo];
}

const usos = new Map(); // `${ownerId}:${tipo}` -> { dia, usado, avisado }

function ownerKey(userId) {
  const cliente = obtenerClientePorUserId(userId);
  return String(cliente ? cliente.ownerId : userId);
}

// Intenta consumir 1 unidad. Devuelve { ok, usado, limite, avisar }: `avisar`
// es true solo la primera vez del día que se supera el tope (para avisar al
// usuario una vez, no en cada mensaje).
function consumir(userId, tipo) {
  const limite = limiteDe(tipo);
  if (limite === 0) return { ok: true, usado: 0, limite: 0, avisar: false };

  const key = `${ownerKey(userId)}:${tipo}`;
  const dia = dateUtils.fechaArgentinaStr();
  let e = usos.get(key);
  if (!e || e.dia !== dia) {
    e = { dia, usado: 0, avisado: false };
    usos.set(key, e);
    purgarDiasViejos(dia);
  }

  if (e.usado >= limite) {
    const avisar = !e.avisado;
    if (avisar) {
      e.avisado = true;
      logger.audit('ai_quota_exceeded', { ownerId: ownerKey(userId), tipo, limite });
    }
    return { ok: false, usado: e.usado, limite, avisar };
  }

  e.usado += 1;
  return { ok: true, usado: e.usado, limite, avisar: false };
}

function purgarDiasViejos(dia) {
  for (const [k, v] of usos) if (v.dia !== dia) usos.delete(k);
}

function reiniciar() { usos.clear(); }

module.exports = { consumir, limiteDe, reiniciar };
