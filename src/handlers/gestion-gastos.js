// /eliminar y /editar para gastos PERSONALES y de CASA desde el bot.
//
// El consultorio sigue con su flujo de siempre (commands/eliminar.js y editar.js). Cuando la
// persona tiene además Personal o alguna Casa, se le pregunta primero DE DÓNDE:
//   ámbito -> últimos 8 gastos -> (borrar: confirmar) | (editar: campo -> valor nuevo).
//
// Seguridad: la identidad es siempre ctx.from.id. Los botones solo llevan índices que se
// resuelven contra el estado guardado en el servidor, nunca ids de movimientos ni de personas;
// además cada servicio vuelve a verificar que el gasto sea de esa persona o de su casa.

const { Markup } = require('telegraf');
const { bot } = require('../lib/telegraf');
const state = require('../state');
const personalService = require('../services/personal.service');
const casaService = require('../services/casa.service');
const { puedeUsarPersonal } = require('../auth/personal-acceso');
const { tienePermisoBot } = require('../auth/bot-permisos');
const { CATEGORIAS_EGRESO_PERSONAL, CATEGORIAS_INGRESO_PERSONAL } = require('../services/personal-nlp.service');
const { formatMonto } = require('../utils/formatter');
const { normalizarDescripcion, validarMonto } = require('../utils/validation');
const { parsearFechaIngresada, fechaArgentinaStr, fechaStrAIso } = require('../utils/date');
const logger = require('../lib/logger');

const MAX_ITEMS = 8;
const MENSAJE_VENCIDO = '⚠️ Esto venció. Volvé a empezar con /eliminar o /editar.';

const CAMPOS = {
  d: { nombre: 'descripción', clave: 'descripcion', pregunta: '📝 Escribí la nueva descripción:' },
  m: { nombre: 'monto', clave: 'monto', pregunta: '💲 Escribí el nuevo monto (solo el número):' },
  f: { nombre: 'fecha', clave: 'fecha', pregunta: '📅 Escribí la nueva fecha (DD/MM/AAAA, DD/MM o "hoy"):' },
  c: { nombre: 'categoría', clave: 'categoria' },
};

const MENSAJES_ERROR = {
  monto_invalido: 'El monto es inválido.',
  descripcion_invalida: 'La descripción es inválida.',
  categoria_invalida: 'Esa categoría no corresponde a este movimiento.',
  fecha_invalida: 'La fecha es inválida.',
  sin_permiso: 'Solo quien lo cargó o quien creó la casa puede hacerlo.',
  no_miembro: 'Ya no sos parte de esa casa.',
  no_editable: 'Un pago entre miembros no se edita: borralo y volvé a cargarlo.',
};
const mensajeDe = (err) => MENSAJES_ERROR[err && (err.code || err.message)] || 'No pude completar la operación. Probá de nuevo.';

// ── Qué ámbitos tiene la persona ─────────────────────────────────────────────

function ambitosDe(userId) {
  const ambitos = [];
  if (tienePermisoBot(userId, 'editar_movimientos')) ambitos.push({ tipo: 'consultorio', nombre: '🏥 Consultorio' });
  if (puedeUsarPersonal(userId)) ambitos.push({ tipo: 'personal', nombre: '🏠 Personal' });
  let casas = [];
  try { casas = casaService.listarMisCasas(userId) || []; } catch { casas = []; }
  for (const c of casas) ambitos.push({ tipo: 'casa', casaId: c.casaId, nombre: `🏡 ${c.nombre}` });
  return ambitos;
}

const verbo = (accion) => (accion === 'editar' ? 'editar' : 'borrar');

/**
 * Se llama desde /eliminar y /editar SIN argumentos. Devuelve true si se hizo cargo (hay
 * Personal o Casa para elegir); false si la persona solo tiene consultorio y sigue el flujo
 * de siempre.
 */
async function ofrecerAmbito(ctx, accion) {
  const userId = ctx.from.id;
  const ambitos = ambitosDe(userId);
  if (!ambitos.some((a) => a.tipo !== 'consultorio')) return false;

  state.pendingGestion.set(userId, { accion, ambitos, step: 'ambito' });

  // Un solo ámbito posible (ej. una secretaria con solo su Personal): no hace falta preguntar.
  if (ambitos.length === 1) {
    await listar(ctx, userId, 0);
    return true;
  }

  await ctx.reply(
    `¿De dónde querés ${verbo(accion)} un gasto?`,
    Markup.inlineKeyboard(ambitos.map((a, i) => [Markup.button.callback(a.nombre, `gx_a:${i}`)]))
  );
  return true;
}

// ── Listado ──────────────────────────────────────────────────────────────────

function ordenReciente(a, b) {
  return `${fechaStrAIso(b.fecha) || ''} ${b.hora || ''}`.localeCompare(`${fechaStrAIso(a.fecha) || ''} ${a.hora || ''}`);
}

async function cargarItems(userId, ambito) {
  if (ambito.tipo === 'personal') {
    const movs = await personalService.obtenerMovimientosPersonales(userId);
    return [...movs].sort(ordenReciente).slice(0, MAX_ITEMS).map((m) => ({
      id: m.idMov, descripcion: m.descripcion, monto: m.monto, moneda: m.moneda, fecha: m.fecha, tipo: m.tipo, categoria: m.categoria, editable: true,
    }));
  }
  const movs = await casaService.listarMovimientos(userId, ambito.casaId);
  return movs.slice(0, MAX_ITEMS).map((m) => ({
    id: m.idMov, descripcion: m.descripcion, monto: m.monto, moneda: m.moneda, fecha: m.fecha, tipo: m.tipo, categoria: m.categoria, editable: m.tipo === 'gasto',
  }));
}

const recortar = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const etiquetaItem = (it) => `${it.tipo === 'liquidacion' ? '💸 ' : ''}${String(it.fecha || '').slice(0, 5)} ${recortar(it.descripcion, 22)} ${formatMonto(it.monto, it.moneda)}`;

async function listar(ctx, userId, idxAmbito) {
  const pend = state.pendingGestion.get(userId);
  const ambito = pend && pend.ambitos[idxAmbito];
  if (!ambito) return ctx.reply(MENSAJE_VENCIDO);

  if (ambito.tipo === 'consultorio') {
    // El flujo de siempre; deja de ser asunto de este módulo.
    state.pendingGestion.delete(userId);
    const legado = pend.accion === 'editar' ? require('./commands/editar').ejecutarEditar : require('./commands/eliminar').ejecutarEliminar;
    return legado(ctx, '');
  }

  let items;
  try {
    items = await cargarItems(userId, ambito);
  } catch (err) {
    state.pendingGestion.delete(userId);
    logger.error('BOT', 'gestion-gastos listar', { err: err.message });
    return ctx.reply('❌ No pude cargar los movimientos. Probá de nuevo en un momento.');
  }
  if (items.length === 0) {
    state.pendingGestion.delete(userId);
    return ctx.reply(`📭 No hay gastos en ${ambito.nombre}.`);
  }

  state.pendingGestion.set(userId, { ...pend, ambito, items, step: 'item' });
  return ctx.reply(
    `${ambito.nombre} — elegí el gasto a ${verbo(pend.accion)}:`,
    Markup.inlineKeyboard([
      ...items.map((it, i) => [Markup.button.callback(etiquetaItem(it), `gx_i:${i}`)]),
      [Markup.button.callback('❌ Cancelar', 'gx_no')],
    ])
  );
}

// ── Botones ──────────────────────────────────────────────────────────────────

async function elegirItem(ctx, userId, idx) {
  const pend = state.pendingGestion.get(userId);
  const item = pend && pend.items && pend.items[idx];
  if (!item || pend.step !== 'item') return ctx.reply(MENSAJE_VENCIDO);

  const detalle = `«${item.descripcion}»\n${item.fecha} · ${formatMonto(item.monto, item.moneda)}`;

  if (pend.accion === 'eliminar') {
    state.pendingGestion.set(userId, { ...pend, item, step: 'confirmar' });
    return ctx.reply(
      `¿Borrar este gasto?\n\n${detalle}\n\nNo se puede deshacer.`,
      Markup.inlineKeyboard([[Markup.button.callback('✅ Sí, borrar', 'gx_ok'), Markup.button.callback('❌ Cancelar', 'gx_no')]])
    );
  }

  if (!item.editable) {
    return ctx.reply('Un pago entre miembros no se edita: borralo con /eliminar y volvé a cargarlo.');
  }
  state.pendingGestion.set(userId, { ...pend, item, step: 'campo' });
  return ctx.reply(
    `¿Qué querés cambiar?\n\n${detalle}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📝 Descripción', 'gx_f:d'), Markup.button.callback('💲 Monto', 'gx_f:m')],
      [Markup.button.callback('🏷 Categoría', 'gx_f:c'), Markup.button.callback('📅 Fecha', 'gx_f:f')],
      [Markup.button.callback('❌ Cancelar', 'gx_no')],
    ])
  );
}

function categoriasPara(pend) {
  const esIngreso = pend.ambito.tipo === 'personal' && String(pend.item.tipo).toLowerCase() === 'ingreso';
  return esIngreso ? CATEGORIAS_INGRESO_PERSONAL : CATEGORIAS_EGRESO_PERSONAL;
}

async function elegirCampo(ctx, userId, clave) {
  const pend = state.pendingGestion.get(userId);
  const campo = CAMPOS[clave];
  if (!campo || !pend || pend.step !== 'campo') return ctx.reply(MENSAJE_VENCIDO);

  if (clave === 'c') {
    const categorias = categoriasPara(pend);
    state.pendingGestion.set(userId, { ...pend, campo: 'c', categorias, step: 'categoria' });
    const filas = [];
    for (let i = 0; i < categorias.length; i += 2) {
      filas.push(categorias.slice(i, i + 2).map((c, j) => Markup.button.callback(c.replace(/_/g, ' '), `gx_c:${i + j}`)));
    }
    filas.push([Markup.button.callback('❌ Cancelar', 'gx_no')]);
    return ctx.reply('🏷 Elegí la nueva categoría:', Markup.inlineKeyboard(filas));
  }

  state.pendingGestion.set(userId, { ...pend, campo: clave, step: 'valor' });
  return ctx.reply(`${campo.pregunta}\n\n(/cancelar para salir)`);
}

async function aplicarCambio(ctx, userId, pend, cambios) {
  try {
    const r = pend.ambito.tipo === 'personal'
      ? await personalService.actualizarMovimientoPersonal(userId, pend.item.id, cambios)
      : await casaService.editarMovimiento(userId, pend.ambito.casaId, pend.item.id, cambios);
    state.pendingGestion.delete(userId);
    if (!r) return ctx.reply('⚠️ No encontré ese gasto: puede que ya lo hayan borrado.');
    logger.audit('gestion_gasto_editado', { userId, ambito: pend.ambito.tipo, campos: Object.keys(cambios) });
    return ctx.reply(`✅ Listo. Ahora dice:\n«${r.descripcion}»\n${r.fecha} · ${formatMonto(r.monto, r.moneda)}${r.categoria ? ` · ${String(r.categoria).replace(/_/g, ' ')}` : ''}`);
  } catch (err) {
    // Un valor inválido deja la pregunta abierta para reintentar; un permiso o error real cierra.
    const reintentable = ['monto_invalido', 'descripcion_invalida', 'fecha_invalida', 'categoria_invalida'].includes(err.code || err.message);
    if (!reintentable) state.pendingGestion.delete(userId);
    if (!MENSAJES_ERROR[err.code || err.message]) logger.error('BOT', 'gestion-gastos aplicarCambio', { err: err.message });
    return ctx.reply(`⚠️ ${mensajeDe(err)}${reintentable ? ' Probá de nuevo o /cancelar.' : ''}`);
  }
}

async function elegirCategoria(ctx, userId, idx) {
  const pend = state.pendingGestion.get(userId);
  const categoria = pend && pend.step === 'categoria' && pend.categorias[idx];
  if (!categoria) return ctx.reply(MENSAJE_VENCIDO);
  return aplicarCambio(ctx, userId, pend, { categoria });
}

async function confirmarBorrado(ctx, userId) {
  const pend = state.pendingGestion.get(userId);
  if (!pend || pend.step !== 'confirmar') return ctx.reply(MENSAJE_VENCIDO);
  state.pendingGestion.delete(userId); // un solo uso: un doble toque no borra dos veces
  try {
    const ok = pend.ambito.tipo === 'personal'
      ? await personalService.eliminarMovimientoPersonal(userId, pend.item.id)
      : await casaService.eliminarMovimiento(userId, pend.ambito.casaId, pend.item.id);
    if (!ok) return ctx.reply('⚠️ No encontré ese gasto: puede que ya lo hayan borrado.');
    logger.audit('gestion_gasto_eliminado', { userId, ambito: pend.ambito.tipo });
    return ctx.reply(`🗑 Borrado: «${pend.item.descripcion}»`);
  } catch (err) {
    if (!MENSAJES_ERROR[err.code || err.message]) logger.error('BOT', 'gestion-gastos borrar', { err: err.message });
    return ctx.reply(`⚠️ ${mensajeDe(err)}`);
  }
}

// ── Texto con el valor nuevo ─────────────────────────────────────────────────

/** true si el mensaje era para este flujo (el llamador no debe seguir procesándolo). */
async function procesarTextoGestion(ctx, text) {
  const userId = ctx.from.id;
  const pend = state.pendingGestion.get(userId);
  if (!pend) return false;

  if (pend.step !== 'valor') {
    await ctx.reply('⚠️ Tenés una operación pendiente. Usá los botones de arriba o /cancelar para descartarla.');
    return true;
  }

  let cambios;
  if (pend.campo === 'd') {
    const d = normalizarDescripcion(text);
    if (!d.ok) { await ctx.reply('⚠️ La descripción es inválida. Escribí un texto más claro y corto:'); return true; }
    cambios = { descripcion: d.valor };
  } else if (pend.campo === 'm') {
    const m = validarMonto(parseFloat(String(text).replace(',', '.')));
    if (!m.ok) { await ctx.reply('⚠️ El monto es inválido. Escribí un número mayor a 0:'); return true; }
    cambios = { monto: Math.abs(m.valor) };
  } else if (pend.campo === 'f') {
    const f = /^hoy$/i.test(text.trim()) ? fechaArgentinaStr() : parsearFechaIngresada(text);
    if (!f) { await ctx.reply('⚠️ No entendí la fecha. Escribila como DD/MM/AAAA, DD/MM o "hoy":'); return true; }
    cambios = { fecha: f };
  } else {
    return false;
  }

  await aplicarCambio(ctx, userId, pend, cambios);
  return true;
}

// ── Registro ─────────────────────────────────────────────────────────────────

const esChatPrivado = (ctx) => !ctx.chat || ctx.chat.type === 'private';

bot.action(/^gx_(a|i|f|c):(\w+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!esChatPrivado(ctx)) return;
  const userId = ctx.from.id;
  const [, tipo, valor] = ctx.match;
  try {
    if (tipo === 'a') return await listar(ctx, userId, Number(valor));
    if (tipo === 'i') return await elegirItem(ctx, userId, Number(valor));
    if (tipo === 'f') return await elegirCampo(ctx, userId, valor);
    return await elegirCategoria(ctx, userId, Number(valor));
  } catch (err) {
    logger.error('BOT', 'gestion-gastos accion', { err: err.message });
    return ctx.reply('❌ Algo salió mal. Probá de nuevo con /eliminar o /editar.').catch(() => {});
  }
});

bot.action('gx_ok', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!esChatPrivado(ctx)) return;
  return confirmarBorrado(ctx, ctx.from.id).catch((err) => logger.error('BOT', 'gestion-gastos ok', { err: err.message }));
});

bot.action('gx_no', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  state.pendingGestion.delete(ctx.from.id);
  return ctx.reply('❌ Cancelado.');
});

module.exports = { ofrecerAmbito, procesarTextoGestion, ambitosDe };
