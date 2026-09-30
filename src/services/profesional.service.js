const { isAvailable } = require('../lib/supabase');
const { forTenant } = require('../lib/tenant-db');
const { escapeMarkdown } = require('../utils/formatter');
const logger = require('../lib/logger');

async function registrarProfesional(tenantId, telegramUserId, nombre, consultorio = null) {
  if (!isAvailable()) return { ok: false, error: 'supabase_no_disponible' };
  if (!tenantId) return { ok: false, error: 'tenant_no_resuelto' };

  const { error } = await forTenant(tenantId)
    .from('profesionales')
    .upsert({ telegram_user_id: String(telegramUserId), nombre, consultorio, activo: true }, { onConflict: 'telegram_user_id' });
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

  try {
    const { bot } = require('../lib/telegraf');
    const partes = [`✅ *Llegó tu paciente*`];
    if (paciente) partes.push(`👤 ${escapeMarkdown(paciente)}`);
    if (hora) partes.push(`🕐 ${escapeMarkdown(hora)}`);
    if (servicio) partes.push(`🦷 ${escapeMarkdown(servicio)}`);
    await bot.telegram.sendMessage(Number(profesional.telegram_user_id), partes.join('\n'), { parse_mode: 'Markdown' });
    return { ok: true, profesional: profesional.nombre };
  } catch (err) {
    // Típico: el profesional nunca le escribió al bot o lo bloqueó (403).
    logger.error('Profesional', 'Error enviando aviso de llegada', { profesional: profesional.nombre, err: err.message });
    return { ok: false, error: 'envio_fallido', profesional: profesional.nombre };
  }
}

module.exports = { registrarProfesional, buscarProfesionalPorNombre, normalizarNombreProfesional, notificarLlegadaPaciente, listarConsultoriosAsignados };
