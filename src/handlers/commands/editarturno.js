const { bot } = require('../../lib/telegraf');
const { Markup } = require('telegraf');
const { obtenerTurnosPorFecha, fechaHoyStr } = require('../../services/agenda.service');
const state = require('../../state');

bot.command('editarturno', async (ctx) => {
  const userId = ctx.from.id;

  let turnos;
  try {
    turnos = await obtenerTurnosPorFecha(userId, fechaHoyStr());
  } catch {
    return ctx.reply('❌ No se pudo acceder a la agenda. ¿Está configurado el sheet?');
  }

  if (!turnos || turnos.length === 0) {
    return ctx.reply('📅 No hay turnos cargados para hoy.');
  }

  state.pendingTurnoEdits.set(userId, { step: 'select_turno', turnos });

  const botones = turnos.map((t, i) => {
    const hora = t.hora ? t.hora.substring(0, 5) : '??:??';
    const nombre = t.cliente || 'Sin nombre';
    const label = `${hora} · ${nombre.length > 20 ? nombre.substring(0, 20) + '…' : nombre}`;
    return [Markup.button.callback(label, `agenda_edit_pick_${i}`)];
  });
  botones.push([Markup.button.callback('❌ Cancelar', 'agenda_edit_cancel')]);

  return ctx.reply('📅 *¿Qué turno querés editar?*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(botones),
  });
});

module.exports = {};
