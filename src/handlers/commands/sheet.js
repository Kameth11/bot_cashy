const { bot } = require('../../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId } = require('../../auth');
const { getSheetId } = require('../../services/sheet.service');
const textos = require('../../messages');

function buildSheetUrl(sheetId) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

async function handleSheetCommand(ctx) {
  const userId = ctx.from.id;
  const sheetId = getSheetId(userId);

  if (!sheetId) {
    if (!obtenerClientePorUserId(userId) && !esAdminOriginal(userId)) {
      return ctx.reply(textos.comandos.sheet.noTienesUnaCuentaRegistrada);
    }
    return ctx.reply(textos.comandos.sheet.noEncontreUnGoogleSheet);
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

module.exports = {
  handleSheetCommand,
  buildSheetUrl,
};
