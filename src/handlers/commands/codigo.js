const { bot } = require('../../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId } = require('../../auth');
const { CODIGO_EXPIRACION_HORAS } = require('../../config');
const state = require('../../state');

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

bot.command('codigo', (ctx) => {
  const userId = ctx.from.id;

  if (esAdminOriginal(userId)) {
    const codigo = generateInviteCode();
    state.pendingCodigos.set(codigo, {
      ownerId: userId,
      createdAt: Date.now()
    });

    ctx.reply(
      `🔑 *Código de invitación*\n\n` +
      `Comparte este código (vigencia ${CODIGO_EXPIRACION_HORAS}h):\n\n` +
      `*${codigo}*\n\n` +
      `La persona debe usar /start y luego ingresar el código.`,
      { parse_mode: 'Markdown' }
    );
  } else {
    const cliente = obtenerClientePorUserId(userId);
    if (!cliente) {
      return ctx.reply('⚠️ No tienes una cuenta registrada.');
    }

    const ownerId = parseInt(cliente.ownerId);

    if (ownerId !== userId) {
      return ctx.reply('⚠️ Solo el owner puede generar códigos de invitación.');
    }

    const codigo = generateInviteCode();
    state.pendingCodigos.set(codigo, {
      ownerId: ownerId,
      createdAt: Date.now()
    });

    ctx.reply(
      `🔑 *Código de invitación*\n\n` +
      `Comparte este código (vigencia ${CODIGO_EXPIRACION_HORAS}h):\n\n` +
      `*${codigo}*\n\n` +
      `La persona debe usar /start y luego ingresar el código.`,
      { parse_mode: 'Markdown' }
    );
  }
});

module.exports = { generateInviteCode };
