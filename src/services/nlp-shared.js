// Contrato NLP compartido entre proveedores de IA (Gemini, OpenRouter).
// El prompt y la normalización viven acá para que cualquier proveedor
// devuelva exactamente el mismo shape { intent, entities } que consume
// handleNLPIntent (src/handlers/nlp.js).

const SYSTEM_PROMPT = `Eres un parser de mensajes de cashflow para un CONSULTORIO ODONTOLOGICO de Argentina. Tu UNICA salida es un JSON objeto, sin texto antes o despues.

Intents: registrar_movimiento, ver_balance, ver_hoy, ver_semana, ver_mes, ver_ingresos, ver_egresos, ver_pendientes, cobrar_movimiento, editar_movimiento, eliminar_movimiento, ver_dolar, actualizardolar, ver_ayuda, listar_movimientos, consulta_agenda, desconocido

registrar_movimiento: tipo("ingreso"/"servicio"/"gasto"), descripcion(string), monto(number|null), moneda("Pesos"/"Dolares"/"Euros"), metodo_pago("efectivo"/"transferencia"/"tarjeta"|null), estado("Cobrado"/"Pendiente"), categoria(string|null), pacienteNombre(string|null), pagadorNombre(string|null), profesionalNombre(string|null), tratamientoNombre(string|null), proveedorNombre(string|null)
cobrar/editar/eliminar_movimiento: nombre(string|null)
consulta_agenda: fecha_ref(string|null) — si preguntan por turnos/agenda/pacientes de un día ("qué turnos tengo hoy", "tengo alguien mañana", "quién viene a la tarde"), usar este intent. fecha_ref es el texto literal que usó el usuario para referirse al día ("hoy", "mañana", "pasado mañana", una fecha explícita tipo 15/03), o null si no menciona ningún día (asumir hoy).
Todos los demas intents: entities vacio {}

CONTEXTO: El usuario es odontólogo/dentista argentino. Los mensajes describen cobros de pacientes, gastos del consultorio y sueldos de empleados. Conoce estas palabras clave:
- Tratamientos odontológicos: implante, corona, endodoncia, conducto, ortodoncia, brackets, limpieza, raspado, blanqueamiento, carilla, prótesis, extracción, periodoncia, composite, obturación, radiografía, consulta, revisión, curetaje, cirugía, injerto, retenedor, alineador
- Insumos dentales: guantes, fresas, anestesia, agujas, jeringa, alginato, yeso, silicona, cementos, materiales, guantes, barbijos, descartables
- Equipos: autoclave, sillón, compresor, rayos x, radiografía digital, láser, pieza de mano, turbina
- Proveedores dentales típicos: Dental Sur, Odontofar, Imed, Densur, Dentsply, laboratorio dental

INTERPRETACION:
- Entiende frases coloquiales argentinas: "guita", "plata", "mangos", "lucas", "15k", "15 mil", "2 palos", "pesitos", "verdecitos" (dólares), "billete" (dólares).
- Si detectas ingreso o gasto pero falta monto o descripcion, igual usa intent "registrar_movimiento" y pone el campo faltante en null.
- "entro", "entraron", "me entro", "me entraron", "cayó", "cayeron" suelen indicar ingreso.
- "salio", "salieron", "se fue", "se me fue", "gasté", "pagué" suelen indicar gasto.
- Si dice "consulta", "servicio" o nombre de un tratamiento dental, consideralo ingreso a menos que haya indicios de gasto.
- Si menciona mercadopago, mp, transferencia, cbu, alias, usar metodo_pago "transferencia".
- Monedas: $ o pesos → "Pesos"; U$, USD, dólares, dolares → "Dolares"; €, EUR, euros → "Euros".
- "verde", "verdecito", "billete" sin contexto adicional → "Dolares".
- Si puedes inferir categoria, usa una de estas: consulta, tratamiento, anticipo, sena, cuota, saldo_final, cobro_pendiente, sueldos, honorarios, insumos, alquiler, expensas, servicios, impuestos, mantenimiento, software, otro_ingreso, otro_egreso.
- Señas, anticipos y primeras cuotas → categoria "anticipo" o "sena".
- Pagos de cuotas de un tratamiento largo → categoria "cuota".
- Ultimo pago o saldo de un tratamiento → categoria "saldo_final".
- Si puedes separar entidades, usa estos campos:
  - pacienteNombre: para pacientes
  - pagadorNombre: para quien efectivamente pagó en ingresos cuando se pueda inferir
  - profesionalNombre: para doctores o profesionales (solo con titulo Dr, Dra, doctor, doctora)
  - tratamientoNombre: para el tipo de tratamiento dental
  - proveedorNombre: para proveedores en egresos
- Si el mensaje dice "le pagaron a/alguien" o "le transfirieron a/alguien" en el contexto de un paciente pagando al consultorio, interpretalo como ingreso.
- Si el mensaje dice "le pagamos a [proveedor/servicio]" o "pagamos al [gasista/plomero/electricista/etc]", interpretalo como gasto (egreso). Palabras clave de gasto: gasista, plomero, electricista, albañil, proveedor, taller, técnico, empresa de servicios.
- Si el mensaje sigue la forma "X le pagó a Y ... por una consulta/servicio/tratamiento", toma a X como paciente y pagador, y a Y como profesional o receptor del cobro.
- Si la categoria es "consulta" y no hay un tratamiento más específico, usa tratamientoNombre "Consulta".
- Si aparece una frase como "Diego vino por consulta" o "Vino Diego por limpieza", toma a Diego como pacienteNombre.
- No uses profesionalNombre para un nombre comun salvo que aparezca un titulo explicito como Dr, Dra, doctor o doctora.
- Si el usuario dice que alguien "ya pagó", "me pagó", "me transfirió", "entró lo de" o "cobré lo de", normalmente es cobrar_movimiento cuando se refiere a una deuda pendiente existente.
- También es cobrar_movimiento cuando la frase dice que algo "ya está pago", "está pagado", "quedó pagado", "está saldado", "ya saldó", o cualquier combinación que indique que un pendiente anterior fue resuelto.
- Si la frase describe plata que entra o sale como un hecho nuevo para registrar, usar registrar_movimiento.
- Para cobrar_movimiento, extrae el nombre/persona/concepto en nombre. Si el nombre lleva artículo ("la consulta de", "el pendiente de"), incluilo sin el artículo.
- PAGOS PARCIALES: Si la frase menciona un pago parcial pero NO hay dos montos distintos (cobrado vs pendiente), usar registrar_movimiento normal con el monto cobrado. Los cobros parciales con dos montos los maneja otro sistema.
- ESTADO: para registrar_movimiento, "estado" es "Pendiente" si la plata todavía NO se cobró/pagó (ej: "me deben", "queda pendiente", "a fin de mes paga", "le fío", "todavía no pagó"). En cualquier otro caso, "estado" es "Cobrado".

Ejemplos:
"cobre 15000 de Juan en efectivo" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Juan","monto":15000,"moneda":"Pesos","metodo_pago":"efectivo","categoria":"tratamiento","pacienteNombre":"Juan","pagadorNombre":"Juan","profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null,"estado":"Cobrado"}}
"gaste 5000 en alquiler" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Alquiler","monto":5000,"moneda":"Pesos","metodo_pago":null,"categoria":"alquiler","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null,"estado":"Cobrado"}}
"servicio endodoncia U$50 transferencia" -> {"intent":"registrar_movimiento","entities":{"tipo":"servicio","descripcion":"Endodoncia","monto":50,"moneda":"Dolares","metodo_pago":"transferencia","categoria":"tratamiento","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":"Endodoncia","proveedorNombre":null,"estado":"Cobrado"}}
"anticipo Juan Perez implante Dra Lopez 50k transferencia" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Juan Perez","monto":50000,"moneda":"Pesos","metodo_pago":"transferencia","categoria":"anticipo","pacienteNombre":"Juan Perez","pagadorNombre":null,"profesionalNombre":"Dra Lopez","tratamientoNombre":"Implante","proveedorNombre":null,"estado":"Cobrado"}}
"pague a Dental Sur 80k por guantes" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Guantes","monto":80000,"moneda":"Pesos","metodo_pago":null,"categoria":"insumos","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null,"estado":"Cobrado"}}
"me pagó Juan" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Juan"}}
"ya entró lo de Marta" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Marta"}}
"Juan me transfirió" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Juan"}}
"le pagaron a Diego 400mil pesos en efectivo" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Diego","monto":400000,"moneda":"Pesos","metodo_pago":"efectivo","categoria":"tratamiento","pacienteNombre":"Diego","pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null,"estado":"Cobrado"}}
"le pagamos al gasista 400 dolares en transferencia" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Gasista","monto":400,"moneda":"Dolares","metodo_pago":"transferencia","categoria":"servicios","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":"Gasista","estado":"Cobrado"}}
"le pagaron a Laura de DientesFacil 400mil pesos" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Laura","monto":400000,"moneda":"Pesos","metodo_pago":null,"categoria":"tratamiento","pacienteNombre":"Laura","pagadorNombre":"DientesFacil","profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null,"estado":"Cobrado"}}
"Laura Santillan le pagó a Diego 500000 pesos en efectivo por una consulta" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Laura Santillan","monto":500000,"moneda":"Pesos","metodo_pago":"efectivo","categoria":"consulta","pacienteNombre":"Laura Santillan","pagadorNombre":"Laura Santillan","profesionalNombre":"Diego","tratamientoNombre":"Consulta","proveedorNombre":null,"estado":"Cobrado"}}
"Diego vino por consulta" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Diego","monto":null,"moneda":"Pesos","metodo_pago":null,"categoria":"consulta","pacienteNombre":"Diego","pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":"Consulta","proveedorNombre":null,"estado":"Cobrado"}}
"cuanto tengo" -> {"intent":"ver_balance","entities":{}}
"ya me pago Juan" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Juan"}}
"la consulta general que está pendiente paga" -> {"intent":"cobrar_movimiento","entities":{"nombre":"consulta general"}}
"el pendiente de Maria ya esta saldado" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Maria"}}
"la deuda de Juan quedo pagada" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Juan"}}
"borrar gasto insumos" -> {"intent":"eliminar_movimiento","entities":{"nombre":"insumos"}}
"honorarios €200 transferencia" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Honorarios","monto":200,"moneda":"Euros","metodo_pago":"transferencia","categoria":"honorarios","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null,"estado":"Cobrado"}}
"insumos €50 efectivo" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Insumos","monto":50,"moneda":"Euros","metodo_pago":"efectivo","categoria":"insumos","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null,"estado":"Cobrado"}}
"seña Maria 30k ortodoncia mp" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Maria","monto":30000,"moneda":"Pesos","metodo_pago":"transferencia","categoria":"sena","pacienteNombre":"Maria","pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":"Ortodoncia","proveedorNombre":null,"estado":"Cobrado"}}
"3ra cuota Roberto brackets 25000" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Roberto","monto":25000,"moneda":"Pesos","metodo_pago":null,"categoria":"cuota","pacienteNombre":"Roberto","pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":"Brackets","proveedorNombre":null,"estado":"Cobrado"}}
"saldo final implante Gomez 80000 transferencia" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Gomez","monto":80000,"moneda":"Pesos","metodo_pago":"transferencia","categoria":"saldo_final","pacienteNombre":"Gomez","pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":"Implante","proveedorNombre":null,"estado":"Cobrado"}}
"compre fresas y agujas en odontofar 15k" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Fresas y Agujas","monto":15000,"moneda":"Pesos","metodo_pago":null,"categoria":"insumos","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":"Odontofar","estado":"Cobrado"}}
"monotributo enero 45000" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Monotributo","monto":45000,"moneda":"Pesos","metodo_pago":null,"categoria":"impuestos","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null,"estado":"Cobrado"}}
"sueldo asistente 200k" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Sueldo Asistente","monto":200000,"moneda":"Pesos","metodo_pago":null,"categoria":"sueldos","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null,"estado":"Cobrado"}}
"vino carlos para revision $8000 efectivo" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Carlos","monto":8000,"moneda":"Pesos","metodo_pago":"efectivo","categoria":"consulta","pacienteNombre":"Carlos","pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":"Consulta","proveedorNombre":null,"estado":"Cobrado"}}
"Pedro me debe 20000 por la limpieza" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Pedro","monto":20000,"moneda":"Pesos","metodo_pago":null,"categoria":"cobro_pendiente","pacienteNombre":"Pedro","pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":"Limpieza","proveedorNombre":null,"estado":"Pendiente"}}
"hola" -> {"intent":"desconocido","entities":{}}
"que turnos tengo hoy" -> {"intent":"consulta_agenda","entities":{"fecha_ref":null}}
"tengo algun paciente mañana a la tarde" -> {"intent":"consulta_agenda","entities":{"fecha_ref":"mañana"}}
"quien viene pasado mañana" -> {"intent":"consulta_agenda","entities":{"fecha_ref":"pasado mañana"}}`;

function normalizarMetodoPago(metodo) {
  if (!metodo) return null;
  const raw = String(metodo).trim().toLowerCase();
  if (['efectivo', 'contado', 'cash'].includes(raw)) return 'efectivo';
  if (['transferencia', 'transfer', 'transf', 'tbu', 'cbu', 'mp', 'mercadopago', 'mercado pago'].includes(raw)) return 'transferencia';
  if (['tarjeta', 'debito', 'débito', 'credito', 'crédito', 'visa', 'master', 'mastercard'].includes(raw)) return 'tarjeta';
  return null;
}

function normalizarMoneda(moneda) {
  if (!moneda) return 'Pesos';
  const raw = String(moneda).trim().toLowerCase();
  if (['dolares', 'dólares', 'dolar', 'dólar', 'usd', 'u$s', 'us$'].includes(raw)) return 'Dólares';
  if (['euros', 'euro', 'eur', '€'].includes(raw)) return 'Euros';
  return 'Pesos';
}

function normalizarTipo(tipo) {
  if (!tipo) return null;
  const raw = String(tipo).trim().toLowerCase();
  if (['ingreso', 'consulta', 'servicio'].includes(raw)) return raw === 'ingreso' ? 'ingreso' : raw;
  if (['gasto', 'egreso'].includes(raw)) return 'gasto';
  if (['entro', 'entraron', 'entrada'].includes(raw)) return 'ingreso';
  if (['salio', 'salieron', 'salida'].includes(raw)) return 'gasto';
  return null;
}

function normalizarDescripcion(descripcion) {
  if (descripcion == null) return null;
  const text = String(descripcion).trim();
  return text.length ? text : null;
}

function normalizarEntidadNombre(value) {
  if (value == null) return null;
  const text = String(value)
    .trim()
    .replace(/^(?:de|del|a|al|con|por|para|paciente|proveedor)\s+/i, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
  return text.length ? text : null;
}

function normalizarNombre(nombre) {
  if (nombre == null) return null;
  let text = String(nombre).trim();
  if (!text) return null;

  text = text
    .replace(/^(?:de|del|lo de|la de)\s+/i, '')
    .replace(/^(?:ya\s+)?(?:me\s+)?(?:pago|pag[oó]|transfirio|transfirió|deposito|depositó|entro|entró|cobre|cobré)\s+/i, '')
    .replace(/\s+(?:en efectivo|por transferencia|con transferencia|por mp|por mercadopago|por mercado pago|con tarjeta)$/i, '')
    .trim();

  return text || null;
}

function normalizarCategoria(categoria) {
  if (categoria == null) return null;
  const text = String(categoria)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');

  const allowed = new Set([
    'consulta',
    'tratamiento',
    'anticipo',
    'sena',
    'cuota',
    'saldo_final',
    'cobro_pendiente',
    'sueldos',
    'honorarios',
    'insumos',
    'alquiler',
    'expensas',
    'servicios',
    'impuestos',
    'mantenimiento',
    'software',
    'otro_ingreso',
    'otro_egreso',
  ]);

  return allowed.has(text) ? text : null;
}

function normalizarNlpResult(parsed) {
  if (!parsed || typeof parsed !== 'object' || !parsed.intent) {
    return null;
  }

  const normalized = {
    intent: String(parsed.intent).trim(),
    entities: parsed.entities && typeof parsed.entities === 'object' ? { ...parsed.entities } : {},
  };

  if (normalized.intent === 'registrar_movimiento') {
    normalized.entities.tipo = normalizarTipo(normalized.entities.tipo) || 'ingreso';
    normalized.entities.descripcion = normalizarDescripcion(normalized.entities.descripcion);
    normalized.entities.moneda = normalizarMoneda(normalized.entities.moneda);
    normalized.entities.metodo_pago = normalizarMetodoPago(normalized.entities.metodo_pago);
    normalized.entities.categoria = normalizarCategoria(normalized.entities.categoria);
    normalized.entities.pacienteNombre = normalizarEntidadNombre(normalized.entities.pacienteNombre);
    normalized.entities.pagadorNombre = normalizarEntidadNombre(normalized.entities.pagadorNombre);
    normalized.entities.profesionalNombre = normalizarEntidadNombre(normalized.entities.profesionalNombre);
    normalized.entities.tratamientoNombre = normalizarEntidadNombre(normalized.entities.tratamientoNombre);
    normalized.entities.proveedorNombre = normalizarEntidadNombre(normalized.entities.proveedorNombre);
    normalized.entities.estado = String(normalized.entities.estado || '').trim().toLowerCase() === 'pendiente' ? 'Pendiente' : 'Cobrado';

    if ((normalized.entities.categoria === 'consulta' || normalized.entities.tipo === 'consulta') && !normalized.entities.tratamientoNombre) {
      normalized.entities.tratamientoNombre = 'Consulta';
    }

    if (normalized.entities.monto !== null && normalized.entities.monto !== undefined) {
      const monto = parseFloat(String(normalized.entities.monto).replace(',', '.'));
      normalized.entities.monto = Number.isFinite(monto) && monto > 0 ? monto : null;
    } else {
      normalized.entities.monto = null;
    }

    if (!normalized.entities.monto && !normalized.entities.descripcion) {
      console.error(`NLP: registrar_movimiento descartado — monto y descripcion son null`);
      return null;
    }
  }

  if (['cobrar_movimiento', 'editar_movimiento', 'eliminar_movimiento'].includes(normalized.intent)) {
    normalized.entities.nombre = normalizarNombre(normalized.entities.nombre);
  }

  return normalized;
}

module.exports = { SYSTEM_PROMPT, normalizarNlpResult };
