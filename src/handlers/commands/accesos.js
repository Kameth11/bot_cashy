const { Markup } = require('telegraf');
const { bot } = require('../../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId } = require('../../auth');
const { PRESETS, ADMIN_PERMISOS, DEFAULT_PERMISOS, detectarPreset } = require('../../auth/permisos');
const { setPermisos } = require('../../services/cliente.service');
const clienteService = require('../../services/cliente.service');
const logger = require('../../lib/logger');

const PRESET_LABELS = {
  odontologo: 'Odontólogo',
  recepcion:  'Recepción',
  contadora:  'Contadora',
};

function formatearPermisos(permisos) {
  const preset = detectarPreset(permisos);
  if (preset) return PRESET_LABELS[preset] || preset;
  if (permisos.length === 0) return 'Sin permisos';
  return `${permisos.length} permisos custom`;
}

function buildAccesosKeyboard(ownerKey, guestId) {
  const buttons = Object.entries(PRESET_LABELS).map(([key, label]) =>
    Markup.button.callback(label, `accesos_preset:${ownerKey}:${guestId}:${key}`)
  );
  return Markup.inlineKeyboard([buttons]);
}

bot.command('accesos', async (ctx) => {
  const userId = ctx.from.id;

  if (!esAdminOriginal(userId)) {
    const cliente = obtenerClientePorUserId(userId);
    if (!cliente?.isOwner) {
      return ctx.reply('⛔ Solo el dueño del consultorio puede gestionar accesos.');
    }
  }

  const ownerKey = esAdminOriginal(userId)
    ? String(userId)
    : String(obtenerClientePorUserId(userId).ownerId);

  const owner = clienteService.clientes[ownerKey];
  if (!owner) return ctx.reply('❌ No se encontró el perfil del consultorio.');

  const invitados = owner.usuarios || [];
  if (invitados.length === 0) {
    return ctx.reply(
      '👥 *Accesos del consultorio*\n\n' +
      'No hay miembros invitados todavía.\n' +
      'Usá /codigo para invitar a alguien.',
      { parse_mode: 'Markdown' }
    );
  }

  let mensaje = '👥 *Accesos del consultorio*\n\n';
  const botones = [];

  for (const guestId of invitados) {
    const guestKey = String(guestId);
    const perms = (owner.permisos || {})[guestKey] || DEFAULT_PERMISOS;
    const label = formatearPermisos(perms);
    mensaje += `• ID \`${guestKey.slice(-4)}\` → ${label}\n`;
    botones.push([
      Markup.button.callback(
        `✏️ Cambiar ID ${guestKey.slice(-4)}`,
        `accesos_elegir:${ownerKey}:${guestKey}`
      ),
    ]);
  }

  mensaje += '\n_Tocá un botón para cambiar el rol de un miembro._';

  return ctx.reply(mensaje, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(botones),
  });
});

// Callback: mostrar presets para un invitado específico
bot.action(/^accesos_elegir:(.+):(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const [, ownerKey, guestKey] = ctx.match;

  if (!esAdminOriginal(ctx.from.id)) {
    const cliente = obtenerClientePorUserId(ctx.from.id);
    if (!cliente?.isOwner || String(cliente.ownerId) !== ownerKey) {
      return ctx.answerCbQuery('Sin permiso');
    }
  }

  const owner = clienteService.clientes[ownerKey];
  const permsActuales = (owner?.permisos || {})[guestKey] || DEFAULT_PERMISOS;
  const presetActual = detectarPreset(permsActuales) || 'custom';

  await ctx.editMessageText(
    `👤 *ID \`${guestKey.slice(-4)}\`*\n\nRol actual: *${PRESET_LABELS[presetActual] || presetActual}*\n\nElegí el nuevo rol:`,
    {
      parse_mode: 'Markdown',
      ...buildAccesosKeyboard(ownerKey, guestKey),
    }
  );
});

// Callback: aplicar preset elegido
bot.action(/^accesos_preset:(.+):(.+):(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const [, ownerKey, guestKey, presetKey] = ctx.match;

  if (!esAdminOriginal(ctx.from.id)) {
    const cliente = obtenerClientePorUserId(ctx.from.id);
    if (!cliente?.isOwner || String(cliente.ownerId) !== ownerKey) {
      return ctx.answerCbQuery('Sin permiso');
    }
  }

  if (!PRESETS[presetKey]) return ctx.answerCbQuery('Preset inválido');

  try {
    await setPermisos(ownerKey, guestKey, PRESETS[presetKey]);
    logger.audit('permisos_updated_telegram', { adminId: ctx.from.id, targetId: guestKey, preset: presetKey });
    await ctx.editMessageText(
      `✅ ID \`${guestKey.slice(-4)}\` → *${PRESET_LABELS[presetKey]}*\n\nPermisos actualizados. El cambio impacta en el próximo login del usuario.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error('CMD', 'Error en accesos_preset', { err: err.message });
    await ctx.editMessageText('❌ Error al guardar permisos. Intentá de nuevo.');
  }
});

module.exports = {};
