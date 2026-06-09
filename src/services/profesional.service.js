const { getSupabase, isAvailable } = require('../lib/supabase');

async function registrarProfesional(telegramUserId, nombre) {
  if (!isAvailable()) return { ok: false, error: 'supabase_no_disponible' };
  const { error } = await getSupabase()
    .from('profesionales')
    .upsert({ telegram_user_id: String(telegramUserId), nombre, activo: true }, { onConflict: 'telegram_user_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function buscarProfesionalPorNombre(nombre) {
  if (!isAvailable() || !nombre) return null;
  const { data } = await getSupabase()
    .from('profesionales')
    .select('telegram_user_id, nombre')
    .eq('activo', true);
  if (!data?.length) return null;

  const query = nombre.toLowerCase().trim();
  return data.find(p => {
    const n = p.nombre.toLowerCase();
    return n === query || n.includes(query) || query.includes(n);
  }) || null;
}

async function notificarLlegadaPaciente(nombreProfesional, paciente, hora, servicio) {
  const profesional = await buscarProfesionalPorNombre(nombreProfesional);
  if (!profesional) return { ok: false, error: 'profesional_no_encontrado' };

  try {
    const { bot } = require('../lib/telegraf');
    const partes = [`✅ *Llegó tu paciente*`];
    if (paciente) partes.push(`👤 ${paciente}`);
    if (hora) partes.push(`🕐 ${hora}`);
    if (servicio) partes.push(`🦷 ${servicio}`);
    await bot.telegram.sendMessage(Number(profesional.telegram_user_id), partes.join('\n'), { parse_mode: 'Markdown' });
    return { ok: true };
  } catch (err) {
    console.error('[Profesional] Error enviando notificación:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { registrarProfesional, buscarProfesionalPorNombre, notificarLlegadaPaciente };
