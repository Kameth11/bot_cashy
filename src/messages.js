'use strict';

/**
 * Todos los textos que el bot le manda a las personas, en un solo lugar.
 *
 * Para cambiar cómo habla el bot se edita este archivo y nada más: los handlers y
 * los servicios solo llaman a estas funciones (`textos.comun.confirmacionPendiente`,
 * `textos.movimiento.registrado({...})`, etc.) y deciden CUÁNDO mandar cada mensaje,
 * nunca QUÉ dice. La lógica (validaciones, estados, botones, parse_mode) vive en
 * cada handler y no cambia por tocar un texto de acá.
 *
 * Reglas de estilo para los textos reescritos (bienvenida, ayuda, confirmaciones,
 * errores): voseo rioplatense, tono cálido pero profesional, la información clave
 * primero, un emoji como máximo por mensaje y solo si aporta, negritas solo en
 * montos y totales, y en los errores siempre qué falló + cómo escribirlo bien.
 *
 * Ojo con el formato: si el handler manda el mensaje con parse_mode 'Markdown',
 * los `*`, `_`, `` ` `` y `[` tienen que estar balanceados (usar escapeMarkdown para
 * lo que escribe el usuario). Si lo manda sin parse_mode, el texto va sin marcas.
 * Hay textos que los tests fijan por una frase (ej. "confirmación pendiente",
 * "Cómo pagaste", "límite diario de uso de IA", "No entendí", "expiró",
 * "Cancelado"): si los reescribís, mantené esa frase o actualizá el test.
 */

const { escapeMarkdown } = require('./utils/formatter');

// ─── Helpers de formato ──────────────────────────────────────────────────────

const SIMBOLO_MONEDA = { Pesos: '$', 'Dólares': 'U$', Dolares: 'U$', Euros: '€' };

/** "$15.000", "U$50", "€200" (siempre en positivo: el signo lo da el tipo). */
function montoConMoneda(monto, moneda) {
  const simbolo = SIMBOLO_MONEDA[moneda] || '$';
  return `${simbolo}${Math.abs(monto).toLocaleString('es-AR')}`;
}

function capitalizar(texto) {
  const t = String(texto || '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ─── Comunes ─────────────────────────────────────────────────────────────────

const comun = {
  procesandoMensajeAnterior:
    'Un segundito, todavía estoy procesando tu mensaje anterior.',
  mensajeInvalido:
    'No pude leer ese mensaje porque está vacío o es demasiado largo. ¿Lo probás de nuevo, más corto?',
  confirmacionPendiente:
    'Antes de seguir, tenés una confirmación pendiente. Usá los botones del mensaje de arriba o /cancelar para descartarla.',
  sinCuenta:
    'Todavía no tenés una cuenta registrada. Escribí /start y te ayudo a crearla.',
  errorInesperado:
    'Algo salió mal de mi lado. Probá de nuevo en un momento.',
  errorAlGuardar:
    'No pude guardar el movimiento. Probá de nuevo en un momento; si sigue fallando, avisale al administrador.',
  errorAlRegistrar:
    'No pude registrar el movimiento. Probá de nuevo o escribí /ayuda para ver ejemplos.',
  registrando: 'Registrando, un momento...',
  procesando: '🧠 Procesando...',
  procesandoFullIA: '🧠 Procesando (Full IA)...',
  limiteDiarioIA: (limite) =>
    `Llegaste al límite diario de uso de IA de tu consultorio (${limite} mensajes), así que por hoy la dejo descansar. ` +
    'Igual podés seguir cargando con un formato claro, por ejemplo: consulta Juan $15000 efectivo. Mañana se renueva.',
  noEntendi:
    'No entendí bien ese mensaje 🤔\n\n' +
    'Probá con un formato más claro, por ejemplo:\n' +
    '  • consulta Juan $15000 efectivo\n' +
    '  • gasto insumos $500 transferencia\n' +
    '  • me deben €200 de García\n\n' +
    'O usá /registrar y lo cargamos paso a paso.',
};

// ─── Bienvenida y registro ───────────────────────────────────────────────────

const registro = {
  bienvenida: () =>
    '¡Hola! Soy Cashy, tu asistente para llevar los ingresos y gastos del consultorio.\n\n' +
    'Para cargar un movimiento, escribilo como lo dirías vos:\n' +
    '`consulta Juan Pérez $15000 efectivo` (ingreso en pesos)\n' +
    '`servicio Endodoncia U$50 transferencia` (ingreso en dólares)\n' +
    '`gasto Insumos $-500` (gasto)\n\n' +
    'Para ver cómo viene la caja:\n' +
    '`/hoy` movimientos de hoy\n' +
    '`/pendientes` lo que falta cobrar\n' +
    '`/balance` resumen completo\n\n' +
    'Con `/ayuda` ves todo lo que puedo hacer.',

  pedirEmail: () =>
    'Para empezar necesito tu email corporativo.\n' +
    'Escribilo así: `juan@tuempresa.com`\n\n' +
    'Solo pueden registrarse emails autorizados.\n' +
    'Si tenés un código de invitación, usá `/unir CODIGO`. Para salir, /cancelar.',

  // Instrucciones para conectar el Google Sheet. Se manda a veces con parse_mode
  // y a veces sin él, así que no lleva ninguna marca de formato.
  configurarSheet: (titulo, emailServiceAccount) =>
    `${titulo}\n\n` +
    'Ahora conectemos tu Google Sheet.\n\n' +
    'Paso 1: compartí tu sheet con este email, dándole permiso de Editor:\n' +
    `${emailServiceAccount}\n\n` +
    'Paso 2: escribime el ID de tu spreadsheet. Lo encontrás en la URL: ' +
    'docs.google.com/spreadsheets/d/EL-ID-DE-TU-SHEET/edit\n\n' +
    'Si querés salir, usá /cancelar.',
  tituloSolicitudAprobada: '¡Tu solicitud fue aprobada!',
  tituloEmailVerificado: '¡Email verificado!',
  tituloEmailAprobado: '¡Email aprobado!',

  demasiadosIntentos:
    'Ya van varios intentos con el email. Escribí /start y probamos de nuevo desde el principio.',
  emailInvalido: (intentos, maximo) =>
    `Ese email no parece válido (intento ${intentos} de ${maximo}). Escribilo así: juan@empresa.com`,
  solicitudEnRevision:
    'Tu solicitud ya está en revisión. Apenas la aprueben te aviso por acá.',
  solicitudRechazada:
    'Tu solicitud no fue aprobada. Para más información, hablá con el administrador.',
  errorAlProcesarSolicitud:
    'No pude procesar tu solicitud. Probá de nuevo en un rato.',
  avisoAdminNuevaSolicitud: (email, userId) =>
    `🔔 *Nueva solicitud de acceso*\n\n📧 Email: \`${email}\`\nID Telegram: \`${userId}\`\n\nUsá /aprobar ${email} para aprobarla.`,
  solicitudEnviada:
    'Listo, recibí tu solicitud de acceso.\n' +
    'Apenas la aprueben te aviso por acá. Si tenés dudas, hablá con el administrador.',

  sheetIdCorto:
    'Ese ID parece demasiado corto. Revisalo y mandámelo de nuevo, por favor.',
  sheetEnUso:
    'Ese Google Sheet ya está en uso por otra cuenta. Creá uno propio (o pedile ayuda al administrador si creés que es un error) y mandame su ID.',
  sheetSinHojas:
    'El spreadsheet no tiene ninguna hoja. Creá una pestaña y mandame el ID de nuevo.',
  registroCompleto: (email) =>
    '¡Listo, quedaste registrado!\n\n' +
    `Email: ${email}\n` +
    'Tu sheet ya está conectado. Escribí /start para empezar.',
  botonDashboard: '📊 Abrir Dashboard',
  sheetSinAcceso: (emailServiceAccount) =>
    'No pude acceder a ese sheet. Revisá que:\n' +
    '• el ID sea el correcto\n' +
    '• el sheet exista\n' +
    `• lo hayas compartido con ${emailServiceAccount}\n\n` +
    'Y mandame el ID de nuevo.',
  estadoInvalido:
    'Algo se desordenó en el registro. Escribí /cancelar y empezamos de nuevo.',
};

// ─── Ayuda ───────────────────────────────────────────────────────────────────

const ayuda = {
  completa: () =>
    'Acá tenés todo lo que puedo hacer. Si algo no sale, escribime como te salga y lo intento entender.\n\n' +
    'Cargar un movimiento\n' +
    '`consulta Juan Pérez $15000 efectivo` ingreso en pesos\n' +
    '`servicio Endodoncia U$50 transferencia` ingreso en dólares\n' +
    '`gasto Insumos $-500` gasto en pesos\n' +
    '`pendiente María López $30000` queda por cobrar\n' +
    'También sirve `/pendiente [paciente/concepto] $[monto]`.\n' +
    '`/ingreso_paciente` carga guiada con paciente, profesional y categoría\n\n' +
    'También entiendo frases como:\n' +
    '`cobré 15000 de Juan Pérez en efectivo`\n' +
    '`gasté 5000 en alquiler`\n' +
    '`cuánto tengo?`\n' +
    '`pendientes`\n\n' +
    'Primero busco palabras clave sin usar IA; si no alcanza, uso el parser remoto para entender lenguaje natural.\n\n' +
    'Fotos y PDFs\n' +
    'Mandame una foto de tu agenda o turnero para cargar los turnos, o una foto o PDF de una factura o ticket para cargar el gasto. Detecto solo de qué se trata.\n' +
    '`/editarturno` corrige los datos de un turno de hoy\n\n' +
    'Monedas y medios de pago\n' +
    '$ pesos, U$ o USD dólares, € euros\n' +
    'efectivo, transferencia o tarjeta\n\n' +
    'Reportes\n' +
    '`/balance` resumen completo\n' +
    '`/hoy` movimientos de hoy\n' +
    '`/pendientes` lo que falta cobrar\n' +
    '`/semana` resumen semanal\n' +
    '`/mes` balance del mes\n' +
    '`/ingresos` solo ingresos\n' +
    '`/egresos` solo gastos\n\n' +
    'Reportes de gestión\n' +
    '`/cobros_por_metodo` cobros del mes por método\n' +
    '`/egresos_categoria` egresos del mes por categoría\n' +
    '`/por_profesional` ingresos del mes por profesional\n' +
    '`/deudores` saldos pendientes por paciente\n\n' +
    'Cobrar\n' +
    '`/cobrar ultimo` cobra el último pendiente\n' +
    '`/cobrar [nombre]` cobra el que coincida\n' +
    '`/cobrar [nombre] [monto]` registra un cobro parcial\n\n' +
    'Editar y eliminar\n' +
    '`/editar [nombre]` cambia la descripción y el monto\n' +
    '`/eliminar [nombre]` elimina un movimiento\n' +
    '`/listar` muestra todos los movimientos\n\n' +
    'Dólar\n' +
    '`/dolar` cotización actual\n' +
    '`/actualizardolar` actualiza la cotización\n\n' +
    'Tu Google Sheet\n' +
    '`/sheet` link a tu planilla\n\n' +
    'Invitaciones\n' +
    '`/codigo` genera un código de invitación (solo el dueño)\n' +
    '`/unir CODIGO` te suma a una cuenta con un código\n\n' +
    'Finanzas personales\n' +
    'Escribí el gasto y lo categorizo solo: `nafta 20000`, `super 45000`\n' +
    '`/personal` resumen del mes por categoría\n' +
    '`/viaje nuevo Brasil 10/01 20/01` abre un viaje\n' +
    '`/viaje` muestra el viaje activo y su total\n' +
    '_Si me equivoco de ámbito, corregilo con el botón y lo recuerdo._\n\n' +
    'Casa (gastos compartidos)\n' +
    '`/casa nueva Casa` crea una casa, `/casa invitar` invita\n' +
    '`/casa` resumen y saldos, `/casa saldar Ana 5000` registra un pago\n' +
    '`/casa ayuda` todos los comandos de casa\n\n' +
    'Modo IA\n' +
    '`/modoia` muestra el estado del modo Full IA\n' +
    '`/modoia on` o `/modoia off` lo activa o desactiva',
};

// ─── Movimientos: confirmaciones y errores de carga ──────────────────────────

const movimiento = {
  /**
   * Confirmación de un movimiento ya guardado. Va con parse_mode 'Markdown'.
   * Tres líneas: qué se registró y cuánto, descripción y método, estado.
   */
  registrado: ({ tipo, descripcion, monto, moneda, metodoPago, cotizacionUsada = null, montoPesos = null, estado = 'Cobrado' }) => {
    const esIngreso = tipo === 'Ingreso';
    const pendiente = (estado || 'Cobrado') === 'Pendiente';
    const apertura = pendiente
      ? 'Dejé anotado el pendiente'
      : esIngreso ? 'Listo, registré el ingreso' : 'Listo, registré el gasto';

    const conCotizacion = (moneda === 'Dólares' || moneda === 'Euros') && cotizacionUsada;
    let montoTexto = `*${montoConMoneda(monto, moneda)}*`;
    if (conCotizacion && montoPesos !== null && montoPesos !== undefined) {
      montoTexto += ` (*$${Math.abs(montoPesos).toLocaleString('es-AR')}*)`;
    }

    const detalle = metodoPago
      ? `${escapeMarkdown(descripcion)} · ${capitalizar(metodoPago)}`
      : escapeMarkdown(descripcion);

    const estadoTexto = pendiente ? 'Pendiente ⏳' : (esIngreso ? 'Cobrado ✅' : 'Pagado ✅');
    const cotizacionTexto = conCotizacion
      ? ` · cotización $${cotizacionUsada.toLocaleString('es-AR')}`
      : '';

    return `${apertura}: ${montoTexto}\n${detalle}\n${estadoTexto}${cotizacionTexto}`;
  },

  // Estos dos los fija un test con igualdad exacta (command.service.test.js): si los cambiás, actualizá el test.
  pedirMonto: '💰 ¿De cuánto es el movimiento? Ingresá el monto:',
  pedirDescripcion: '📝 ¿De quién o qué concepto es el movimiento?',

  // Dólares: pedir la cotización antes de guardar (parse_mode 'Markdown').
  pedirCotizacion: (monto, promedioActual) =>
    `Movimiento en dólares por *U$${Math.abs(monto).toLocaleString('es-AR')}*.\n` +
    (promedioActual ? `El promedio actual es $${promedioActual.toLocaleString('es-AR')}.\n` : '') +
    'Pasame la cotización del dólar para este movimiento, por ejemplo: 1250',

  // Medio de pago (parse_mode 'Markdown').
  preguntarMetodo:
    '¿Cómo pagaste? Respondeme: efectivo, transferencia o tarjeta.',

  errorDescripcion: 'La descripción no es válida. Escribí un nombre o concepto, por ejemplo: consulta Juan $15000 efectivo',
  errorDescripcionCorta: 'La descripción quedó muy corta. Escribí un nombre o concepto, por ejemplo: Juan Pérez',
  errorMontoInvalido: 'No pude tomar ese monto: tiene que ser un número distinto de 0 y no demasiado grande. Por ejemplo: $15000',
  errorMontoPositivo: 'No pude tomar ese monto. Escribilo como número, por ejemplo: 15000',
  errorCotizacion: 'No pude tomar esa cotización. Escribila como número positivo, por ejemplo: 1250',
  errorMetodo: 'Ese método de pago no lo conozco. Respondeme: efectivo, transferencia o tarjeta.',
  errorFecha: 'Esa fecha parece inválida. Escribila como DD/MM o DD/MM/AAAA, por ejemplo: 25/09 o 25/09/2026',
};

// ─── Carga guiada (/ingreso_paciente), paso a paso ───────────────────────────

const flujoGuiado = {
  pedirProfesional: '2. ¿Qué profesional fue el responsable? Escribí el nombre.',
  errorPaciente: 'Ese nombre de paciente no es válido. Escribilo de nuevo, por ejemplo: Juan Pérez',
  errorProfesional: 'Ese nombre de profesional no es válido. Escribilo de nuevo, por ejemplo: Dra. López',
  pedirCategoria:
    '3. ¿De qué categoría es?\n\n' +
    'consulta / tratamiento / anticipo / seña / cuota / saldo final',
  errorCategoria:
    'No reconocí esa categoría. Elegí una de estas: consulta / tratamiento / anticipo / seña / cuota / saldo final',
  // parse_mode 'Markdown'
  pedirDetalle:
    '4. Si querés, escribí el tratamiento o algún detalle. Para omitirlo, respondé `-`.',
  errorDetalle: 'Ese detalle no es válido. Escribilo de nuevo o respondé - para omitirlo.',
  pedirMonto: '5. ¿De cuánto es? Escribí el monto, por ejemplo: 15000',
  pedirMoneda: '6. ¿En qué moneda? Pesos, dólares o euros.',
  errorMoneda: 'No reconocí esa moneda. Respondeme: pesos, dólares o euros.',
  pedirCobrado: '7. ¿Ya se cobró? Respondé sí o no.',
  errorCobrado: 'No entendí la respuesta. Respondeme: sí o no.',
  pedirMetodo: '8. ¿Con qué método se pagó? efectivo / transferencia / tarjeta',
};

// ─── Edición de movimientos y de turnos ──────────────────────────────────────

const edicion = {
  valorVacio: 'El valor no puede quedar vacío. Escribilo de nuevo, por favor.',
  horaInvalida: 'Esa hora no es válida. Escribila como HH:MM, por ejemplo: 10:00',
  // parse_mode 'Markdown'
  turnoActualizado: (label, valor) => `Listo, ${label} quedó en: \`${escapeMarkdown(valor)}\``,
  errorTurno: 'No pude guardar el cambio. Probá de nuevo con /editarturno.',
  errorDescripcion: 'Esa descripción no es válida. Escribí un texto más claro y corto.',
  // parse_mode 'Markdown'; montoActual ya viene formateado ("$15.000")
  pedirNuevoMonto: (montoActual) =>
    `El monto actual es *${montoActual}*.\n` +
    'Escribí el nuevo monto, o enviá "- -" para dejarlo igual.',
  sinCambios: 'No hiciste ningún cambio, así que dejé todo como estaba.',
  // parse_mode 'Markdown'; monto ya viene formateado
  resumenCambios: (descripcion, monto) =>
    'Así quedaría:\n' +
    `${escapeMarkdown(descripcion)}\n` +
    `Monto: *${monto}*`,
};

// ─── Confirmación previa a guardar ("Esto es lo que entendí") ────────────────
// Los tests fijan casi todas estas etiquetas y valores (Egreso 🔴, Ingreso 💚,
// Pendiente ⏳, "Pagó", "Reparto", "¿Es correcto?", etc.): si los cambiás,
// actualizá tests/nlp-confirm*.test.js. Va con parse_mode 'Markdown'.

const confirmacion = {
  encabezado: 'Esto es lo que entendí:\n\n',
  pie: '\n_¿Es correcto?_',
  linea: (etiqueta, valor) => `• ${etiqueta}: ${valor}\n`,
  etiqueta: {
    ambito: 'Ámbito',
    tipo: 'Tipo',
    monto: 'Monto',
    categoria: 'Categoría',
    detalle: 'Detalle',
    pago: 'Pagó',
    reparto: 'Reparto',
    metodo: 'Método',
    fecha: 'Fecha',
    viaje: 'Viaje',
    estado: 'Estado',
    tratamiento: 'Tratamiento',
    proveedor: 'Proveedor',
    paciente: 'Paciente',
    comprobante: 'Comprobante',
    vence: 'Vence',
    items: 'Ítems',
  },
  ambito: {
    casa: (nombre) => `🏡 Casa — ${nombre}`,
    personal: '🏠 Personal',
    consultorio: '🏥 Consultorio',
  },
  tipo: { egreso: 'Egreso 🔴', ingreso: 'Ingreso 💚' },
  estado: { pendiente: 'Pendiente ⏳', cobrado: 'Cobrado' },
  monedaLabel: { 'Dólares': ' dólares', Euros: ' euros', Pesos: ' pesos' },
  repartoTodos: (lista) => `todos (${lista})`,
  viaje: (nombre) => `✈️ ${nombre}`,
  comprobanteGenerico: 'comprobante',
  cuit: (cuit) => `CUIT ${cuit}`,
  avisoReparto: (texto) => `\n⚠️ _${texto}_\n`,
  avisoAmbiguo: '\n⚠️ _Asumí que es del consultorio. Si es de tu casa, tocá el botón._\n',
  duplicadoMismaImagen: (cuando) =>
    `\n⚠️ _Esta misma imagen ya se cargó${cuando}. Si la guardás, queda duplicado._\n`,
  duplicadoMismoComprobante: (cuando) =>
    `\n⚠️ _Ya hay un comprobante con el mismo emisor, número y total${cuando}. Revisá que no sea el mismo._\n`,
  cargadoEl: (fecha) => ` (cargado el ${fecha})`,
};

// ─── Edición de campos y confirmaciones de Personal y Casa ───────────────────

const nlpConfirmDatos = {
  // Qué pedirle a la persona cuando elige "Editar un campo".
  pedirMonto: 'Escribí el nuevo monto, por ejemplo: 15000',
  pedirPaciente: 'Escribí el nombre del paciente.',
  pedirMetodo: 'Escribí el método: efectivo / transferencia / tarjeta',
  pedirTipo: 'Escribí el tipo: ingreso o gasto',
  pedirEstado: 'Escribí el estado: cobrado o pendiente',
  pedirPago: '¿Quién pagó? Escribí el nombre, por ejemplo: Ana',
  pedirReparto: '¿Entre quiénes se reparte? Escribí los nombres separados por "y" (por ejemplo: Ana y Beto) o "todos".',
  hayMasDeUno: (nombres) => `Hay más de una persona que coincide: ${nombres}. Escribí el nombre completo.`,
  noEncontrePersona: 'No encontré a esa persona en la casa. Escribí el nombre como figura en /casa miembros.',
  noReconoci: (nombres) => `No reconocí a: ${nombres}. Escribí los nombres separados por "y" (por ejemplo: Ana y Beto) o "todos".`,
  botonConsultorio: '🏥 Consultorio',
  botonPersonal: '🏠 Personal',
  botonCasa: (nombre) => `🏡 ${nombre}`,
  botonEsDelConsultorio: '🏥 Es del consultorio',
  botonEsPersonal: '🏠 Es personal',
  botonVerEnPersonal: '🏠 Ver en Personal',

  // Gasto o ingreso personal ya guardado (parse_mode 'Markdown'). Los tests fijan
  // "Gasto personal registrado" e "Ingreso personal registrado".
  viajeLinea: (nombre) => `\n✈️ Viaje: ${nombre}`,
  alertaPresupuesto: ({ icono, categoria, gastado, limite, porcentaje, excedido, restante }) =>
    `\n\n${icono} *${categoria}*: ${gastado} de ${limite} (${porcentaje}%)` +
    (excedido
      ? `\n_Te pasaste del presupuesto del mes._`
      : `\n_Te quedan ${restante} este mes._`),
  avisoOtroMes: (mes) =>
    `\n\n📆 _Ojo: la fecha es de otro mes (${mes}). Lo vas a ver en Personal → ese mes, no en el actual._`,
  personalRegistrado: ({ esIngreso, descripcion, monto, fecha, categoria, viaje, alerta, avisoMes }) =>
    `✅ *${esIngreso ? 'Ingreso' : 'Gasto'} personal registrado*\n\n` +
    `🏠 ${descripcion}\n` +
    `💰 ${monto}\n` +
    `📅 ${fecha}\n` +
    `🏷️ ${categoria}${viaje}${alerta}${avisoMes}`,

  // Gasto de casa ya guardado (parse_mode 'Markdown'). Los tests fijan
  // "Gasto registrado en <casa>", "Pagó: ..." y "Reparto: ...".
  casaRegistrado: ({ casa, descripcion, monto, pago, reparto, categoria, saldos }) =>
    `✅ *Gasto registrado en ${casa}*\n\n` +
    `🏡 ${descripcion}\n` +
    `💰 ${monto}\n` +
    `👤 Pagó: ${pago}\n` +
    `👥 Reparto: ${reparto}\n` +
    `🏷️ ${categoria}${saldos}`,
  casaLaCasa: 'la casa',
  repartoTodos: 'todos',
};

// ─── Acciones de botones: eliminar, reiniciar, editar, agenda ────────────────

const plural = (n, singular, plural) => `${n} ${n !== 1 ? plural : singular}`;

const accionesDatos = {
  // parse_mode 'Markdown'; descripcion ya viene escapada y monto formateado.
  movimientoEliminadoConMonto: (descripcion, monto) =>
    `Listo, eliminé el movimiento.\n${descripcion} · *${monto}*`,
  movimientoEliminado: (descripcion) =>
    `Listo, eliminé el movimiento.\n${descripcion}`,
  movimientoActualizado: (descripcion, monto) =>
    `Listo, actualicé el movimiento.\n${descripcion} · *${monto}*`,

  registroReiniciadoConSheet:
    'Reinicié tu registro: borré tus datos locales y todos los movimientos del sheet.\n\n' +
    'Escribí /start para registrarte de nuevo.',
  registroReiniciadoSheetSinLimpiar:
    'Reinicié tu registro y borré tus datos locales, pero no pude limpiar el sheet (revisá que esté compartido).\n\n' +
    'Escribí /start para registrarte de nuevo.',
  registroReiniciadoSinSheet:
    'Reinicié tu registro y borré tus datos. No tenías un sheet configurado.\n\n' +
    'Escribí /start para registrarte de nuevo.',

  // parse_mode 'Markdown'
  turnosGuardados: (cantidad, fechaStr, reemplazados = null) =>
    (cantidad === 1
      ? `Listo, quedó guardado 1 turno en tu Agenda para el ${fechaStr}.`
      : `Listo, quedaron guardados ${cantidad} turnos en tu Agenda para el ${fechaStr}.`) +
    (reemplazados !== null ? `\nReemplacé ${plural(reemplazados, 'turno duplicado', 'turnos duplicados')}.` : '') +
    '\nLos ves en tu Google Sheet, en las pestañas "Agenda" y "Turnos".',
  turnosDuplicados: (cantidad, fecha, nombres) =>
    `Encontré ${plural(cantidad, 'turno', 'turnos')} que ya ${cantidad !== 1 ? 'existen' : 'existe'} para el ${fecha} (misma hora y paciente): ${nombres}\n\n` +
    '¿Reemplazo esos turnos o agrego todo como nuevo?',
  editarTurnoPregunta: (hora, cliente) =>
    `${hora} · ${cliente}\n\n¿Qué campo querés editar?`,
  turnoSinNombre: 'Sin nombre',
  campoValorActual: (label, valor) =>
    `${label}\nValor actual: \`${valor}\`\n\nEscribí el nuevo valor:`,
  campoVacio: '(vacío)',
};

// ─── Agenda por consulta ("¿qué turnos tengo hoy?") ──────────────────────────

const agendaConsulta = {
  diaAmbiguo: 'No entendí bien qué día pedías, te muestro hoy.\n\n',
  sinTurnos: (aviso, fecha) => `${aviso}No tenés turnos cargados para el ${fecha}.`,
  turnosDelDia: (aviso, fecha, lista) => `${aviso}Turnos del ${fecha}:\n${lista}`,
  turno: (hora, cliente) => `${hora || '??:??'} — ${cliente || 'Sin nombre'}`,
  deProfesional: (profesional, lineas) => `${profesional}:\n${lineas}`,
  sinProfesional: (lineas) => `Sin profesional asignado:\n${lineas}`,
};

// ─── Cobros y pagos parciales (parse_mode 'Markdown') ────────────────────────

const parciales = {
  cobroParcial: ({ nombre, cobrado, metodo, pendiente, total, comandoCobrar }) =>
    `Listo, registré el cobro parcial${nombre}\n\n` +
    `Cobrado: *${cobrado}*${metodo}\n` +
    `Pendiente: *${pendiente}*` +
    `${total}\n\n` +
    `Cuando lo cobres, usá: \`${comandoCobrar}\``,
  totalLinea: (total) => `\nTotal: *${total}*`,
  pagoParcial: ({ nombre, pagado, metodo, deuda, comandoCobrar }) =>
    `Listo, registré el pago parcial${nombre}\n\n` +
    `Pagado: *${pagado}*${metodo}\n` +
    `Todavía debemos: *${deuda}*\n\n` +
    `Cuando termines de pagar, marcalo desde el dashboard o usá: \`${comandoCobrar}\``,
  nombreGuion: (nombre) => ` — ${nombre}`,
  metodoEntreParentesis: (metodo) => ` (${metodo})`,
};

// ─── Límites de uso, tamaños y avisos de fotos y audios ──────────────────────

const limites = {
  mediaDiarioIA: (limite) =>
    `Llegaste al límite diario de lectura de fotos y audios de tu consultorio (${limite}). ` +
    'Se renueva mañana; mientras tanto podés cargar los movimientos por texto.',
  archivoPesado: (maximoMB) => `Ese archivo es demasiado pesado (el máximo es ${maximoMB} MB). Probá con uno más liviano.`,
  audioLargo: (maximoSeg) => `Ese audio es demasiado largo (el máximo es ${maximoSeg} segundos). Probá con uno más corto.`,
  audioPesado: (maximoMB) => `Ese audio es demasiado pesado (el máximo es ${maximoMB} MB). Probá con uno más corto.`,
  mensajeLargo: (maximo) => `Ese mensaje es demasiado largo (el máximo es ${maximo} caracteres). Probá con uno más corto.`,
  imagenNoEsAgenda:
    'La imagen no parece ser una agenda o turnero. Mandame una foto de la agenda con los turnos y los cargo.',
  demasiadosTurnos: (cantidad) =>
    `Detecté demasiados turnos (${cantidad}). Probá recortando la imagen antes de enviarla.`,
  procesandoImagen: '📸 Procesando imagen...',
  procesandoAgenda: '📸 Procesando agenda...',
  transcripcion: (texto) => `🎤 "${texto}"`,
};

// ─── Resto de handlers (texto original, movido sin cambios) ─────────────────

const actions = {
  ...accionesDatos,
  confirmar: '✅ Confirmar',
  cancelar: '❌ Cancelar',
  sesionExpiradaEjecutaEliminarDe: 'Sesión expirada. Escribí /eliminar para empezar de nuevo.',
  elementoNoEncontrado: 'No encontré ese elemento. Probá de nuevo desde el principio.',
  siEliminar: '✅ Sí, eliminar',
  volver: '↩️ Volver',
  errorAlEliminarVerificaLos: 'No pude eliminar el movimiento. Probá de nuevo; si sigue fallando, avisale al administrador.',
  cancelado: 'Cancelado, no se hizo ningún cambio.',
  estaAccionYaFueProcesada: 'Esta acción ya se procesó o venció. Si querés, empezá de nuevo.',
  usaLosBotonesDelMensaje: 'Usá los botones del mensaje anterior para seguir.',
  errorAlEliminarMovimientoVerifica: 'No pude eliminar el movimiento. Probá de nuevo; si sigue fallando, avisale al administrador.',
  eliminacionCancelada: 'Eliminación cancelada, no se borró nada.',
  eliminandoFilas: '⏳ Eliminando filas...',
  errorDuranteLaLimpiezaIntenta: 'Hubo un problema durante la limpieza. Probá de nuevo en un momento.',
  limpiezaCanceladaNingunaFilaFue: 'Limpieza cancelada. No se eliminó ninguna fila.',
  reinicioCancelado: 'Reinicio cancelado, no se cambió nada.',
  errorAlGuardarCambios: 'No pude guardar los cambios. Probá de nuevo en un momento.',
  edicionCancelada: 'Edición cancelada, quedó todo como estaba.',
  hoy: 'Hoy',
  manana: 'Mañana',
  otraFecha: '📆 Otra fecha',
  paraQueDiaEsEsta: '¿Para qué día es esta agenda?',
  turnosDescartados: 'Listo, descarté los turnos.',
  guardandoTurnosEnAgenda: '⏳ Guardando turnos en Agenda...',
  reemplazarDuplicados: '🔄 Reemplazar duplicados',
  agregarTodo: '➕ Agregar todo',
  errorAlGuardarLosTurnos: 'No pude guardar los turnos en la agenda. Probá de nuevo en un momento.',
  procesando: '⏳ Procesando...',
  escribiLaFechaDdMm: '📆 Escribí la fecha (DD/MM o DD/MM/AAAA), ej: 25/09 o 25/09/2026:',
  sesionExpiradaEjecutaEditarturnoDe: 'Sesión expirada. Escribí /editarturno para empezar de nuevo.',
  turnoNoEncontrado: 'No encontré ese turno. Probá de nuevo con /editarturno.',
  errorAlMostrarElTurno: 'Error al mostrar el turno. Probá de nuevo con /editarturno.',
  campoInvalido: 'Ese campo no es válido. Elegí una de las opciones de los botones.',
};

const cobrarConfirm = {
  noHayMovimientosPendientes: 'Estás al día: no hay movimientos pendientes.',
  siCobrar: '✅ Sí, cobrar',
  cancelar: '❌ Cancelar',
  cualPendienteQueresCobrar: '¿Cuál pendiente querés cobrar?',
  sesionExpiradaMandaElMensaje: 'Sesión expirada. Mandá el mensaje de nuevo.',
  errorAlCobrarIntentaDe: 'No pude registrar el cobro. Probá de nuevo en un momento.',
  elementoNoEncontrado: 'No encontré ese movimiento. Probá de nuevo con /cobrar.',
  cancelado: 'Cancelado, no se cobró nada.',
};

const comandos = {
  accesos: {
    soloElDuenoDelConsultorio: 'Solo el dueño del consultorio puede gestionar los accesos.',
    noSeEncontroElPerfil: 'No encontré el perfil del consultorio. Avisale al administrador.',
    sinPermiso: 'Sin permiso',
    presetInvalido: 'Preset inválido',
    errorAlGuardarPermisosIntenta: 'No pude guardar los permisos. Probá de nuevo.',
  },
  actualizardolar: {
    actualizandoCotizacion: 'Actualizando la cotización...',
    noSePudoActualizarLa: 'No pude actualizar la cotización. Probá de nuevo en un rato.',
    errorAlActualizarCotizacion: 'No pude actualizar la cotización. Probá de nuevo en un rato.',
  },
  aprobar: {
    soloElAdministradorPuedeUsar: 'Este comando es solo para el administrador.',
    usoAprobarEmailDominioCom: 'Falta el email. Escribilo así: /aprobar email@dominio.com',
  },
  balance: {
    cargando: 'Un momento, lo busco...',
    errorAlObtenerDatos: 'No pude traer los datos. Probá de nuevo en un momento.',
  },
  cancelar: {
    procesoCancelado: 'Listo, cancelé el proceso.',
  },
  cobrar: {
    errorAlBuscarPendientes: 'No pude buscar los pendientes. Probá de nuevo en un momento.',
  },
  cobrosPorMetodo: {
    cargando: 'Un momento, lo busco...',
    errorAlObtenerDatos: 'No pude traer los datos. Probá de nuevo en un momento.',
  },
  codigo: {
    noTienesUnaCuentaRegistrada: 'Todavía no tenés una cuenta registrada. Escribí /start para crearla.',
    soloElOwnerPuedeGenerar: 'Solo el dueño de la cuenta puede generar códigos de invitación.',
  },
  debug: {
    diagnosticoDelSistemaAnalizando: '🔍 *DIAGNÓSTICO DEL SISTEMA*\n\n⏳ Analizando...',
    noTienesUnSheetConfigurado: 'Todavía no tenés un Sheet configurado. Escribí /start para hacerlo.',
    errorEnElDiagnosticoRevisa: 'No pude completar el diagnóstico. Revisá los logs.',
  },
  deudores: {
    cargando: 'Un momento, lo busco...',
    errorAlObtenerDatos: 'No pude traer los datos. Probá de nuevo en un momento.',
  },
  dolar: {
    obteniendoCotizacionDeBluelytics: 'Consultando la cotización en Bluelytics...',
    noSePudoObtenerLa: 'No pude obtener la cotización desde Bluelytics.\n\nProbá de nuevo con `/actualizardolar`. Si sigue fallando, el administrador puede configurar COTIZACION_DEFAULT en el .env.',
    errorAlObtenerCotizacion: 'No pude obtener la cotización. Probá de nuevo en un momento.',
  },
  editar: {
    errorAlBuscarMovimiento: '❌ Error al buscar movimiento.',
  },
  editarturno: {
    noSePudoAccederA: 'No pude acceder a la agenda. ¿Está configurado el sheet?',
    noHayTurnosCargadosPara: 'Hoy no hay turnos cargados.',
    cancelar: '❌ Cancelar',
    queTurnoQueresEditar: '¿Qué turno querés editar?',
  },
  egresos: {
    cargando: 'Un momento, lo busco...',
    errorAlObtenerDatos: 'No pude traer los datos. Probá de nuevo en un momento.',
  },
  egresosCategoria: {
    cargando: 'Un momento, lo busco...',
    errorAlObtenerDatos: 'No pude traer los datos. Probá de nuevo en un momento.',
  },
  eliminar: {
    noHayMovimientosRegistrados: 'No hay movimientos registrados todavía.',
    errorAlCargarMovimientos: 'No pude cargar los movimientos. Probá de nuevo en un momento.',
  },
  google: {
    usaEsteComandoEnEl: 'Usá este comando en el chat privado conmigo.',
    noTenesNingunaCuentaDe: 'No tenés ninguna cuenta de Google vinculada.',
    listoQuiteLaCuentaDe: '✅ Listo, quité la cuenta de Google. Para volver a entrar con Google tenés que vincularla de nuevo desde el dashboard.',
  },
  hoy: {
    cargando: 'Un momento, lo busco...',
    errorAlObtenerDatos: 'No pude traer los datos. Probá de nuevo en un momento.',
  },
  ingresos: {
    cargando: 'Un momento, lo busco...',
    errorAlObtenerDatos: 'No pude traer los datos. Probá de nuevo en un momento.',
  },
  limpiar: {
    noTienesUnSheetConfigurado: 'Todavía no tenés un Sheet configurado. Escribí /start para hacerlo.',
    limpiezaDelSheetAnalizandoFilas: '🧹 *LIMPIEZA DEL SHEET*\n\n⏳ Analizando filas...',
    todoLimpioNoHayFilas: '✅ *¡Todo limpio!*\n\nNo hay filas inválidas en tu Sheet.',
    errorAlAnalizarElSheet: 'No pude analizar el Sheet. Revisá los logs.',
  },
  listar: {
    cargandoMovimientos: 'Un momento, traigo los movimientos...',
    errorAlListarMovimientos: 'No pude listar los movimientos. Probá de nuevo en un momento.',
  },
  mes: {
    cargando: 'Un momento, lo busco...',
    errorAlObtenerDatos: 'No pude traer los datos. Probá de nuevo en un momento.',
  },
  misusuarios: {
    noTienesUnaCuentaRegistrada: 'Todavía no tenés una cuenta registrada. Escribí /start para crearla.',
    soloElOwnerPuedeVer: 'Solo el dueño de la cuenta puede ver la lista de usuarios.',
    noHayUsuariosAdicionalesAutorizados: 'Todavía no hay usuarios adicionales autorizados.\n\nUsá /codigo para generar una invitación.',
  },
  modoia: {
    noTenesUnaCuentaRegistrada: 'No tenés una cuenta registrada todavía. Escribí /start para crearla.',
    elModoFullIaNo: 'El modo Full IA todavía no está disponible (falta configurar OpenRouter).',
    usaModoiaOnOModoia: '⚠️ Usá `/modoia on` o `/modoia off`.',
  },
  nlptest: {
    soloDisponibleParaElAdministrador: 'Este comando es solo para el administrador.',
    analizando: '🔍 Analizando...',
  },
  pendiente: {
    formatoInvalidoEjemploPendienteJuan: 'No entendí ese formato. Escribilo así: `/pendiente Juan Perez $15000`',
    errorElMontoNoPuede: 'El monto no puede ser 0. Escribilo así: `/pendiente Juan Perez $15000`',
    errorAlRegistrarPendiente: 'No pude registrar el pendiente. Probá de nuevo en un momento.',
  },
  pendientes: {
    cargando: 'Un momento, lo busco...',
    errorAlObtenerDatos: 'No pude traer los datos. Probá de nuevo en un momento.',
  },
  personal: {
    noPudeArmarElResumen: 'No pude armar el resumen personal. Probá de nuevo.',
  },
  porProfesional: {
    cargando: 'Un momento, lo busco...',
    errorAlObtenerDatos: 'No pude traer los datos. Probá de nuevo en un momento.',
  },
  rechazar: {
    soloElAdministradorPuedeUsar: 'Este comando es solo para el administrador.',
    usoRechazarEmailDominioCom: 'Falta el email. Escribilo así: /rechazar email@dominio.com',
  },
  reconciliar: {
    soloElAdministradorPuedeUsar: 'Este comando es solo para el administrador.',
    supabaseNoEstaActivoNo: 'ℹ️ Supabase no está activo: no hay nada que comparar con Sheets.',
    comparandoGoogleSheetsConSupabase: '🔎 Comparando Google Sheets con Supabase… (solo lee, no cambia nada)',
  },
  regenerarIds: {
    buscandoFilasSinId: '🔄 Buscando filas sin ID...',
    errorNoTienesUnSheet: '❌ Error: No tienes un sheet configurado.',
    errorAlRegenerarIdsVerifica: '❌ Error al regenerar IDs. Verifica los logs.',
  },
  reiniciar: {
    soloElOwnerPuedeUsar: 'Solo el dueño de la cuenta puede usar este comando.',
    errorAlReiniciar: 'No pude reiniciar. Probá de nuevo en un momento.',
  },
  salir: {
    noEstasRegistradoEnEl: 'No estás registrado en el sistema.',
    errorAlProcesarElComando: 'No pude procesar el comando. Probá de nuevo.',
    canceladoSeguisRegistradoEnEl: 'Cancelado, seguís registrado en el bot.',
    noSePudoCompletarLa: 'No pude completar la baja. Hablá con el administrador.',
  },
  semana: {
    cargando: 'Un momento, lo busco...',
    errorAlObtenerDatos: 'No pude traer los datos. Probá de nuevo en un momento.',
  },
  sheet: {
    noTienesUnaCuentaRegistrada: 'Todavía no tenés una cuenta registrada. Escribí /start para configurarla.',
    noEncontreUnGoogleSheet: 'No encontré un Google Sheet configurado para esta cuenta.',
  },
  solicitudes: {
    soloElAdministradorPuedeUsar: 'Este comando es solo para el administrador.',
    noHaySolicitudesDeAcceso: 'No hay solicitudes de acceso pendientes.',
  },
  unir: {
    usoUnirCodigoEjemploUnir: 'Falta el código. Escribilo así: /unir ABC123',
  },
  viaje: {
    noHayNingunViajeActivo: '✈️ No hay ningún viaje activo para cerrar.',
    noPudeProcesarElComando: 'No pude procesar el comando de viaje. Probá de nuevo.',
  },
};

const comprobante = {
  noPudeLeerElComprobante: 'No pude leer el comprobante. Probá con una foto más clara y derecha.',
  laLecturaDeImagenesNo: 'La lectura de imágenes no está configurada. Revisá `GEMINI_API_KEY`.',
  faltaInstalarLaDependenciaDe: 'Falta instalar la dependencia de Vision. Revisá `@google/generative-ai`.',
  noPareceUnComprobanteDe: 'No parece un comprobante de transferencia ni una factura. Si es un cobro, escribilo, por ejemplo: `cobré 30000 de Juan por transferencia`; si es un gasto: `gasté 5000 en insumos`.',
  noPareceUnaFacturaNi: 'No parece una factura ni un ticket. Si es un gasto, probá con una foto más clara o escribilo, por ejemplo: `gasté 5000 en insumos`.',
  leiElComprobantePeroNo: 'Leí el comprobante pero no encontré el total. Probá con una foto donde se vea el importe, o escribilo: `gasté 5000 en insumos`.',
  noPudeLeerElComprobante2: 'No pude leer el comprobante. Probá con una captura más clara.',
  leiElComprobantePeroNo2: 'Leí el comprobante pero no encontré el monto. Probá con una captura donde se vea el importe, o escribilo: `cobré 30000 de Juan por transferencia`.',
  cargarComoIngresoNuevo: '➕ Cargar como ingreso nuevo',
  cancelar: '❌ Cancelar',
  sesionExpiradaMandaLaFoto: 'Sesión expirada. Mandá la foto de nuevo.',
  elementoNoEncontrado: 'No encontré ese elemento. Probá de nuevo.',
  errorAlCobrarIntentaDe: 'No pude registrar el cobro. Probá de nuevo en un momento.',
  laCargoComoIngresoNuevo: '➕ La cargo como ingreso nuevo.',
  cancelado: '❌ Cancelado.',
};

const gestionGastos = {
  noPudeCargarLosMovimientos: 'No pude cargar los movimientos. Probá de nuevo en un momento.',
  cancelar: '❌ Cancelar',
  siBorrar: '✅ Sí, borrar',
  unPagoEntreMiembrosNo: 'Un pago entre miembros no se edita: borralo con /eliminar y volvé a cargarlo.',
  descripcion: '📝 Descripción',
  monto: '💲 Monto',
  categoria: '🏷 Categoría',
  fecha: '📅 Fecha',
  elegiLaNuevaCategoria: '🏷 Elegí la nueva categoría:',
  noEncontreEseGastoPuede: 'No encontré ese gasto: puede que ya lo hayan borrado.',
  tenesUnaOperacionPendienteUsa: 'Tenés una operación pendiente. Usá los botones de arriba o /cancelar para descartarla.',
  laDescripcionEsInvalidaEscribi: 'Esa descripción no es válida. Escribí un texto más claro y corto.',
  elMontoEsInvalidoEscribi: 'El monto es inválido. Escribí un número mayor a 0, por ejemplo: 15000',
  noEntendiLaFechaEscribila: 'No entendí la fecha. Escribila como DD/MM/AAAA, DD/MM o "hoy".',
  algoSalioMalProbaDe: 'Algo salió mal. Probá de nuevo con /eliminar o /editar.',
  cancelado: '❌ Cancelado.',
};

const loginActions = {
  abriEsteEnlaceEnUna: '🔒 Abrí este enlace en una conversación privada conmigo para entrar al dashboard.',
  siSoyYo: '✅ Sí, soy yo',
  noFuiYo: '❌ No fui yo',
  listoYaPodesVolverAl: 'Listo, ya podés volver al navegador: va a entrar solo.\n\nSi no fuiste vos, avisá al administrador.',
  pedidoRechazadoTuCuentaSigue: 'Pedido rechazado. Tu cuenta sigue segura.',
};

const middleware = {
  demasiadasAccionesSeguidasEsperaUnos: 'Estás yendo muy rápido: esperá unos segundos y probá otra vez.',
  noEstasAutorizadoParaUsar: 'No estas autorizado para usar este bot todavía. Escribí /start para registrarte, o /unir CODIGO si te invitaron.',
};

const nlpConfirm = {
  ...nlpConfirmDatos,
  guardar: '✅ Guardar',
  cancelar: '❌ Cancelar',
  noEsDelViaje: '🚫 No es del viaje',
  editarUnCampo: '✏️ Editar un campo',
  monto: '💰 Monto',
  metodo: '💳 Método',
  pago: '👤 Pagó',
  entreQuienes: '👥 Entre quiénes',
  reescribir: '🔄 Reescribir',
  paciente: '👤 Paciente',
  tipo: '📊 Tipo',
  estado: '📋 Estado',
  descartar: '❌ Descartar',
  montoInvalidoIngresaUnNumero: 'Monto inválido. Escribí un número positivo, por ejemplo: 15000',
  metodoInvalidoUsaEfectivoTransferencia: 'Método inválido. Elegí uno: efectivo / transferencia / tarjeta',
  tipoInvalidoUsaIngresoGasto: 'Tipo inválido. Escribí: ingreso o gasto',
  estadoInvalidoUsaCobradoPendiente: 'Estado inválido. Escribí: cobrado o pendiente',
  elMontoNoEsValido: 'El monto no es válido. Mandame el movimiento de nuevo.',
  faltaUnaDescripcionMasClara: 'Falta una descripción más clara. Mandame el movimiento de nuevo.',
  errorAlGuardarElGasto: 'Error al guardar el gasto personal. Probá de nuevo en un momento.',
  elMovimientoExpiroMandaloDe: 'El movimiento expiró. Mandalo de nuevo cuando quieras.',
  noPertenecesAEsaCasa: '🔒 No pertenecés a esa casa.',
  enUnaCasaSoloSe: 'En una casa solo se cargan gastos.',
  opcionNoValida: 'Opción no válida. Elegí una de las que te muestro.',
  errorAlGuardarElGasto2: 'Error al guardar el gasto de la casa. Probá de nuevo en un momento.',
  completandoDatos: 'Completando datos...',
  noSePudoRegistrarIntenta: 'No pude registrarlo. Probá de nuevo en un momento.',
  errorAlGuardarIntentaDe: 'Error al guardar. Probá de nuevo en un momento.',
  canceladoPodesVolverAEscribirlo: 'Cancelado. Podés volver a escribirlo cuando quieras.',
  queCampoQueresEditar: '¿Qué campo querés editar?',
  movimientoDescartadoEscribiElMovimiento: 'Movimiento descartado. Escribilo de nuevo con todos los detalles.',
  movimientoDescartadoMandaElNuevo: 'Movimiento descartado. Mandame el nuevo mensaje para procesarlo.',
};

const nlp = {
  noEntendiAQuePeriodo: 'No entendí a qué período te referís. Probá con: "ayer", "el mes pasado", "marzo", "este año", "últimos 15 días" o "del 01/03 al 15/03".',
  errorAlBuscarMovimiento: 'No pude buscar el movimiento. Probá de nuevo en un momento.',
  noPudeDeterminarLosDos: 'No pude determinar los dos montos. Probá así: `cobré 30000 y debe 30000`',
  noPudeDeterminarLosDos2: 'No pude determinar los dos montos. Probá así: `pagamos 30000 a Dental Sur, debemos 30000 más`',
  ocurrioUnErrorAlProcesar: 'Hubo un problema al procesar tu mensaje. Probá de nuevo o escribí /ayuda.',
};

const photo = {
  noTienesUnaCuentaRegistrada: 'Todavía no tenés una cuenta registrada. Escribí /start para crearla.',
  tenesUnProcesoPendienteUsa: 'Tenés un proceso pendiente. Usá /cancelar primero.',
  estoyProcesandoVariasImagenesAhora: 'Estoy procesando varias imágenes ahora mismo. Probá de nuevo en unos segundos.',
  errorAlProcesarLaImagen: 'Error al procesar la imagen. Probá de nuevo.',
  agenda: '📅 Agenda',
  gasto: '🧾 Gasto',
  cobro: '💸 Cobro',
  noEstoySeguroDeQue: '🤔 No estoy seguro de qué es esta imagen. ¿Qué querés cargar?',
  nada: '❌ Nada',
  laImagenExpiroMandalaDe: 'La imagen expiró. Mandala de nuevo.',
  listoNoCargueNada: 'Listo, no cargué nada.',
  procesando: '📸 Procesando...',
  noEncontreUnaFotoValida: 'No encontré una foto válida. Probá de nuevo.',
  porAhoraLeoFotosY: 'Por ahora leo fotos y PDFs. Mandame la factura, el ticket o la agenda como foto o PDF.',
  noPudeProcesarLaImagen: 'No pude procesar la imagen. Probá con otra foto más clara.',
  laLecturaDeImagenesNo: 'La lectura de imágenes no está configurada. Revisá `GEMINI_API_KEY`.',
  faltaInstalarLaDependenciaDe: 'Falta instalar la dependencia de Vision. Revisá `@google/generative-ai`.',
  noEncontreTurnosEnLa: '📭 No encontré turnos en la imagen. Probá con una foto más clara.',
};

const vinculoTelegram = {
  abriEsteEnlaceEnUna: '🔒 Abrí este enlace en una conversación privada conmigo para vincular tu Telegram.',
  siVincular: '✅ Sí, vincular',
  noFuiYo: '❌ No fui yo',
  estoSoloSePuedeConfirmar: '🔒 Esto solo se puede confirmar en una conversación privada.',
  pedidoRechazadoNoSeVinculo: 'Pedido rechazado. No se vinculó nada.',
};

const voice = {
  noTienesUnaCuentaRegistrada: 'Todavía no tenés una cuenta registrada. Escribí /start para crearla.',
  tenesUnProcesoPendienteUsa: 'Tenés un proceso pendiente. Usá /cancelar primero.',
  noEncontreUnaNotaDe: 'No encontré una nota de voz válida.',
  transcribiendoAudio: '🎤 Transcribiendo audio...',
  estoyProcesandoVariosAudiosAhora: 'Estoy procesando varios audios ahora mismo. Probá de nuevo en unos segundos.',
  noPudeTranscribirElAudio: 'No pude transcribir el audio. Probá escribiendo el mensaje.',
  noEntendiNadaEnEl: 'No entendí nada del audio. Probá grabarlo de nuevo, un poco más claro.',
  errorAlProcesarLaNota: 'No pude procesar la nota de voz. Probá de nuevo.',
};

module.exports = {
  montoConMoneda,
  capitalizar,
  comun,
  registro,
  ayuda,
  movimiento,
  flujoGuiado,
  edicion,
  confirmacion,
  agendaConsulta,
  parciales,
  limites,
  actions,
  cobrarConfirm,
  comandos,
  comprobante,
  gestionGastos,
  loginActions,
  middleware,
  nlpConfirm,
  nlp,
  photo,
  vinculoTelegram,
  voice,
};
