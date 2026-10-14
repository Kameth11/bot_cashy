const { logSiAccionable } = require('../lib/errores');
const { Markup } = require('telegraf');
const { bot } = require('../lib/telegraf');
const state = require('../state');
const cmd = require('../services/command.service');
const { escapeMarkdown, formatMonto } = require('../utils/formatter');
const { DASHBOARD_URL } = require('../config');
const textos = require('../messages');

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
  const T = textos.confirmacion;
  const tipoDoc = [c.tipoDocumento && c.tipoDocumento !== 'otro' ? c.tipoDocumento.replace(/_/g, ' ') : T.comprobanteGenerico, c.letra]
    .filter(Boolean).join(' ');
  const partes = [`🧾 ${escapeMarkdown(tipoDoc)}${c.numero ? ` ${escapeMarkdown(c.numero)}` : ''}`];
  if (c.cuit) partes.push(T.cuit(escapeMarkdown(c.cuit)));
  let texto = T.linea(T.etiqueta.comprobante, partes.join(' · '));
  if (c.fechaEmision) texto += T.linea(T.etiqueta.fecha, escapeMarkdown(c.fechaEmision));
  if (es.fechaVencimiento) texto += T.linea(T.etiqueta.vence, escapeMarkdown(es.fechaVencimiento));
  if (Array.isArray(c.items) && c.items.length) texto += T.linea(T.etiqueta.items, c.items.length);
  if (c.duplicado) {
    const cuando = c.duplicado.fechaCarga ? T.cargadoEl(escapeMarkdown(c.duplicado.fechaCarga)) : '';
    texto += c.duplicado.motivo === 'mismo_archivo'
      ? T.duplicadoMismaImagen(cuando)
      : T.duplicadoMismoComprobante(cuando);
  }
  return texto;
}

function crearMensajeConfirmacion(entities) {
  const T = textos.confirmacion;
  const es = entities || {};
  const tipoRaw = String(es.tipo || '').toLowerCase();
  const esEgreso = ['gasto', 'egreso'].includes(tipoRaw);
  const tipoTexto = esEgreso ? T.tipo.egreso : T.tipo.ingreso;

  const moneda = es.moneda || 'Pesos';
  const montoTexto = formatMontoConMoneda(es.monto, moneda);
  const monedaLabel = T.monedaLabel[moneda] || T.monedaLabel.Pesos;
  const montoLinea = `${montoTexto}${es.monto ? monedaLabel : ''}`;

  const estadoTexto = es.estado === 'Pendiente' ? T.estado.pendiente : T.estado.cobrado;
  const metodo = es.metodo_pago
    ? es.metodo_pago.charAt(0).toUpperCase() + es.metodo_pago.slice(1)
    : null;

  const v = (x) => (x ? escapeMarkdown(String(x)) : '—');
  const categoriaTexto = es.categoria ? escapeMarkdown(String(es.categoria).replace(/_/g, ' ')) : '—';

  // Casa compartida: importan quién pagó y entre quiénes se reparte.
  if (esAmbitoCasa(es)) {
    const reparto = es.repartoNombres && es.repartoNombres.length
      ? listaNombres(es.repartoNombres)
      : T.repartoTodos(listaNombres((es.miembrosCasa || []).map((m) => m.nombre)));
    return (
      T.encabezado +
      T.linea(T.etiqueta.ambito, T.ambito.casa(v(es.casaNombre))) +
      T.linea(T.etiqueta.tipo, T.tipo.egreso) +
      T.linea(T.etiqueta.monto, montoLinea) +
      T.linea(T.etiqueta.categoria, categoriaTexto) +
      T.linea(T.etiqueta.detalle, v(es.descripcion)) +
      T.linea(T.etiqueta.pago, v(es.pagoPorNombre)) +
      T.linea(T.etiqueta.reparto, reparto) +
      T.linea(T.etiqueta.metodo, v(metodo)) +
      (es.fecha ? T.linea(T.etiqueta.fecha, escapeMarkdown(String(es.fecha))) : '') +
      (es.avisoReparto ? T.avisoReparto(escapeMarkdown(es.avisoReparto)) : '') +
      T.pie
    );
  }

  // El ámbito personal tiene otros campos: no hay paciente ni tratamiento, y
  // sí importan la categoría y el viaje al que se atribuye.
  if (esAmbitoPersonal(es)) {
    const viajeLinea = es.viajeNombre
      ? T.linea(T.etiqueta.viaje, T.viaje(escapeMarkdown(String(es.viajeNombre))))
      : '';
    return (
      T.encabezado +
      T.linea(T.etiqueta.ambito, T.ambito.personal) +
      T.linea(T.etiqueta.tipo, tipoTexto) +
      T.linea(T.etiqueta.monto, montoLinea) +
      T.linea(T.etiqueta.categoria, categoriaTexto) +
      T.linea(T.etiqueta.detalle, v(es.descripcion)) +
      T.linea(T.etiqueta.metodo, v(metodo)) +
      (es.fecha ? T.linea(T.etiqueta.fecha, escapeMarkdown(String(es.fecha))) : '') +
      viajeLinea +
      lineasComprobante(es) +
      T.pie
    );
  }

  const nombreLabel = esEgreso ? T.etiqueta.proveedor : T.etiqueta.paciente;
  const nombreValor = esEgreso ? es.proveedorNombre : es.pacienteNombre;

  // Cuando el término es ambiguo (alquiler, luz, expensas...) se avisa, porque
  // el default es consultorio y quizá no sea lo que el usuario quiso.
  const avisoAmbiguo = es.ambiguoAmbito ? T.avisoAmbiguo : '';
  // (Con casas compartidas el botón ofrece también cada casa.)

  return (
    T.encabezado +
    T.linea(T.etiqueta.ambito, T.ambito.consultorio) +
    T.linea(T.etiqueta.tipo, tipoTexto) +
    T.linea(T.etiqueta.monto, montoLinea) +
    T.linea(nombreLabel, v(nombreValor)) +
    T.linea(T.etiqueta.metodo, v(metodo)) +
    T.linea(T.etiqueta.estado, estadoTexto) +
    (es.comprobante ? '' : T.linea(T.etiqueta.tratamiento, v(es.tratamientoNombre))) +
    lineasComprobante(es) +
    avisoAmbiguo +
    T.pie
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

// Con casas compartidas el toggle binario no alcanza: se ofrece cada ámbito al
// que se puede mover el movimiento (menos el actual). Una casa solo para gastos.
function botonesDeAmbito(entities) {
  const es = entities || {};
  const actual = esAmbitoCasa(es) ? `casa:${es.casaId}` : (esAmbitoPersonal(es) ? 'personal' : 'consultorio');
  const opciones = [
    { target: 'consultorio', label: textos.nlpConfirm.botonConsultorio },
    { target: 'personal', label: textos.nlpConfirm.botonPersonal },
  ];
  if (esEgresoEntities(es)) {
    for (const c of es.casasDisponibles) opciones.push({ target: `casa:${c.casaId}`, label: textos.nlpConfirm.botonCasa(c.nombre) });
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
      Markup.button.callback(textos.nlpConfirm.guardar, 'nlp_save'),
      Markup.button.callback(textos.nlpConfirm.cancelar, 'nlp_cancel'),
    ],
    ...(tieneCasas
      ? botonesDeAmbito(entities)
      : [[Markup.button.callback(
        personal ? textos.nlpConfirm.botonEsDelConsultorio : textos.nlpConfirm.botonEsPersonal,
        'nlp_toggle_ambito'
      )]]),
  ];

  // Un gasto atribuido a un viaje se puede desatribuir sin tocar nada más: es
  // el caso de pagar la luz mientras estás de viaje.
  if (personal && (entities || {}).viajeId) {
    filas.push([Markup.button.callback(textos.nlpConfirm.noEsDelViaje, 'nlp_quitar_viaje')]);
  }

  filas.push([Markup.button.callback(textos.nlpConfirm.editarUnCampo, 'nlp_edit')]);
  return Markup.inlineKeyboard(filas);
}

function editFieldButtons(entities) {
  if (esAmbitoCasa(entities)) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(textos.nlpConfirm.monto, 'nlp_edit_monto'),
        Markup.button.callback(textos.nlpConfirm.metodo, 'nlp_edit_metodo'),
      ],
      [
        Markup.button.callback(textos.nlpConfirm.pago, 'nlp_edit_pago'),
        Markup.button.callback(textos.nlpConfirm.entreQuienes, 'nlp_edit_reparto'),
      ],
      [Markup.button.callback(textos.nlpConfirm.reescribir, 'nlp_edit_reescribir')],
    ]);
  }
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(textos.nlpConfirm.monto, 'nlp_edit_monto'),
      Markup.button.callback(textos.nlpConfirm.paciente, 'nlp_edit_paciente'),
    ],
    [
      Markup.button.callback(textos.nlpConfirm.metodo, 'nlp_edit_metodo'),
      Markup.button.callback(textos.nlpConfirm.tipo, 'nlp_edit_tipo'),
    ],
    [
      Markup.button.callback(textos.nlpConfirm.estado, 'nlp_edit_estado'),
      Markup.button.callback(textos.nlpConfirm.reescribir, 'nlp_edit_reescribir'),
    ],
  ]);
}

function discardButtons() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(textos.nlpConfirm.guardar, 'nlp_keep_old'),
      Markup.button.callback(textos.nlpConfirm.descartar, 'nlp_discard_old'),
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
        return ctx.reply(textos.nlpConfirm.montoInvalidoIngresaUnNumero);
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
          ? textos.nlpConfirm.hayMasDeUno(r.candidatos.map((c) => c.nombre).join(', '))
          : textos.nlpConfirm.noEncontrePersona);
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
        return ctx.reply(textos.nlpConfirm.noReconoci(desconocidos.join(', ') || text));
      }
      entities.repartoIds = ids;
      entities.repartoNombres = ids.map((id) => entities.miembrosCasa.find((m) => m.id === id).nombre);
      entities.avisoReparto = null;
      break;
    }
    case 'metodo_pago': {
      const m = text.toLowerCase().trim();
      if (!['efectivo', 'transferencia', 'tarjeta'].includes(m)) {
        return ctx.reply(textos.nlpConfirm.metodoInvalidoUsaEfectivoTransferencia);
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
        return ctx.reply(textos.nlpConfirm.tipoInvalidoUsaIngresoGasto);
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
        return ctx.reply(textos.nlpConfirm.estadoInvalidoUsaCobradoPendiente);
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
    const viajeTexto = viaje ? textos.nlpConfirm.viajeLinea(escapeMarkdown(viaje.nombre)) : '';

    // Aviso de presupuesto: solo para egresos y solo si hay uno definido.
    let alerta = '';
    if (String(movimiento.tipo).toLowerCase() === 'egreso') {
      const estado = await personalService.evaluarPresupuesto(userId, movimiento.categoria, movimiento.fecha);
      if (estado && estado.enAlerta) {
        const icono = estado.excedido ? '🔴' : '⚠️';
        alerta = textos.nlpConfirm.alertaPresupuesto({
          icono,
          categoria: categoriaTexto,
          gastado: formatMonto(estado.gastado, estado.moneda),
          limite: formatMonto(estado.limite, estado.moneda),
          porcentaje: estado.porcentaje,
          excedido: estado.excedido,
          restante: formatMonto(estado.restante, estado.moneda),
        });
      }
    }

    const extra = { parse_mode: 'Markdown' };
    // Lo personal vive en su propia sección (/personal, el botón 🏠 Personal de la
    // barra): el link tiene que llevar ahí, no a la pantalla del consultorio,
    // donde estos movimientos nunca aparecen.
    if (DASHBOARD_URL) {
      extra.reply_markup = { inline_keyboard: [[{ text: textos.nlpConfirm.botonVerEnPersonal, url: `${DASHBOARD_URL.replace(/\/+$/, '')}/personal` }]] };
    }

    // El resumen personal (bot y dashboard) muestra un mes por vez: si la fecha
    // del movimiento (p. ej. la de un comprobante viejo) cae en otro mes, no
    // va a estar en el mes actual y conviene decirlo en vez de dejar al usuario
    // buscándolo.
    const iso = personalService.fechaStrAIso(movimiento.fecha) || '';
    const avisoMes = iso && !iso.startsWith(personalService.mesActualIso())
      ? textos.nlpConfirm.avisoOtroMes(iso.slice(0, 7))
      : '';
    const esIngreso = String(movimiento.tipo).toLowerCase() === 'ingreso';
    return ctx.editMessageText(
      textos.nlpConfirm.personalRegistrado({
        esIngreso,
        descripcion: escapeMarkdown(movimiento.descripcion),
        monto: formatMonto(movimiento.monto, movimiento.moneda),
        fecha: escapeMarkdown(String(movimiento.fecha)),
        categoria: categoriaTexto,
        viaje: viajeTexto,
        alerta,
        avisoMes,
      }),
      extra
    );
  } catch (error) {
    if (error.message === 'monto_invalido') {
      return ctx.editMessageText(textos.nlpConfirm.elMontoNoEsValido);
    }
    if (error.message === 'descripcion_invalida') {
      return ctx.editMessageText(textos.nlpConfirm.faltaUnaDescripcionMasClara);
    }
    console.error('Error al guardar movimiento personal:', error.message);
    return ctx.editMessageText(textos.nlpConfirm.errorAlGuardarElGasto);
  }
}

// Cambia el ámbito del movimiento pendiente y RECUERDA la elección: la próxima
// vez que aparezca ese término ambiguo ya arranca en el ámbito correcto.
// `target`: 'consultorio' | 'personal' | 'casa:<casaId>'.
async function aplicarAmbito(ctx, target, comando) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) return ctx.editMessageText(textos.nlpConfirm.elMovimientoExpiroMandaloDe);

  const personalService = require('../services/personal.service');
  const { inferirCategoriaPersonal } = require('../services/personal-nlp.service');
  const { requierePersonalBot, requierePermisoBot } = require('../auth/bot-permisos');

  // En modo 'sheets' las pestañas personales son las del dueño: un invitado no puede
  // pasar un movimiento a ese ámbito tocando el botón. En modo 'supabase' cada persona
  // tiene el suyo (mismo criterio que marcarAmbito en text.js).
  if (target === 'personal' && !requierePersonalBot(ctx, comando)) return;
  // Volver al consultorio sí es cargar en el consultorio: ahí rige cargar_movimientos.
  if (target === 'consultorio' && !requierePermisoBot(ctx, 'cargar_movimientos', comando)) return;

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
      return ctx.reply(textos.nlpConfirm.noPertenecesAEsaCasa);
    }
    if (!esEgresoEntities(entities)) return ctx.reply(textos.nlpConfirm.enUnaCasaSoloSe);

    let miembros;
    try {
      miembros = await casaService.listarMiembros(userId, casaId);
    } catch (err) {
      if (err instanceof casaService.CasaError) return ctx.reply(mensajeError(err));
      throw err;
    }
    const yo = miembros.find((m) => m.userId === String(userId));
    if (!yo) return ctx.reply(textos.nlpConfirm.noPertenecesAEsaCasa);

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

    const viaje = await personalService.obtenerViajeActivo(userId).catch(err => { logSiAccionable('Personal', 'No se pudo leer el viaje activo', err); return null; });
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
    return ctx.reply(textos.nlpConfirm.opcionNoValida);
  }
  return aplicarAmbito(ctx, target, 'nlp_set_ambito');
}

async function handleNlpQuitarViaje(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) return ctx.editMessageText(textos.nlpConfirm.elMovimientoExpiroMandaloDe);

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
      ? textos.nlpConfirm.repartoTodos
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
      textos.nlpConfirm.casaRegistrado({
        casa: escapeMarkdown(entities.casaNombre || textos.nlpConfirm.casaLaCasa),
        descripcion: escapeMarkdown(movimiento.descripcion),
        monto: fmt(movimiento.monto, movimiento.moneda),
        pago: escapeMarkdown(nombre(movimiento.pagoPor)),
        reparto,
        categoria: escapeMarkdown(String(movimiento.categoria || '').replace(/_/g, ' ')),
        saldos,
      }),
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    if (error instanceof casaService.CasaError) return ctx.editMessageText(mensajeError(error));
    console.error('Error al guardar gasto de casa:', error.message);
    return ctx.editMessageText(textos.nlpConfirm.errorAlGuardarElGasto2);
  }
}

// ── Action handlers (exported for testing) ────────────────────────────────────

async function handleNlpSave(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) {
    return ctx.editMessageText(textos.nlpConfirm.elMovimientoExpiroMandaloDe);
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

  // Último control antes de escribir en el consultorio (el movimiento puede haber entrado
  // como personal sin ese permiso).
  if (!require('../auth/bot-permisos').requierePermisoBot(ctx, 'cargar_movimientos', 'nlp_save')) return;

  try {
    const resultado = await cmd.registrarMovimientoDesdeNLP(userId, pending.entities);
    // Si vino de una foto/PDF, el comprobante queda registrado aunque el
    // movimiento todavía necesite un dato (método de pago, cotización): el
    // vínculo viaja en ReferenciaId y se completa cuando se guarde.
    if (pending.entities.comprobante && (resultado.success || resultado.necesitaInfo)) {
      await require('./comprobante').registrarComprobanteDesdeEntities(userId, pending.entities, { idMovimiento: resultado.idUnico || null });
    }
    if (resultado.necesitaInfo) {
      await ctx.editMessageText(textos.nlpConfirm.completandoDatos);
      return ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });
    }
    if (resultado.success) {
      const extra = { parse_mode: 'Markdown' };
      if (DASHBOARD_URL) extra.reply_markup = { inline_keyboard: [[{ text: '📊 Ver Dashboard', url: DASHBOARD_URL }]] };
      return ctx.editMessageText(resultado.mensaje, extra);
    }
    return ctx.editMessageText(textos.nlpConfirm.noSePudoRegistrarIntenta);
  } catch (error) {
    console.error('Error al guardar NLP:', error.message);
    return ctx.editMessageText(textos.nlpConfirm.errorAlGuardarIntentaDe);
  }
}

async function handleNlpCancel(ctx) {
  await ctx.answerCbQuery();
  state.pendingNlpMovimientos.delete(ctx.from.id);
  return ctx.editMessageText(textos.nlpConfirm.canceladoPodesVolverAEscribirlo);
}

async function handleNlpEdit(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  if (!state.pendingNlpMovimientos.has(userId)) {
    return ctx.editMessageText(textos.nlpConfirm.elMovimientoExpiroMandaloDe);
  }
  return ctx.editMessageText(textos.nlpConfirm.queCampoQueresEditar, {
    parse_mode: 'Markdown',
    ...editFieldButtons((state.pendingNlpMovimientos.get(userId) || {}).entities),
  });
}

function makeEditCampoHandler(campo, prompt) {
  return async function handleNlpEditCampo(ctx) {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const pending = state.pendingNlpMovimientos.get(userId);
    if (!pending) return ctx.editMessageText(textos.nlpConfirm.elMovimientoExpiroMandaloDe);
    pending.editingCampo = campo;
    state.pendingNlpMovimientos.set(userId, pending);
    await ctx.reply(prompt);
  };
}

async function handleNlpEditReescribir(ctx) {
  await ctx.answerCbQuery();
  state.pendingNlpMovimientos.delete(ctx.from.id);
  return ctx.editMessageText(textos.nlpConfirm.movimientoDescartadoEscribiElMovimiento);
}

async function handleNlpKeepOld(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) return ctx.editMessageText(textos.nlpConfirm.elMovimientoExpiroMandaloDe);
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
  return ctx.editMessageText(textos.nlpConfirm.movimientoDescartadoMandaElNuevo);
}

const handleNlpEditMonto    = makeEditCampoHandler('monto',         textos.nlpConfirm.pedirMonto);
const handleNlpEditPaciente = makeEditCampoHandler('pacienteNombre',textos.nlpConfirm.pedirPaciente);
const handleNlpEditMetodo   = makeEditCampoHandler('metodo_pago',   textos.nlpConfirm.pedirMetodo);
const handleNlpEditTipo     = makeEditCampoHandler('tipo',          textos.nlpConfirm.pedirTipo);
const handleNlpEditEstado   = makeEditCampoHandler('estado',        textos.nlpConfirm.pedirEstado);
const handleNlpEditPago     = makeEditCampoHandler('pagoPor',       textos.nlpConfirm.pedirPago);
const handleNlpEditReparto  = makeEditCampoHandler('reparto',       textos.nlpConfirm.pedirReparto);

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
