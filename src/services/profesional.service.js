const { isAvailable } = require('../lib/supabase');
const { forTenant } = require('../lib/tenant-db');
const { escapeMarkdown } = require('../utils/formatter');
const logger = require('../lib/logger');
const { logFallo } = require('../lib/errores');
const { chatIdDe } = require('../lib/telegram-destino');

async function registrarProfesional(tenantId, telegramUserId, nombre, consultorio = null) {
  if (!isAvailable()) return { ok: false, error: 'supabase_no_disponible' };
  if (!tenantId) return { ok: false, error: 'tenant_no_resuelto' };

  const { error } = await forTenant(tenantId)
    .from('profesionales')
    .upsert({ telegram_user_id: String(telegramUserId), nombre, consultorio, activo: true }, { onConflict: 'telegram_user_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Todos los profesionales registrados del consultorio (para la pantalla de Config del dashboard).
async function listarProfesionales(tenantId) {
  if (!isAvailable() || !tenantId) return [];
  const { data } = await forTenant(tenantId)
    .from('profesionales')
    .select('telegram_user_id, nombre, consultorio, activo')
    .eq('activo', true)
    .order('nombre', { ascending: true });
  return (data || []).map(p => ({
    userId: String(p.telegram_user_id),
    nombre: p.nombre,
    consultorio: p.consultorio || null,
  }));
}

// Da de baja a un profesional (la persona sigue siendo usuaria; solo deja de recibir avisos de turnos).
async function eliminarProfesional(tenantId, userId) {
  if (!isAvailable()) return { ok: false, error: 'supabase_no_disponible' };
  if (!tenantId) return { ok: false, error: 'tenant_no_resuelto' };
  const { error } = await forTenant(tenantId)
    .from('profesionales')
    .delete()
    .eq('telegram_user_id', String(userId));
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Consultorios que algún profesional del tenant declaró al hacer /profesional
// (columna `consultorio` de la tabla, ver sql/migrations/010_profesionales_consultorio.sql).
// Reemplaza a CONSULTORIO_MAP (hardcodeado, un solo tenant) para resolver
// "Consultorio N" -> nombre del profesional al leer una agenda por foto.
async function listarConsultoriosAsignados(tenantId) {
  if (!isAvailable() || !tenantId) return [];
  const { data } = await forTenant(tenantId)
    .from('profesionales')
    .select('nombre, consultorio')
    .eq('activo', true)
    .not('consultorio', 'is', null);
  return data || [];
}

// Normaliza un nombre de profesional para compararlo: sin tildes, sin
// mayúsculas, sin títulos ("Dr.", "Dra", "Od.", "Lic.") ni puntuación. Así
// "Dra. María López" en /profesional matchea "maria" o "Maria Lopez" en la
// agenda (antes una tilde de un lado y no del otro alcanzaba para no avisar).
const TITULOS = new Set(['dr', 'dra', 'doc', 'doctor', 'doctora', 'od', 'odont', 'odontologo', 'odontologa', 'lic', 'prof']);

function normalizarNombreProfesional(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !TITULOS.has(t))
    .join(' ');
}

async function buscarProfesionalPorNombre(tenantId, nombre) {
  if (!isAvailable() || !nombre || !tenantId) return null;
  const { data } = await forTenant(tenantId)
    .from('profesionales')
    .select('telegram_user_id, nombre')
    .eq('activo', true);
  if (!data?.length) return null;

  const query = normalizarNombreProfesional(nombre);
  if (!query) return null;
  const candidatos = data.map(p => ({ p, n: normalizarNombreProfesional(p.nombre) })).filter(c => c.n);

  // Primero match exacto; después uno contiene al otro; por último, mismo
  // primer nombre ("Diego" en la agenda vs "Diego Pérez" registrado).
  const exacto = candidatos.find(c => c.n === query);
  if (exacto) return exacto.p;
  const contiene = candidatos.find(c => c.n.includes(query) || query.includes(c.n));
  if (contiene) return contiene.p;
  const primero = query.split(' ')[0];
  const mismoNombre = candidatos.filter(c => c.n.split(' ')[0] === primero);
  return mismoNombre.length === 1 ? mismoNombre[0].p : null;
}

async function notificarLlegadaPaciente(tenantId, nombreProfesional, paciente, hora, servicio) {
  if (!nombreProfesional) return { ok: false, error: 'sin_profesional' };
  if (!tenantId) {
    logger.warn('Profesional', 'Aviso de llegada sin tenant resuelto', { profesional: nombreProfesional });
    return { ok: false, error: 'tenant_no_resuelto' };
  }
  const profesional = await buscarProfesionalPorNombre(tenantId, nombreProfesional);
  if (!profesional) {
    logger.warn('Profesional', 'Aviso de llegada: profesional no registrado con /profesional', { profesional: nombreProfesional });
    return { ok: false, error: 'profesional_no_encontrado' };
  }

  // Un profesional que se registró desde la web puede no tener Telegram (ID negativo sin vincular):
  // no es un fallo, simplemente no hay a dónde mandarle por acá (le llega por la campanita/push).
  const chatId = chatIdDe(profesional.telegram_user_id);
  if (!chatId) return { ok: false, error: 'sin_telegram', profesional: profesional.nombre };

  try {
    const { bot } = require('../lib/telegraf');
    const partes = [`✅ *Llegó tu paciente*`];
    if (paciente) partes.push(`👤 ${escapeMarkdown(paciente)}`);
    if (hora) partes.push(`🕐 ${escapeMarkdown(hora)}`);
    if (servicio) partes.push(`🦷 ${escapeMarkdown(servicio)}`);
    await bot.telegram.sendMessage(chatId, partes.join('\n'), { parse_mode: 'Markdown' });
    return { ok: true, profesional: profesional.nombre };
  } catch (err) {
    // Telegram rechazó el mensaje: 403 = bloqueó el bot, 400 "chat not found" = nunca lo inició. Es algo
    // esperable de la persona (no del código) y no merece una alerta: se deja como warn, con el motivo.
    const codigo = err && err.response && err.response.error_code;
    if (codigo === 403 || (codigo === 400 && /chat not found/i.test(err.response.description || ''))) {
      logger.warn('Profesional', 'No se pudo avisar por Telegram: el profesional bloqueó el bot o nunca lo inició (le llega por la campanita/push)', {
        profesional: profesional.nombre, codigo, err: String(err.response.description || err.message).slice(0, 120),
      });
      return { ok: false, error: 'telegram_inaccesible', profesional: profesional.nombre };
    }
    // Cualquier otra cosa (formato rechazado, error de código, red): logFallo decide la severidad y
    // `codigo`/`descripcion` de Telegram quedan en el log para poder diagnosticarlo.
    logFallo('Profesional', 'Error enviando aviso de llegada', err, {
      profesional: profesional.nombre, codigo, descripcion: err && err.response ? String(err.response.description || '').slice(0, 120) : undefined,
    });
    return { ok: false, error: 'envio_fallido', profesional: profesional.nombre };
  }
}

module.exports = { registrarProfesional, listarProfesionales, eliminarProfesional, buscarProfesionalPorNombre, normalizarNombreProfesional, notificarLlegadaPaciente, listarConsultoriosAsignados };
