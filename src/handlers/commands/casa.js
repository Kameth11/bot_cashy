/**
 * /casa — gastos compartidos entre varias personas ("CASA", "CASA DINAMARCA"...).
 *
 *   /casa                       resumen del mes y saldos de la casa activa
 *   /casa nueva <nombre>        crear una casa
 *   /casa lista                 mis casas
 *   /casa usar <nombre>         cambiar la casa activa
 *   /casa miembros              quiénes están
 *   /casa agregar <nombre>      sumar a alguien SIN Telegram (participa del reparto)
 *   /casa invitar [nombre]      código para que otra cuenta se una (o reclame a un miembro)
 *   /casa unir <código> [alias] unirme con un código (igual que /unir)
 *   /casa saldo                 quién le debe a quién
 *   /casa saldar <quién> <monto> [moneda]   registrar que le pagué a alguien
 *   /casa quitar <nombre> | /casa salir
 *
 * Los datos y los permisos los resuelve casa.service; acá solo hay texto.
 */

const { bot } = require('../../lib/telegraf');
const logger = require('../../lib/logger');
const { escapeMarkdown, sanitizarInput } = require('../../utils/formatter');
const casaService = require('../../services/casa.service');
const casaInvite = require('../../services/casa-invite.service');
const { obtenerClientePorUserId } = require('../../auth');
const { buscarMiembro, buscarCasa, parsearSaldar, normalizar } = require('../../lib/casa-parse');
const { fmt, formatearSaldos, mensajeError } = require('../../lib/casa-format');

const { CasaError } = casaService;

// ── Formato ──────────────────────────────────────────────────────────────────

function construirResumen(r, { otrasCasas = [] } = {}) {
  let msg = `🏠 *${escapeMarkdown(r.casa.nombre)}* — ${r.mes}\n`;
  msg += `👥 ${r.miembros.map((m) => escapeMarkdown(m.nombre)).join(', ')}\n\n`;

  const monedas = Object.keys(r.gastosPorMoneda);
  if (monedas.length === 0) {
    msg += '💸 Sin gastos este mes.\n';
  } else {
    msg += `💸 *Gastos del mes:* ${monedas.map((m) => fmt(r.gastosPorMoneda[m], m)).join(' + ')} (${r.cantidad} mov.)\n`;
    const cats = Object.entries(r.porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (cats.length) msg += cats.map(([c, v]) => `  • ${escapeMarkdown(c)}: ${fmt(v)}`).join('\n') + '\n';
  }

  msg += `\n${formatearSaldos(r.saldos)}`;
  if (otrasCasas.length) {
    msg += `\n\n_Otras casas: ${otrasCasas.map((c) => escapeMarkdown(c.nombre)).join(', ')} — cambiá con_ \`/casa usar <nombre>\``;
  }
  return msg;
}

const AYUDA =
  '🏠 *Casa — gastos compartidos*\n\n' +
  '`/casa` — resumen del mes y saldos\n' +
  '`/casa nueva Casa Dinamarca` — crear una casa\n' +
  '`/casa lista` · `/casa usar <nombre>` — mis casas / cambiar de casa\n' +
  '`/casa miembros` — quiénes están\n' +
  '`/casa agregar Tomás` — sumar a alguien sin Telegram\n' +
  '`/casa invitar` — código para que otra cuenta se una\n' +
  '`/unir CODIGO` — unirte con un código\n' +
  '`/casa saldo` — quién le debe a quién\n' +
  '`/casa saldar Ana 5000` — registrar que le pagaste a Ana\n' +
  '`/casa quitar <nombre>` · `/casa salir`\n\n' +
  '_Para cargar un gasto escribilo con la palabra "casa": `super 45000 casa`._';

async function responder(ctx, texto) {
  try {
    return await ctx.reply(texto, { parse_mode: 'Markdown' });
  } catch (_) {
    return ctx.reply(texto.replace(/[`*_[\]\\]/g, '')).catch(() => {});
  }
}

function aliasDe(ctx) {
  const nombre = sanitizarInput(ctx.from && ctx.from.first_name, 40);
  return nombre.length >= 2 ? nombre : 'Yo';
}

// ── Casa activa / búsqueda ───────────────────────────────────────────────────

async function conCasaActiva(ctx) {
  const entrada = casaService.getCasaActiva(ctx.from.id);
  if (!entrada) {
    await responder(ctx, '🏠 Todavía no tenés ninguna casa. Creá una con `/casa nueva Casa` o unite con `/unir CODIGO`.');
    return null;
  }
  return entrada;
}

async function elegirMiembro(ctx, miembros, texto) {
  const r = buscarMiembro(miembros, texto);
  if (r.miembro) return r.miembro;
  if (r.error === 'ambiguo') {
    await responder(ctx, `⚠️ Hay más de uno que coincide: ${r.candidatos.map((c) => escapeMarkdown(c.nombre)).join(', ')}. Escribí el nombre completo.`);
  } else {
    await responder(ctx, `⚠️ No encontré a "${escapeMarkdown(texto)}" en la casa. Mirá /casa miembros.`);
  }
  return null;
}

// ── Canje de invitación (lo usa también /unir) ───────────────────────────────

/**
 * Devuelve true si el código era de una casa (y ya respondió); false si no lo
 * era y el caller debe seguir con el flujo de consultorio.
 */
async function canjearInvitacionCasa(ctx, rawCode, aliasTexto) {
  const userId = ctx.from.id;
  const inv = casaInvite.buscarInvitacionCasa(userId, rawCode, { tieneCuenta: Boolean(obtenerClientePorUserId(userId)) });

  if (inv.estado === 'bloqueado') {
    await responder(ctx, '❌ Demasiados intentos con códigos inválidos. Probá de nuevo más tarde.');
    return true;
  }
  if (inv.estado === 'otro') return false;

  const { data, codigo } = inv;
  try {
    const alias = sanitizarInput(aliasTexto, 40) || aliasDe(ctx);
    const { casa, miembro } = await casaService.unirMiembro(userId, {
      ownerId: data.ownerId, casaId: data.casaId, miembroId: data.miembroId, alias,
    });
    casaInvite.consumirInvitacionCasa(userId, codigo);

    await responder(ctx,
      `✅ *¡Ya sos parte de ${escapeMarkdown(casa.nombre)}!* (como ${escapeMarkdown(miembro.nombre)})\n\n` +
      'Para cargar un gasto escribilo con la palabra "casa": `super 45000 casa`.\n' +
      'Mirá el estado con `/casa`.');

    // Aviso a quien invitó (best-effort).
    bot.telegram.sendMessage(Number(data.creadoPor), `👋 ${miembro.nombre} se unió a ${casa.nombre}.`).catch(() => {});
    return true;
  } catch (err) {
    if (!(err instanceof CasaError)) throw err;
    if (err.code === 'nombre_repetido') {
      await responder(ctx, `⚠️ Ya hay alguien con el nombre "${escapeMarkdown(aliasDe(ctx))}" en esa casa. Unite con otro alias: \`/unir ${codigo} TuAlias\``);
    } else {
      await responder(ctx, mensajeError(err));
    }
    return true;
  }
}

// ── Subcomandos ──────────────────────────────────────────────────────────────

async function cmdResumen(ctx) {
  const entrada = await conCasaActiva(ctx);
  if (!entrada) return;
  const resumen = await casaService.calcularResumenCasa(ctx.from.id, entrada.casaId);
  const otras = casaService.listarMisCasas(ctx.from.id).filter((c) => c.casaId !== entrada.casaId);
  return responder(ctx, construirResumen(resumen, { otrasCasas: otras }));
}

async function cmdNueva(ctx, arg) {
  const c = await casaService.crearCasa(ctx.from.id, arg, { alias: aliasDe(ctx) });
  return responder(ctx,
    `🏠 *${escapeMarkdown(c.nombre)}* creada y activa.\n\n` +
    '• Invitá a otra cuenta: `/casa invitar`\n' +
    '• Sumá a alguien sin Telegram: `/casa agregar Nombre`\n' +
    '• Cargá gastos escribiendo "casa": `super 45000 casa`');
}

async function cmdLista(ctx) {
  const casas = casaService.listarMisCasas(ctx.from.id);
  if (casas.length === 0) return responder(ctx, '🏠 Todavía no tenés ninguna casa. Creá una con `/casa nueva Casa`.');
  const activa = casaService.getCasaActiva(ctx.from.id);
  const lineas = casas.map((c) => `${c.casaId === activa.casaId ? '⭐' : '•'} ${escapeMarkdown(c.nombre)}`);
  return responder(ctx, `🏠 *Tus casas*\n\n${lineas.join('\n')}\n\n_⭐ = activa. Cambiá con_ \`/casa usar <nombre>\``);
}

async function cmdUsar(ctx, arg) {
  if (!arg) return responder(ctx, 'Uso: `/casa usar <nombre>`');
  const r = buscarCasa(casaService.listarMisCasas(ctx.from.id), arg);
  if (!r.casa) {
    return responder(ctx, r.error === 'ambiguo'
      ? `⚠️ Hay más de una que coincide: ${r.candidatos.map((c) => escapeMarkdown(c.nombre)).join(', ')}. Escribí el nombre completo.`
      : `⚠️ No encontré esa casa. Mirá /casa lista.`);
  }
  await casaService.setCasaActiva(ctx.from.id, r.casa.casaId);
  return responder(ctx, `⭐ Casa activa: *${escapeMarkdown(r.casa.nombre)}*`);
}

async function cmdMiembros(ctx) {
  const entrada = await conCasaActiva(ctx);
  if (!entrada) return;
  const miembros = await casaService.listarMiembros(ctx.from.id, entrada.casaId);
  const lineas = miembros.map((m) => `• ${escapeMarkdown(m.nombre)}${m.userId ? '' : ' _(sin Telegram)_'}${m.rol === 'creador' ? ' 👑' : ''}`);
  return responder(ctx, `👥 *${escapeMarkdown(entrada.nombre)}*\n\n${lineas.join('\n')}`);
}

async function cmdAgregar(ctx, arg) {
  if (!arg) return responder(ctx, 'Uso: `/casa agregar <nombre>` (alguien sin Telegram, solo participa del reparto)');
  const entrada = await conCasaActiva(ctx);
  if (!entrada) return;
  const m = await casaService.agregarMiembroVirtual(ctx.from.id, entrada.casaId, arg);
  return responder(ctx, `✅ *${escapeMarkdown(m.nombre)}* se sumó a ${escapeMarkdown(entrada.nombre)}. Va a participar del reparto de los gastos nuevos.`);
}

async function cmdInvitar(ctx, arg) {
  const entrada = await conCasaActiva(ctx);
  if (!entrada) return;

  let miembroId = null;
  let comoQuien = '';
  if (arg) {
    const miembros = (await casaService.listarMiembros(ctx.from.id, entrada.casaId)).filter((m) => !m.userId);
    const m = await elegirMiembro(ctx, miembros, arg);
    if (!m) return;
    miembroId = m.id;
    comoQuien = `\nSe va a unir como *${escapeMarkdown(m.nombre)}* y conserva su historial.`;
  } else {
    // Comprobación de pertenencia antes de emitir un código.
    await casaService.obtenerCasaParaMiembro(ctx.from.id, entrada.casaId);
  }

  const codigo = casaInvite.crearInvitacionCasa({
    ownerId: entrada.ownerId, casaId: entrada.casaId, casaNombre: entrada.nombre, miembroId, creadoPor: ctx.from.id,
  });
  logger.audit('casa_invitacion_creada', { userId: ctx.from.id, casaId: entrada.casaId, paraMiembro: Boolean(miembroId) });

  return responder(ctx,
    `🔑 *Invitación a ${escapeMarkdown(entrada.nombre)}*\n\n` +
    `Código (vigencia 24 h, un solo uso):\n\n*${codigo}*\n\n` +
    'La persona tiene que estar registrada con su propia cuenta (/start) y enviar:\n' +
    `\`/unir ${codigo}\`${comoQuien}`);
}

async function cmdSaldo(ctx) {
  const entrada = await conCasaActiva(ctx);
  if (!entrada) return;
  const { casa, saldos } = await casaService.calcularSaldosCasa(ctx.from.id, entrada.casaId);
  return responder(ctx, `🏠 *${escapeMarkdown(casa.nombre)}*\n\n${formatearSaldos(saldos)}`);
}

async function cmdSaldar(ctx, arg) {
  const parsed = parsearSaldar(arg);
  if (!parsed) return responder(ctx, 'Uso: `/casa saldar <quién> <monto> [moneda]`\nEjemplo: `/casa saldar Ana 5000` (le pagaste $5.000 a Ana)');

  const entrada = await conCasaActiva(ctx);
  if (!entrada) return;
  const miembros = await casaService.listarMiembros(ctx.from.id, entrada.casaId);
  const para = await elegirMiembro(ctx, miembros, parsed.nombre);
  if (!para) return;

  await casaService.registrarLiquidacion(ctx.from.id, entrada.casaId, { para: para.id, monto: parsed.monto, moneda: parsed.moneda });
  const { saldos } = await casaService.calcularSaldosCasa(ctx.from.id, entrada.casaId);
  return responder(ctx, `✅ Registré que le pagaste ${fmt(parsed.monto, parsed.moneda)} a *${escapeMarkdown(para.nombre)}*.\n\n${formatearSaldos(saldos)}`);
}

async function cmdQuitar(ctx, arg) {
  if (!arg) return responder(ctx, 'Uso: `/casa quitar <nombre>`');
  const entrada = await conCasaActiva(ctx);
  if (!entrada) return;
  const miembros = await casaService.listarMiembros(ctx.from.id, entrada.casaId);
  const m = await elegirMiembro(ctx, miembros, arg);
  if (!m) return;
  await casaService.quitarMiembro(ctx.from.id, entrada.casaId, m.id);
  return responder(ctx, `✅ *${escapeMarkdown(m.nombre)}* ya no forma parte de ${escapeMarkdown(entrada.nombre)}. Su historial queda registrado.`);
}

async function cmdSalir(ctx) {
  const entrada = await conCasaActiva(ctx);
  if (!entrada) return;
  const { yo } = await casaService.obtenerCasaParaMiembro(ctx.from.id, entrada.casaId);
  await casaService.quitarMiembro(ctx.from.id, entrada.casaId, yo.id);
  return responder(ctx, `✅ Saliste de *${escapeMarkdown(entrada.nombre)}*.`);
}

// ── Registro del comando ─────────────────────────────────────────────────────

bot.command('casa', async (ctx) => {
  const texto = String(ctx.message.text || '').replace(/^\/casa(@\w+)?\s*/i, '').trim();
  const [subRaw = ''] = texto.split(/\s+/);
  const sub = normalizar(subRaw);
  const arg = texto.slice(subRaw.length).trim();

  try {
    switch (sub) {
      case '': return await cmdResumen(ctx);
      case 'nueva': case 'crear': case 'nuevo': return await cmdNueva(ctx, arg);
      case 'lista': case 'casas': return await cmdLista(ctx);
      case 'usar': case 'cambiar': return await cmdUsar(ctx, arg);
      case 'miembros': return await cmdMiembros(ctx);
      case 'agregar': return await cmdAgregar(ctx, arg);
      case 'invitar': return await cmdInvitar(ctx, arg);
      case 'unir': {
        const [codigo, ...alias] = arg.split(/\s+/);
        if (!codigo) return await responder(ctx, 'Uso: `/casa unir <código> [alias]`');
        const fueCasa = await canjearInvitacionCasa(ctx, codigo, alias.join(' '));
        return fueCasa ? undefined : await responder(ctx, '❌ Código inválido o expirado.');
      }
      case 'saldo': case 'saldos': return await cmdSaldo(ctx);
      case 'saldar': case 'pagar': return await cmdSaldar(ctx, arg);
      case 'quitar': case 'sacar': return await cmdQuitar(ctx, arg);
      case 'salir': return await cmdSalir(ctx);
      default: return await responder(ctx, AYUDA);
    }
  } catch (err) {
    if (err instanceof CasaError) return responder(ctx, mensajeError(err));
    logger.error('Casa', 'Error en /casa', { userId: ctx.from && ctx.from.id, err: err.message });
    return responder(ctx, '❌ Algo salió mal. Probá de nuevo.');
  }
});

module.exports = { canjearInvitacionCasa, construirResumen, formatearSaldos, mensajeError, fmt, AYUDA };
