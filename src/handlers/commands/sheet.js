const { bot } = require('../../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId } = require('../../auth');
const { getSheetId } = require('../../services/sheet.service');

function buildSheetUrl(sheetId) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

async function handleSheetCommand(ctx) {
  const userId = ctx.from.id;
  const sheetId = getSheetId(userId);

  if (!sheetId) {
    if (!obtenerClientePorUserId(userId) && !esAdminOriginal(userId)) {
      return ctx.reply('⚠️ No tienes una cuenta registrada. Usa /start para configurarla.');
    }
    return ctx.reply('❌ No encontré un Google Sheet configurado para esta cuenta.');
  }

  const url = buildSheetUrl(sheetId);

  return ctx.reply(
    '📄 Tu Google Sheet\n\n' +
    `ID: ${sheetId}\n` +
    `Link: ${url}`
  );
}

bot.command('sheet', handleSheetCommand);
bot.command('sheets', handleSheetCommand);

module.exports = {};
