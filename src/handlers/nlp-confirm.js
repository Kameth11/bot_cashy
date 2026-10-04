const { Markup } = require('telegraf');
const { bot } = require('../lib/telegraf');
const state = require('../state');
const cmd = require('../services/command.service');
const { escapeMarkdown, formatMonto } = require('../utils/formatter');
const { DASHBOARD_URL } = require('../config');

// ── Formatting ───────────────────────────────────────────────────────────────

function formatMontoConMoneda(monto, moneda) {
  if (!monto) return '—';
  if (moneda === 'Euros') return `€${Math.abs(monto).toLocaleString('es-AR')}`;
  return formatMonto(monto, moneda);
}

function esAmbitoPersonal(entities) {
  return String((entities || {}).ambito || '').toLowerCase() === 'personal';
}

function esAmbitoCasa(entities) {
  return String((entities || {}).ambito || '').toLowerCase() === 'casa';
}

function esEgresoEntities(entities) {
  return ['gasto', 'egreso'].includes(String((entities || {}).tipo || '').toLowerCase());
}

// "Ana, Beto y Tomás"
function listaNombres(nombres) {
  const n = (nombres || []).map((x) => escapeMarkdown(String(x)));
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`;
}

// Líneas extra cuando el movimiento viene de una foto/PDF de comprobante:
// qué comprobante se leyó, vencimiento y aviso de duplicado.
function lineasComprobante(es) {
  const c = es.comprobante;
  if (!c) return '';
  const tipoDoc = [c.tipoDocumento && c.tipoDocumento !== 'otro' ? c.tipoDocumento.replace(/_/g, ' ') : 'comprobante', c.letra]
    .filter(Boolean).join(' ');
  const partes = [`🧾 ${escapeMarkdown(tipoDoc)}${c.numero ? ` ${escapeMarkdown(c.numero)}` : ''}`];
  if (c.cuit) partes.push(`CUIT ${escapeMarkdown(c.cuit)}`);
  let texto = `• Comprobante: ${partes.join(' · ')}\n`;
  if (c.fechaEmision) texto += `• Fecha: ${escapeMarkdown(c.fechaEmision)}\n`;
  if (es.fechaVencimiento) texto += `• Vence: ${escapeMarkdown(es.fechaVencimiento)}\n`;
  if (Array.isArray(c.items) && c.items.length) texto += `• Ítems: ${c.items.length}\n`;
  if (c.duplicado) {
    const cuando = c.duplicado.fechaCarga ? ` (cargado el ${escapeMarkdown(c.duplicado.fechaCarga)})` : '';
    texto += c.duplicado.motivo === 'mismo_archivo'
      ? `\n⚠️ _Esta misma imagen ya se cargó${cuando}. Si la guardás, queda duplicado._\n`
      : `\n⚠️ _Ya hay un comprobante con el mismo emisor, número y total${cuando}. Revisá que no sea el mismo._\n`;
  }
  return texto;
}

function crearMensajeConfirmacion(entities) {
  const es = entities || {};
  const tipoRaw = String(es.tipo || '').toLowerCase();
  const esEgreso = ['gasto', 'egreso'].includes(tipoRaw);
  const tipoTexto = esEgreso ? 'Egreso 🔴' : 'Ingreso 💚';

  const moneda = es.moneda || 'Pesos';
  const montoTexto = formatMontoConMoneda(es.monto, moneda);
  const monedaLabel = moneda === 'Dólares' ? ' dólares' : moneda === 'Euros' ? ' euros' : ' pesos';

  const estadoTexto = es.estado === 'Pendiente' ? 'Pendiente ⏳' : 'Cobrado';
  const metodo = es.metodo_pago
    ? es.metodo_pago.charAt(0).toUpperCase() + es.metodo_pago.slice(1)
    : null;

  const v = (x) => (x ? escapeMarkdown(String(x)) : '—');
  const categoriaTexto = es.categoria ? escapeMarkdown(String(es.categoria).replace(/_/g, ' ')) : '—';

  // Casa compartida: importan quién pagó y entre quiénes se reparte.
  if (esAmbitoCasa(es)) {
    const reparto = es.repartoNombres && es.repartoNombres.length
      ? listaNombres(es.repartoNombres)
      : `todos (${listaNombres((es.miembrosCasa || []).map((m) => m.nombre))})`;
    return (
      `📋 *Entendí esto:*\n\n` +
      `• Ámbito: 🏡 Casa — ${v(es.casaNombre)}\n` +
      `• Tipo: Egreso 🔴\n` +
      `• Monto: ${montoTexto}${es.monto ? monedaLabel : ''}\n` +
      `• Categoría: ${categoriaTexto}\n` +
      `• Detalle: ${v(es.descripcion)}\n` +
      `• Pagó: ${v(es.pagoPorNombre)}\n` +
      `• Reparto: ${reparto}\n` +
      `• Método: ${v(metodo)}\n` +
      (es.fecha ? `• Fecha: ${escapeMarkdown(String(es.fecha))}\n` : '') +
      (es.avisoReparto ? `\n⚠️ _${escapeMarkdown(es.avisoReparto)}_\n` : '') +
      `\n_¿Es correcto?_`
    );
  }

  // El ámbito personal tiene otros campos: no hay paciente ni tratamiento, y
  // sí importan la categoría y el viaje al que se atribuye.
  if (esAmbitoPersonal(es)) {
    const viajeLinea = es.viajeNombre
      ? `• Viaje: ✈️ ${escapeMarkdown(String(es.viajeNombre))}\n`
      : '';
    return (
      `📋 *Entendí esto:*\n\n` +
      `• Ámbito: 🏠 Personal\n` +
      `• Tipo: ${tipoTexto}\n` +
      `• Monto: ${montoTexto}${es.monto ? monedaLabel : ''}\n` +
      `• Categoría: ${categoriaTexto}\n` +
      `• Detalle: ${v(es.descripcion)}\n` +
      `• Método: ${v(metodo)}\n` +
      (es.fecha ? `• Fecha: ${escapeMarkdown(String(es.fecha))}\n` : '') +
      viajeLinea +
      lineasComprobante(es) +
      `\n_¿Es correcto?_`
    );
  }

  const nombreLabel = esEgreso ? 'Proveedor' : 'Paciente';
  const nombreValor = esEgreso ? es.proveedorNombre : es.pacienteNombre;

  // Cuando el término es ambiguo (alquiler, luz, expensas...) se avisa, porque
  // el default es consultorio y quizá no sea lo que el usuario quiso.
  const avisoAmbiguo = es.ambiguoAmbito
    ? `\n⚠️ _Asumí que es del consultorio. Si es de tu casa, tocá el botón._\n`
    : '';
  // (Con casas compartidas el botón ofrece también cada casa.)

  return (
    `📋 *Entendí esto:*\n\n` +
    `• Ámbito: 🏥 Consultorio\n` +
    `• Tipo: ${tipoTexto}\n` +
    `• Monto: ${montoTexto}${es.monto ? monedaLabel : ''}\n` +
    `• ${nombreLabel}: ${v(nombreValor)}\n` +
    `• Método: ${v(metodo)}\n` +
    `• Estado: ${estadoTexto}\n` +
    (es.comprobante ? '' : `• Tratamiento: ${v(es.tratamientoNombre)}\n`) +
    lineasComprobante(es) +
    avisoAmbiguo +
    `\n_¿Es correcto?_`
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

// Con casas compartidas el toggle binario no alcanza: se ofrece cada ámbito al
// que se puede mover el movimiento (menos el actual). Una casa solo para gastos.
function botonesDeAmbito(entities) {
  const es = entities || {};
  const actual = esAmbitoCasa(es) ? `casa:${es.casaId}` : (esAmbitoPersonal(es) ? 'personal' : 'consultorio');
  const opciones = [
    { target: 'consultorio', label: '🏥 Consultorio' },
    { target: 'personal', label: '🏠 Personal' },
  ];
  if (esEgresoEntities(es)) {
    for (const c of es.casasDisponibles) opciones.push({ target: `casa:${c.casaId}`, label: `🏡 ${c.nombre}` });
  }
  const botones = opciones
    .filter((o) => o.target !== actual)
    .map((o) => Markup.button.callback(o.label, `nlp_set_ambito:${o.target}`));
  const filas = [];
  for (let i = 0; i < botones.length; i += 2) filas.push(botones.slice(i, i + 2));
  return filas;
}

function confirmationButtons(entities) {
  const personal = esAmbitoPersonal(entities);
  const tieneCasas = Array.isArray((entities || {}).casasDisponibles) && entities.casasDisponibles.length > 0;
  const filas = [
    [
      Markup.button.callback('✅ Guardar', 'nlp_save'),
      Markup.button.callback('❌ Cancelar', 'nlp_cancel'),
    ],
    ...(tieneCasas
      ? botonesDeAmbito(entities)
      : [[Markup.button.callback(
        personal ? '🏥 Es del consultorio' : '🏠 Es personal',
        'nlp_toggle_ambito'
      )]]),
  ];

  // Un gasto atribuido a un viaje se puede desatribuir sin tocar nada más: es
  // el caso de pagar la luz mientras estás de viaje.
  if (personal && (entities || {}).viajeId) {
    filas.push([Markup.button.callback('🚫 No es del viaje', 'nlp_quitar_viaje')]);
  }

  filas.push([Markup.button.callback('✏️ Editar un campo', 'nlp_edit')]);
  return Markup.inlineKeyboard(filas);
}

function editFieldButtons(entities) {
  if (esAmbitoCasa(entities)) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('💰 Monto', 'nlp_edit_monto'),
        Markup.button.callback('💳 Método', 'nlp_edit_metodo'),
      ],
      [
        Markup.button.callback('👤 Pagó', 'nlp_edit_pago'),
        Markup.button.callback('👥 Entre quiénes', 'nlp_edit_reparto'),
      ],
      [Markup.button.callback('🔄 Reescribir', 'nlp_edit_reescribir')],
    ]);
  }
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Monto', 'nlp_edit_monto'),
      Markup.button.callback('👤 Paciente', 'nlp_edit_paciente'),
    ],
    [
      Markup.button.callback('💳 Método', 'nlp_edit_metodo'),
      Markup.button.callback('📊 Tipo', 'nlp_edit_tipo'),
    ],
    [
      Markup.button.callback('📋 Estado', 'nlp_edit_estado'),
      Markup.button.callback('🔄 Reescribir', 'nlp_edit_reescribir'),
    ],
  ]);
}

function discardButtons() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Guardar', 'nlp_keep_old'),
      Markup.button.callback('❌ Descartar', 'nlp_discard_old'),
    ],
  ]);
}

// ── Public API ───────────────────────────────────────────────────────────────

async function mostrarConfirmacion(ctx, entities) {
  const userId = ctx.from.id;
  state.pendingNlpMovimientos.set(userId, { entities, editingCampo: null });
  await ctx.reply(crearMensajeConfirmacion(entities), {
    parse_mode: 'Markdown',
    ...confirmationButtons(entities),
  });
}

async function actualizarCampoNlp(ctx, userId, pending, text) {
  const campo = pending.editingCampo;
  const entities = { ...pending.entities };

  switch (campo) {
    case 'monto': {
      // Accept "15000", "15.000", "15,000" — strip thousands separators then parse
      const clean = String(text).trim().replace(/\./g, '').replace(',', '.');
      const n = parseFloat(clean);
      if (!Number.isFinite(n) || n <= 0) {
        return ctx.reply('⚠️ Monto inválido. Ingresá un número positivo (ej: 15000):');
      }
      entities.monto = n;
      break;
    }
    case 'pacienteNombre':
      entities.pacienteNombre = text.trim() || null;
      break;
    case 'pagoPor': {
      const { buscarMiembro } = require('../lib/casa-parse');
      const r = buscarMiembro(entities.miembrosCasa, text);
      if (!r.miembro) {
        return ctx.reply(r.error === 'ambiguo'
          ? `⚠️ Hay más de uno que coincide: ${r.candidatos.map((c) => c.nombre).join(', ')}. Escribí el nombre completo:`
          : '⚠️ No encontré a esa persona en la casa. Escribí el nombre como figura en /casa miembros:');
      }
      entities.pagoPorId = r.miembro.id;
      entities.pagoPorNombre = r.miembro.nombre;
      break;
    }
    case 'reparto': {
      const { buscarMiembro, normalizar } = require('../lib/casa-parse');
      const limpio = normalizar(text);
      if (/^(?:todos|todas|nosotros|los dos)$/.test(limpio)) {
        entities.repartoIds = null;
        entities.repartoNombres = null;
        entities.avisoReparto = null;
        break;
      }
      const ids = [];
      const desconocidos = [];
      for (const tok of limpio.split(/\s*,\s*|\s+(?:y|e)\s+/).filter(Boolean)) {
        const r = buscarMiembro(entities.miembrosCasa, tok);
        if (r.miembro) { if (!ids.includes(r.miembro.id)) ids.push(r.miembro.id); } else desconocidos.push(tok);
      }
      if (ids.length === 0 || desconocidos.length > 0) {
        return ctx.reply(`⚠️ No reconocí a: ${desconocidos.join(', ') || text}. Escribí los nombres separados por "y" (ej: Ana y Beto) o "todos":`);
      }
      entities.repartoIds = ids;
      entities.repartoNombres = ids.map((id) => entities.miembrosCasa.find((m) => m.id === id).nombre);
      entities.avisoReparto = null;
      break;
    }
    case 'metodo_pago': {
      const m = text.toLowerCase().trim();
      if (!['efectivo', 'transferencia', 'tarjeta'].includes(m)) {
        return ctx.reply('⚠️ Método inválido. Usá: efectivo / transferencia / tarjeta');
      }
      entities.metodo_pago = m;
      break;
    }
    case 'tipo': {
      const t = text.toLowerCase().trim();
      if (['ingreso', 'cobro', 'entrada', 'servicio', 'consulta'].includes(t)) {
        entities.tipo = 'ingreso';
      } else if (['gasto', 'egreso', 'salida'].includes(t)) {
        entities.tipo = 'gasto';
      } else {
        return ctx.reply('⚠️ Tipo inválido. Usá: ingreso / gasto');
      }
      break;
    }
    case 'estado': {
      const e = text.toLowerCase().trim();
      if (['cobrado', 'si', 'sí', 'pagado'].includes(e)) {
        entities.estado = 'Cobrado';
      } else if (['pendiente', 'no', 'sin cobrar'].includes(e)) {
        entities.estado = 'Pendiente';
      } else {
        return ctx.reply('⚠️ Estado inválido. Usá: cobrado / pendiente');
      }
      break;
    }
    default:
      break;
  }

  state.pendingNlpMovimientos.set(userId, { entities, editingCampo: null });
  return ctx.reply(crearMensajeConfirmacion(entities), {
    parse_mode: 'Markdown',
    ...confirmationButtons(entities),
  });
}

// ── Ámbito personal ──────────────────────────────────────────────────────────

async function guardarMovimientoPersonalDesdeConfirmacion(ctx, userId, entities) {
  const personalService = require('../services/personal.service');

  try {
    const { movimiento, viaje } = await personalService.registrarMovimientoPersonal(userId, {
      descripcion: entities.descripcion,
      monto: entities.monto,
      tipo: entities.tipo,
      moneda: entities.moneda,
      metodoPago: entities.metodo_pago,
      categoria: entities.categoria,
      comercio: entities.comercio || null,
      fecha: entities.fecha || undefined,
      // Pasar la clave explícitamente hace que el servicio NO recalcule la
      // atribución: así "No es del viaje" efectivamente guarda sin viaje.
      viajeId: entities.viajeId || null,
      // Vínculo con el comprobante (foto/PDF), si vino de uno.
      notas: entities.comprobante ? entities.referenciaId : null,
    });

    if (entities.comprobante) {
      await require('./comprobante').registrarComprobanteDesdeEntities(userId, entities, { idMovimiento: movimiento.idMov });
    }

    const categoriaTexto = escapeMarkdown(String(movimiento.categoria || '').replace(/_/g, ' '));
    const viajeTexto = viaje ? `\n✈️ Viaje: ${escapeMarkdown(viaje.nombre)}` : '';

    // Aviso de presupuesto: solo para egresos y solo si hay uno definido.
    let alerta = '';
    if (String(movimiento.tipo).toLowerCase() === 'egreso') {
      const estado = await personalService.evaluarPresupuesto(userId, movimiento.categoria, movimiento.fecha);
      if (estado && estado.enAlerta) {
        const icono = estado.excedido ? '🔴' : '⚠️';
        alerta =
          `\n\n${icono} *${categoriaTexto}*: ${formatMonto(estado.gastado, estado.moneda)} ` +
          `de ${formatMonto(estado.limite, estado.moneda)} (${estado.porcentaje}%)` +
          (estado.excedido
            ? `\n_Te pasaste del presupuesto del mes._`
            : `\n_Te quedan ${formatMonto(estado.restante, estado.moneda)} este mes._`);
      }
    }

    const extra = { parse_mode: 'Markdown' };
    // Lo personal vive en su propia sección (/personal, el botón 🏠 Personal de la
    // barra): el link tiene que llevar ahí, no a la pantalla del consultorio,
    // donde estos movimientos nunca aparecen.
    if (DASHBOARD_URL) {
      extra.reply_markup = { inline_keyboard: [[{ text: '🏠 Ver en Personal', url: `${DASHBOARD_URL.replace(/\/+$/, '')}/personal` }]] };
    }

    // El resumen personal (bot y dashboard) muestra un mes por vez: si la fecha
    // del movimiento (p. ej. la de un comprobante viejo) cae en otro mes, no
    // va a estar en el mes actual y conviene decirlo en vez de dejar al usuario
    // buscándolo.
    const iso = personalService.fechaStrAIso(movimiento.fecha) || '';
    const avisoMes = iso && !iso.startsWith(personalService.mesActualIso())
      ? `\n\n📆 _Ojo: la fecha es de otro mes (${iso.slice(0, 7)}). Lo vas a ver en Personal → ese mes, no en el actual._`
      : '';
    const esIngreso = String(movimiento.tipo).toLowerCase() === 'ingreso';
    return ctx.editMessageText(
      `✅ *${esIngreso ? 'Ingreso' : 'Gasto'} personal registrado*\n\n` +
      `🏠 ${escapeMarkdown(movimiento.descripcion)}\n` +
      `💰 ${formatMonto(movimiento.monto, movimiento.moneda)}\n` +
      `📅 ${escapeMarkdown(String(movimiento.fecha))}\n` +
      `🏷️ ${categoriaTexto}${viajeTexto}${alerta}${avisoMes}`,
      extra
    );
  } catch (error) {
    if (error.message === 'monto_invalido') {
      return ctx.editMessageText('⚠️ El monto no es válido. Mandá el movimiento de nuevo.');
    }
    if (error.message === 'descripcion_invalida') {
      return ctx.editMessageText('⚠️ Falta una descripción más clara. Mandalo de nuevo.');
    }
    console.error('Error al guardar movimiento personal:', error.message);
    return ctx.editMessageText('❌ Error al guardar el gasto personal. Intentá de nuevo.');
  }
}

// Cambia el ámbito del movimiento pendiente y RECUERDA la elección: la próxima
// vez que aparezca ese término ambiguo ya arranca en el ámbito correcto.
// `target`: 'consultorio' | 'personal' | 'casa:<casaId>'.
async function aplicarAmbito(ctx, target, comando) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');

  const personalService = require('../services/personal.service');
  const { inferirCategoriaPersonal } = require('../services/personal-nlp.service');
  const { requiereDuenoBot } = require('../auth/bot-permisos');

  // Las pestañas personales son las del dueño: un invitado no puede pasar
  // un movimiento a ese ámbito tocando el botón, aunque haya llegado acá
  // (mismo criterio que marcarAmbito en text.js).
  if (target === 'personal' && !requiereDuenoBot(ctx, comando)) return;

  const entities = { ...pending.entities };
  const veniaDeConsultorio = !esAmbitoPersonal(entities) && !esAmbitoCasa(entities);

  // Datos propios de una casa: se limpian al salir de ella.
  const limpiarCasa = () => {
    entities.casaId = null;
    entities.casaNombre = null;
    entities.miembrosCasa = null;
    entities.pagoPorId = null;
    entities.pagoPorNombre = null;
    entities.repartoIds = null;
    entities.repartoNombres = null;
    entities.avisoReparto = null;
  };

  if (target.startsWith('casa:')) {
    const casaId = target.slice(5);
    const casaService = require('../services/casa.service');
    const { mensajeError } = require('../lib/casa-format');

    // El callback viene del cliente: se valida contra el servidor, nunca se confía.
    if (!casaService.listarMisCasas(userId).some((c) => c.casaId === casaId)) {
      return ctx.reply('🔒 No pertenecés a esa casa.');
    }
    if (!esEgresoEntities(entities)) return ctx.reply('⚠️ En una casa solo se cargan gastos.');

    let miembros;
    try {
      miembros = await casaService.listarMiembros(userId, casaId);
    } catch (err) {
      if (err instanceof casaService.CasaError) return ctx.reply(mensajeError(err));
      throw err;
    }
    const yo = miembros.find((m) => m.userId === String(userId));
    if (!yo) return ctx.reply('🔒 No pertenecés a esa casa.');

    const { extraerPagoYReparto } = require('../lib/casa-parse');
    const pr = extraerPagoYReparto(entities.textoOriginal || entities.descripcion || '', miembros, yo.id);
    const nombreDe = (id) => (miembros.find((m) => m.id === id) || {}).nombre;
    const casa = (entities.casasDisponibles || []).find((c) => c.casaId === casaId);

    if (veniaDeConsultorio) entities.categoriaConsultorio = entities.categoria;
    entities.ambito = 'casa';
    entities.ambiguoAmbito = false;
    entities.casaId = casaId;
    entities.casaNombre = casa ? casa.nombre : null;
    entities.categoria = inferirCategoriaPersonal(entities.tipo, `${entities.descripcion || ''} ${entities.textoOriginal || ''}`);
    entities.miembrosCasa = miembros.map(({ id, nombre }) => ({ id, nombre }));
    entities.pagoPorId = pr.pagoPorId;
    entities.pagoPorNombre = nombreDe(pr.pagoPorId);
    entities.repartoIds = pr.repartoIds;
    entities.repartoNombres = pr.repartoIds ? pr.repartoIds.map(nombreDe) : null;
    entities.avisoReparto = pr.repartoDesconocidos.length
      ? `No encontré a ${pr.repartoDesconocidos.join(', ')} en la casa: lo repartí entre todos.`
      : null;
    entities.viajeId = null;
    entities.viajeNombre = null;
  } else if (target === 'personal') {
    if (veniaDeConsultorio) entities.categoriaConsultorio = entities.categoria;
    limpiarCasa();
    entities.ambito = 'personal';
    entities.ambiguoAmbito = false;
    entities.categoria = inferirCategoriaPersonal(
      entities.tipo,
      `${entities.descripcion || ''} ${entities.textoOriginal || ''}`
    );

    const viaje = await personalService.obtenerViajeActivo(userId);
    if (viaje && personalService.correspondeAlViaje(viaje, {
      fecha: entities.fecha || personalService.fechaHoyStr(),
      categoria: entities.categoria,
    })) {
      entities.viajeId = viaje.idViaje;
      entities.viajeNombre = viaje.nombre;
    }
  } else {
    // Volviendo al consultorio: se restaura la categoría clínica original.
    limpiarCasa();
    entities.ambito = 'consultorio';
    entities.ambiguoAmbito = false;
    entities.categoria = entities.categoriaConsultorio || null;
    entities.viajeId = null;
    entities.viajeNombre = null;
  }

  // Aprender la corrección para no volver a preguntar por este término.
  if (entities.terminoAmbito) {
    await personalService.guardarPreferencia(userId, entities.terminoAmbito, target);
  }

  state.pendingNlpMovimientos.set(userId, { entities, editingCampo: null });
  return ctx.editMessageText(crearMensajeConfirmacion(entities), {
    parse_mode: 'Markdown',
    ...confirmationButtons(entities),
  });
}

// Toggle binario consultorio <-> personal (usuarios sin casas, y mensajes viejos).
async function handleNlpToggleAmbito(ctx) {
  const pending = state.pendingNlpMovimientos.get(ctx.from.id);
  const nuevo = pending && esAmbitoPersonal(pending.entities) ? 'consultorio' : 'personal';
  return aplicarAmbito(ctx, nuevo, 'nlp_toggle_ambito');
}

// Selector de ámbito (usuarios con casas): nlp_set_ambito:<consultorio|personal|casa:id>
async function handleNlpSetAmbito(ctx) {
  const target = String((ctx.match && ctx.match[1]) || '');
  if (target !== 'consultorio' && target !== 'personal' && !/^casa:[A-Za-z0-9_]+$/.test(target)) {
    await ctx.answerCbQuery();
    return ctx.reply('⚠️ Opción no válida.');
  }
  return aplicarAmbito(ctx, target, 'nlp_set_ambito');
}

async function handleNlpQuitarViaje(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');

  const entities = { ...pending.entities, viajeId: null, viajeNombre: null };
  state.pendingNlpMovimientos.set(userId, { entities, editingCampo: null });
  return ctx.editMessageText(crearMensajeConfirmacion(entities), {
    parse_mode: 'Markdown',
    ...confirmationButtons(entities),
  });
}

// ── Ámbito casa ──────────────────────────────────────────────────────────────

async function guardarGastoCasaDesdeConfirmacion(ctx, userId, entities) {
  const casaService = require('../services/casa.service');
  const { fmt, formatearSaldos, mensajeError } = require('../lib/casa-format');

  try {
    const { movimiento, miembros } = await casaService.registrarGasto(userId, entities.casaId, {
      descripcion: entities.descripcion,
      monto: entities.monto,
      moneda: entities.moneda,
      metodoPago: entities.metodo_pago,
      categoria: entities.categoria,
      fecha: entities.fecha || undefined,
      pagoPor: entities.pagoPorId || undefined,
      repartoEntre: entities.repartoIds || undefined,
    });

    const nombre = (id) => (miembros.find((m) => m.id === id) || {}).nombre || id;
    const reparto = movimiento.repartoEntre.length === miembros.length
      ? 'todos'
      : listaNombres(movimiento.repartoEntre.map(nombre));

    // Saldos actualizados (best-effort: el gasto ya quedó guardado).
    let saldos = '';
    try {
      const r = await casaService.calcularSaldosCasa(userId, entities.casaId);
      saldos = `\n\n${formatearSaldos(r.saldos)}`;
    } catch (err) {
      console.error('Casa: no se pudieron calcular los saldos tras guardar:', err.message);
    }

    return ctx.editMessageText(
      `✅ *Gasto registrado en ${escapeMarkdown(entities.casaNombre || 'la casa')}*\n\n` +
      `🏡 ${escapeMarkdown(movimiento.descripcion)}\n` +
      `💰 ${fmt(movimiento.monto, movimiento.moneda)}\n` +
      `👤 Pagó: ${escapeMarkdown(nombre(movimiento.pagoPor))}\n` +
      `👥 Reparto: ${reparto}\n` +
      `🏷️ ${escapeMarkdown(String(movimiento.categoria || '').replace(/_/g, ' '))}${saldos}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    if (error instanceof casaService.CasaError) return ctx.editMessageText(mensajeError(error));
    console.error('Error al guardar gasto de casa:', error.message);
    return ctx.editMessageText('❌ Error al guardar el gasto de la casa. Intentá de nuevo.');
  }
}

// ── Action handlers (exported for testing) ────────────────────────────────────

async function handleNlpSave(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) {
    return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');
  }
  state.pendingNlpMovimientos.delete(userId);

  // Casa y personal tienen su propio almacenamiento (pestañas aparte) y no
  // pasan por el modelo del consultorio.
  if (esAmbitoCasa(pending.entities)) {
    return guardarGastoCasaDesdeConfirmacion(ctx, userId, pending.entities);
  }
  if (esAmbitoPersonal(pending.entities)) {
    return guardarMovimientoPersonalDesdeConfirmacion(ctx, userId, pending.entities);
  }

  try {
    const resultado = await cmd.registrarMovimientoDesdeNLP(userId, pending.entities);
    // Si vino de una foto/PDF, el comprobante queda registrado aunque el
    // movimiento todavía necesite un dato (método de pago, cotización): el
    // vínculo viaja en ReferenciaId y se completa cuando se guarde.
    if (pending.entities.comprobante && (resultado.success || resultado.necesitaInfo)) {
      await require('./comprobante').registrarComprobanteDesdeEntities(userId, pending.entities, { idMovimiento: resultado.idUnico || null });
    }
    if (resultado.necesitaInfo) {
      await ctx.editMessageText('⏳ Completando datos...');
      return ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });
    }
    if (resultado.success) {
      const extra = { parse_mode: 'Markdown' };
      if (DASHBOARD_URL) extra.reply_markup = { inline_keyboard: [[{ text: '📊 Ver Dashboard', url: DASHBOARD_URL }]] };
      return ctx.editMessageText(resultado.mensaje, extra);
    }
    return ctx.editMessageText('❌ No se pudo registrar. Intentá de nuevo.');
  } catch (error) {
    console.error('Error al guardar NLP:', error.message);
    return ctx.editMessageText('❌ Error al guardar. Intentá de nuevo.');
  }
}

async function handleNlpCancel(ctx) {
  await ctx.answerCbQuery();
  state.pendingNlpMovimientos.delete(ctx.from.id);
  return ctx.editMessageText('❌ Cancelado. Podés volver a escribirlo cuando quieras.');
}

async function handleNlpEdit(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  if (!state.pendingNlpMovimientos.has(userId)) {
    return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');
  }
  return ctx.editMessageText('✏️ *¿Qué campo querés editar?*', {
    parse_mode: 'Markdown',
    ...editFieldButtons((state.pendingNlpMovimientos.get(userId) || {}).entities),
  });
}

function makeEditCampoHandler(campo, prompt) {
  return async function handleNlpEditCampo(ctx) {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const pending = state.pendingNlpMovimientos.get(userId);
    if (!pending) return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');
    pending.editingCampo = campo;
    state.pendingNlpMovimientos.set(userId, pending);
    await ctx.reply(prompt);
  };
}

async function handleNlpEditReescribir(ctx) {
  await ctx.answerCbQuery();
  state.pendingNlpMovimientos.delete(ctx.from.id);
  return ctx.editMessageText('🔄 Movimiento descartado. Escribí el movimiento de nuevo con todos los detalles.');
}

async function handleNlpKeepOld(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');
  pending.editingCampo = null;
  state.pendingNlpMovimientos.set(userId, pending);
  return ctx.editMessageText(crearMensajeConfirmacion(pending.entities), {
    parse_mode: 'Markdown',
    ...confirmationButtons(pending.entities),
  });
}

async function handleNlpDiscardOld(ctx) {
  await ctx.answerCbQuery();
  state.pendingNlpMovimientos.delete(ctx.from.id);
  return ctx.editMessageText('✅ Movimiento descartado. Mandá el nuevo mensaje de nuevo para procesarlo.');
}

const handleNlpEditMonto    = makeEditCampoHandler('monto',         '💰 Ingresá el nuevo monto (ej: 15000):');
const handleNlpEditPaciente = makeEditCampoHandler('pacienteNombre','👤 Ingresá el nombre del paciente:');
const handleNlpEditMetodo   = makeEditCampoHandler('metodo_pago',   '💳 Ingresá el método: efectivo / transferencia / tarjeta');
const handleNlpEditTipo     = makeEditCampoHandler('tipo',          '📊 Ingresá el tipo: ingreso / gasto');
const handleNlpEditEstado   = makeEditCampoHandler('estado',        '📋 Ingresá el estado: cobrado / pendiente');
const handleNlpEditPago     = makeEditCampoHandler('pagoPor',       '👤 ¿Quién pagó? Escribí el nombre (ej: Ana):');
const handleNlpEditReparto  = makeEditCampoHandler('reparto',       '👥 ¿Entre quiénes? Escribí los nombres separados por "y" (ej: Ana y Beto) o "todos":');

// ── Register bot actions ──────────────────────────────────────────────────────

bot.action('nlp_save',           handleNlpSave);
bot.action('nlp_toggle_ambito',  handleNlpToggleAmbito);
bot.action(/^nlp_set_ambito:(.+)$/, handleNlpSetAmbito);
bot.action('nlp_edit_pago',      handleNlpEditPago);
bot.action('nlp_edit_reparto',   handleNlpEditReparto);
bot.action('nlp_quitar_viaje',   handleNlpQuitarViaje);
bot.action('nlp_cancel',         handleNlpCancel);
bot.action('nlp_edit',           handleNlpEdit);
bot.action('nlp_edit_monto',     handleNlpEditMonto);
bot.action('nlp_edit_paciente',  handleNlpEditPaciente);
bot.action('nlp_edit_metodo',    handleNlpEditMetodo);
bot.action('nlp_edit_tipo',      handleNlpEditTipo);
bot.action('nlp_edit_estado',    handleNlpEditEstado);
bot.action('nlp_edit_reescribir',handleNlpEditReescribir);
bot.action('nlp_keep_old',       handleNlpKeepOld);
bot.action('nlp_discard_old',    handleNlpDiscardOld);

module.exports = {
  crearMensajeConfirmacion,
  esAmbitoPersonal,
  esAmbitoCasa,
  handleNlpToggleAmbito,
  handleNlpSetAmbito,
  handleNlpEditPago,
  handleNlpEditReparto,
  handleNlpQuitarViaje,
  mostrarConfirmacion,
  actualizarCampoNlp,
  discardButtons,
  confirmationButtons,
  handleNlpSave,
  handleNlpCancel,
  handleNlpEdit,
  handleNlpEditMonto,
  handleNlpEditPaciente,
  handleNlpEditMetodo,
  handleNlpEditTipo,
  handleNlpEditEstado,
  handleNlpEditReescribir,
  handleNlpKeepOld,
  handleNlpDiscardOld,
};
