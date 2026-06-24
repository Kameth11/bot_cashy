const { getSupabase, isAvailable } = require('../lib/supabase');
const { forTenant } = require('../lib/tenant-db');
const { resolveTenantId, invalidateTenantCache } = require('./tenant.service');
const { USE_SUPABASE, SPREADSHEET_ID } = require('../config');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');
const { aplicarColorMontoEnFila } = require('./sheet-format.service');
const { emitMovimientosUpdated } = require('./events.service');
const { withUserWriteLock, runInBackground } = require('../lib/write-queue');
const { getRowIdUnico, formatDateValue } = require('../utils/sheet-row');
const {
  buildMovimientoV2Payload,
  buildMovimientoV2UpdatePayload,
  buildMovimientoV2CreationEvent,
  buildMovimientoV2TransitionEvent,
  getTipoMovimientoFromLegacy,
  legacyDateToIso,
  normalizeMetodoPago,
} = require('../utils/movimiento-v2');

// Tope de seguridad para lecturas: evita que una cuenta con años de historia
// traiga decenas de miles de filas en cada fetch del dashboard. Se traen las
// más recientes (order created_at desc); el orden final lo rearma sortByKeyAsc
// aguas abajo. Es un guard contra lecturas desbocadas, no paginación real
// (cuando un tenant se acerque a este número, toca paginar de verdad).
const MAX_MOVIMIENTOS_READ = 20000;

const v2CapabilityCache = {
  checked: false,
  movimientosV2: false,
  movimientoEventosV2: false,
};

const legacyCapabilityCache = {
  checked: false,
  extendedMovimientos: false,
  extendedCampos: false,
  fechaCobro: false,
};

let v2CapabilityPromise = null;
let legacyCapabilityPromise = null;
let missingV2TablesLogged = false;

function normalizeDbValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function extractPagadorFromNotas(notas) {
  const match = String(notas || '').match(/(?:^|\n)Pagador:\s*(.+?)(?:\n|$)/i);
  return match && match[1] ? match[1].trim() : '';
}

function mapDbTipoToLegacyDisplay(tipo) {
  const normalized = normalizeDbValue(tipo);
  if (normalized === 'egreso') return 'Egreso';
  if (normalized === 'ingreso') return 'Ingreso';
  return tipo || 'Ingreso';
}

function mapDbStateToLegacyDisplay(estado) {
  const normalized = normalizeDbValue(estado).replace(/\s+/g, '_');
  if (normalized === 'pendiente') return 'Pendiente';
  if (normalized === 'parcial') return 'Pendiente';
  if (['cobrado', 'pagado'].includes(normalized)) return 'Cobrado';
  return estado || '';
}

function getDbPaymentMethod(row) {
  return row?.medio_pago || row?.metodo_pago || '';
}

function toDbDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return legacyDateToIso(raw);
}

function getSheetService() {
  return require('./sheet.service');
}

function getSheetId(userId) {
  const cliente = obtenerClientePorUserId(userId);
  if (cliente && cliente.sheetId) return cliente.sheetId;
  if (esAdminOriginal(userId) && SPREADSHEET_ID) return SPREADSHEET_ID;
  return null;
}

function invalidateCache(userId) {
  if (USE_SUPABASE) {
    // no cache needed with Supabase
  }
  getSheetService().invalidateCache(userId);
}

// Resuelve el tenant de un sheet_id (otro profile ya creado con el mismo
// sheet, ej: el owner cuando este perfil es de un usuario invitado) o crea
// un tenant nuevo. profiles/tenants quedan fuera de tenant-db.js a
// proposito: son las tablas que definen el mapeo userId -> tenantId, no
// tiene sentido pedirles el tenantId a si mismas (ver tenant.service.js).
async function resolveOrCreateTenantId(supabase, sheetId) {
  if (sheetId) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('sheet_id', sheetId)
      .not('tenant_id', 'is', null)
      .limit(1)
      .maybeSingle();
    if (existing?.tenant_id) return existing.tenant_id;
  }

  const { data: tenant, error } = await supabase
    .from('tenants')
    .insert({ nombre: sheetId ? `Consultorio ${sheetId.slice(0, 8)}` : 'Consultorio sin sheet' })
    .select('id')
    .single();

  if (error) {
    console.error('Supabase resolveOrCreateTenantId error:', error.message);
    return null;
  }
  return tenant.id;
}

async function ensureProfile(userId) {
  if (!USE_SUPABASE) return;

  const supabase = getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, tenant_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('Supabase ensureProfile select error:', error.message);
    return;
  }

  const cliente = obtenerClientePorUserId(userId);
  const sheetId = cliente?.sheetId || (esAdminOriginal(userId) ? SPREADSHEET_ID : null);

  if (data) {
    // Perfil viejo de antes de la Fase 2 sin tenant_id - se completa al vuelo.
    if (!data.tenant_id) {
      const tenantId = await resolveOrCreateTenantId(supabase, sheetId);
      if (tenantId) {
        await supabase.from('profiles').update({ tenant_id: tenantId }).eq('id', userId);
        invalidateTenantCache(userId);
      }
    }
    return;
  }

  const tenantId = await resolveOrCreateTenantId(supabase, sheetId);
  const profileRow = {
    id: userId,
    email: cliente?.email || null,
    display_name: cliente?.email ? cliente.email.split('@')[0] : null,
    sheet_id: sheetId,
    usuarios: Array.isArray(cliente?.usuarios) ? cliente.usuarios : [],
    tenant_id: tenantId,
  };

  const { error: upsertError } = await supabase
    .from('profiles')
    .upsert(profileRow, { onConflict: 'id' });

  if (upsertError) {
    console.error('Supabase ensureProfile upsert error:', upsertError.message);
  }
}

function isMissingRelationError(error) {
  return Boolean(error && /relation .* does not exist|could not find the table/i.test(error.message || ''));
}

async function resolveV2Capabilities(supabase) {
  if (!USE_SUPABASE || !supabase) {
    return { movimientosV2: false, movimientoEventosV2: false };
  }

  if (v2CapabilityCache.checked) {
    return {
      movimientosV2: v2CapabilityCache.movimientosV2,
      movimientoEventosV2: v2CapabilityCache.movimientoEventosV2,
    };
  }

  if (v2CapabilityPromise) {
    return v2CapabilityPromise;
  }

  v2CapabilityPromise = (async () => {
    const result = {
      movimientosV2: false,
      movimientoEventosV2: false,
    };

    const movimientoCheck = await supabase.from('movimientos_v2').select('id').limit(1);
    if (!movimientoCheck.error) {
      result.movimientosV2 = true;
    } else if (!isMissingRelationError(movimientoCheck.error)) {
      console.error('Supabase movimientos_v2 check error:', movimientoCheck.error.message);
    }

    const eventoCheck = await supabase.from('movimiento_eventos_v2').select('id').limit(1);
    if (!eventoCheck.error) {
      result.movimientoEventosV2 = true;
    } else if (!isMissingRelationError(eventoCheck.error)) {
      console.error('Supabase movimiento_eventos_v2 check error:', eventoCheck.error.message);
    }

    if ((!result.movimientosV2 || !result.movimientoEventosV2) && !missingV2TablesLogged) {
      missingV2TablesLogged = true;
      console.log('Supabase v2 no disponible todavia. Continuo con el modelo actual.');
    }

    v2CapabilityCache.checked = true;
    v2CapabilityCache.movimientosV2 = result.movimientosV2;
    v2CapabilityCache.movimientoEventosV2 = result.movimientoEventosV2;
    v2CapabilityPromise = null;
    return result;
  })();

  return v2CapabilityPromise;
}

function isMissingColumnError(error) {
  return Boolean(error && /column .* does not exist|could not find the .*column|schema cache/i.test(error.message || ''));
}

async function resolveLegacyCapabilities(supabase) {
  if (!USE_SUPABASE || !supabase) {
    return { extendedMovimientos: false, extendedCampos: false, fechaCobro: false };
  }

  if (legacyCapabilityCache.checked) {
    return {
      extendedMovimientos: legacyCapabilityCache.extendedMovimientos,
      extendedCampos: legacyCapabilityCache.extendedCampos,
      fechaCobro: legacyCapabilityCache.fechaCobro,
    };
  }

  if (legacyCapabilityPromise) {
    return legacyCapabilityPromise;
  }

  legacyCapabilityPromise = (async () => {
    let extendedMovimientos = false;
    let extendedCampos = false;
    let fechaCobro = false;

    // tenant-isolation-ignore: solo prueba si existen columnas, no lee datos de usuario
    const check = await supabase
      .from('movimientos')
      .select('categoria,medio_pago,referencia_id')
      .limit(1);

    if (!check.error) {
      extendedMovimientos = true;
    } else if (!isMissingColumnError(check.error)) {
      console.error('Supabase movimientos extended schema check error:', check.error.message);
    }

    // tenant-isolation-ignore: solo prueba si existen columnas, no lee datos de usuario
    const camposCheck = await supabase
      .from('movimientos')
      .select('paciente,profesional,tratamiento,proveedor,fecha_prestacion,fecha_vencimiento')
      .limit(1);

    if (!camposCheck.error) {
      extendedCampos = true;
    } else if (!isMissingColumnError(camposCheck.error)) {
      console.error('Supabase movimientos campos extendidos check error:', camposCheck.error.message);
    }

    // Capability separada de extendedCampos a propósito: fecha_cobro es una
    // columna nueva (migración 005) independiente de las que ya existen en
    // producción. Si fuera parte de extendedCampos, mientras la migración no
    // corra, paciente/profesional/tratamiento/proveedor (que SÍ existen hoy)
    // dejarían de escribirse.
    // tenant-isolation-ignore: solo prueba si existe la columna, no lee datos de usuario
    const fechaCobroCheck = await supabase
      .from('movimientos')
      .select('fecha_cobro')
      .limit(1);

    if (!fechaCobroCheck.error) {
      fechaCobro = true;
    } else if (!isMissingColumnError(fechaCobroCheck.error)) {
      console.error('Supabase movimientos fecha_cobro check error:', fechaCobroCheck.error.message);
    }

    legacyCapabilityCache.checked = true;
    legacyCapabilityCache.extendedMovimientos = extendedMovimientos;
    legacyCapabilityCache.extendedCampos = extendedCampos;
    legacyCapabilityCache.fechaCobro = fechaCobro;
    legacyCapabilityPromise = null;
    return { extendedMovimientos, extendedCampos, fechaCobro };
  })();

  return legacyCapabilityPromise;
}

function buildLegacySnapshotFromRow(row) {
  return {
    id: row.id,
    fecha: formatLegacyDate(row.fecha),
    hora: formatLegacyHour(row.hora),
    descripcion: row.descripcion,
    monto: row.monto,
    estado: mapDbStateToLegacyDisplay(row.estado),
    tipo: mapDbTipoToLegacyDisplay(row.tipo),
    moneda: row.moneda,
    metodo_pago: getDbPaymentMethod(row),
    monto_pesos: row.monto_pesos,
    id_unico: row.id_unico,
    fecha_cobro: row.fecha_cobro,
  };
}

function buildLegacyRowDataFromSnapshot(snapshot) {
  return {
    Fecha: formatLegacyDate(snapshot.fecha) || '',
    Hora: formatLegacyHour(snapshot.hora) || '',
    Descripcion: snapshot.descripcion || '',
    Monto: snapshot.monto,
    Estado: mapDbStateToLegacyDisplay(snapshot.estado) || '',
    Tipo: mapDbTipoToLegacyDisplay(snapshot.tipo) || '',
    Moneda: snapshot.moneda || 'Pesos',
    MetodoPago: snapshot.metodo_pago || '',
    ID_Unico: snapshot.id_unico || '',
    MontoPesos: snapshot.monto_pesos,
    Pagador: snapshot.pagador || '',
    FechaCobro: formatLegacyDate(snapshot.fecha_cobro) || '',
  };
}

async function insertMovimientoV2FromLegacy(supabase, userId, rowData, legacyRowId, metadata = {}) {
  const capabilities = await resolveV2Capabilities(supabase);
  if (!capabilities.movimientosV2) return null;

  const payload = buildMovimientoV2Payload({
    userId,
    rowData,
    legacyId: legacyRowId,
    metadata,
  });

  const { data, error } = await supabase
    .from('movimientos_v2')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    console.error('Supabase movimientos_v2 insert error:', error.message);
    return null;
  }

  if (capabilities.movimientoEventosV2) {
    const creationEvent = buildMovimientoV2CreationEvent({
      movimientoId: data.id,
      userId,
      movimientoData: data,
    });

    const { error: eventError } = await supabase
      .from('movimiento_eventos_v2')
      .insert(creationEvent);

    if (eventError) {
      console.error('Supabase movimiento_eventos_v2 creation error:', eventError.message);
    }
  }

  return data;
}

async function getMovimientoV2ByLegacyRowId(supabase, legacyRowId) {
  const capabilities = await resolveV2Capabilities(supabase);
  if (!capabilities.movimientosV2 || !legacyRowId) return null;

  const { data, error } = await supabase
    .from('movimientos_v2')
    .select('*')
    .eq('legacy_row_id', String(legacyRowId))
    .maybeSingle();

  if (error) {
    console.error('Supabase movimientos_v2 lookup error:', error.message);
    return null;
  }

  return data;
}

async function syncLegacyUpdateToV2(supabase, userId, legacyRow, updates = {}) {
  const capabilities = await resolveV2Capabilities(supabase);
  if (!capabilities.movimientosV2 || !legacyRow?.id) return;

  let currentV2 = await getMovimientoV2ByLegacyRowId(supabase, legacyRow.id);

  if (!currentV2) {
    const mergedSnapshot = { ...legacyRow, ...updates };
    const rowData = buildLegacyRowDataFromSnapshot(mergedSnapshot);
    currentV2 = await insertMovimientoV2FromLegacy(supabase, userId, rowData, legacyRow.id, {
      origenCarga: 'migracion',
    });
    if (!currentV2) {
      // Insert may have failed due to a concurrent insert for the same legacy_row_id.
      // Retry the lookup once before giving up so the update still applies.
      currentV2 = await getMovimientoV2ByLegacyRowId(supabase, legacyRow.id);
      if (!currentV2) return;
    }
  }

  const nextPayload = buildMovimientoV2UpdatePayload({
    legacyRow,
    updates,
    currentV2,
    allowPartialState: updates.estado !== undefined,
  });

  const { data: updatedV2, error } = await supabase
    .from('movimientos_v2')
    .update(nextPayload)
    .eq('id', currentV2.id)
    .select('*')
    .single();

  if (error) {
    console.error('Supabase movimientos_v2 update error:', error.message);
    return;
  }

  if (capabilities.movimientoEventosV2 && updates.estado !== undefined) {
    const transitionEvent = buildMovimientoV2TransitionEvent({
      movimientoId: currentV2.id,
      userId,
      previousV2: currentV2,
      nextV2: updatedV2,
      metodoPago: updates.metodo_pago,
    });

    if (transitionEvent) {
      const { error: eventError } = await supabase
        .from('movimiento_eventos_v2')
        .insert(transitionEvent);

      if (eventError) {
        console.error('Supabase movimiento_eventos_v2 transition error:', eventError.message);
      }
    }
  }
}

async function syncLegacyDeleteToV2(supabase, legacyRowId) {
  const capabilities = await resolveV2Capabilities(supabase);
  if (!capabilities.movimientosV2 || !legacyRowId) return;

  const currentV2 = await getMovimientoV2ByLegacyRowId(supabase, legacyRowId);
  if (!currentV2) return;

  const { error } = await supabase
    .from('movimientos_v2')
    .delete()
    .eq('id', currentV2.id);

  if (error) {
    console.error('Supabase movimientos_v2 delete error:', error.message);
  }
}

function formatLegacyDate(value) {
  if (!value) return '';

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(value))) {
    return String(value);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function formatLegacyHour(value) {
  if (!value) return '';

  if (/^\d{2}:\d{2}$/.test(String(value))) {
    return String(value);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function mapV2StateToLegacyState(estadoPago) {
  const normalized = String(estadoPago || '').trim().toLowerCase();
  if (['pendiente', 'parcial', 'vencido'].includes(normalized)) return 'Pendiente';
  return 'Cobrado';
}

function getOutstandingFactor(row) {
  const montoOriginal = parseFloat(row?.monto_original) || 0;
  const montoPesos = parseFloat(row?.monto_pesos) || 0;
  if (!montoOriginal || !montoPesos) return 1;
  return montoPesos / montoOriginal;
}

function getCompatibleAmountBase(row) {
  const estadoLegacy = mapV2StateToLegacyState(row?.estado_pago);
  if (estadoLegacy === 'Pendiente') {
    return Math.abs(parseFloat(row?.saldo_pendiente) || 0);
  }
  return Math.abs(parseFloat(row?.monto_original) || 0);
}

function mapV2RowToLegacySnapshot(row) {
  const compatibleAmount = getCompatibleAmountBase(row);
  const sign = row?.tipo_movimiento === 'egreso' ? -1 : 1;
  const amountFactor = getOutstandingFactor(row);
  const montoPesos = Math.round(compatibleAmount * amountFactor * 100) / 100;
  const baseDate = row?.fecha_prestacion || row?.fecha_cobro_real || row?.fecha_carga || row?.created_at || null;
  const legacyId = row?.legacy_row_id ? String(row.legacy_row_id) : `v2_${String(row?.id || 'sin-id').slice(0, 8)}`;

  return {
    id: row?.legacy_row_id || row?.id,
    fecha: formatLegacyDate(baseDate),
    hora: formatLegacyHour(row?.fecha_carga || row?.created_at || baseDate),
    descripcion: row?.descripcion || '',
    monto: sign * compatibleAmount,
    estado: mapV2StateToLegacyState(row?.estado_pago),
    tipo: row?.tipo_movimiento === 'egreso' ? 'Egreso' : 'Ingreso',
    moneda: row?.moneda || 'Pesos',
    metodo_pago: row?.metodo_pago || '',
    monto_pesos: montoPesos,
    id_unico: legacyId,
    id_origen: '',
    pagador: extractPagadorFromNotas(row?.notas),
    created_at: row?.fecha_carga || row?.created_at || null,
  };
}

function mapV2RowToExtendedFields(v2Row) {
  if (!v2Row) {
    return {
      categoria: '', paciente: '', profesional: '', tratamiento: '',
      proveedor: '', fechaPrestacion: '', fechaVencimiento: '', referenciaId: '',
    };
  }
  return {
    categoria: v2Row.categoria || '',
    paciente: v2Row.paciente_nombre || '',
    profesional: v2Row.profesional_nombre || '',
    tratamiento: v2Row.tratamiento_nombre || '',
    proveedor: v2Row.proveedor_nombre || '',
    fechaPrestacion: formatDateValue(v2Row.fecha_prestacion, ''),
    fechaVencimiento: formatDateValue(v2Row.fecha_vencimiento, ''),
    referenciaId: v2Row.referencia_id || '',
  };
}

function mapLegacyDbRowToPlainData(row, v2Row = null) {
  const v2Fields = mapV2RowToExtendedFields(v2Row);
  return {
    fecha: formatLegacyDate(row.fecha) || '',
    hora: formatLegacyHour(row.hora) || '',
    descripcion: row.descripcion || '',
    monto: parseFloat(row.monto) || 0,
    montoPesos: parseFloat(row.monto_pesos) || parseFloat(row.monto) || 0,
    estado: mapDbStateToLegacyDisplay(row.estado),
    tipo: mapDbTipoToLegacyDisplay(row.tipo),
    moneda: row.moneda || 'Pesos',
    metodoPago: getDbPaymentMethod(row),
    idUnico: row.id_unico || '',
    pagador: '',
    ...v2Fields,
    categoria: row.categoria || v2Fields.categoria,
    paciente: row.paciente || v2Fields.paciente,
    profesional: row.profesional || v2Fields.profesional,
    tratamiento: row.tratamiento || v2Fields.tratamiento,
    proveedor: row.proveedor || v2Fields.proveedor,
    fechaPrestacion: formatDateValue(row.fecha_prestacion, '') || v2Fields.fechaPrestacion,
    fechaVencimiento: formatDateValue(row.fecha_vencimiento, '') || v2Fields.fechaVencimiento,
    fechaCobro: formatDateValue(row.fecha_cobro, ''),
    referenciaId: row.referencia_id || v2Fields.referenciaId,
    _sortKey: row.created_at || null,
  };
}

function mapV2RowToPlainData(row) {
  const legacy = mapV2RowToLegacySnapshot(row);
  return {
    fecha: legacy.fecha,
    hora: legacy.hora,
    descripcion: legacy.descripcion,
    monto: legacy.monto,
    montoPesos: legacy.monto_pesos,
    estado: legacy.estado,
    tipo: legacy.tipo,
    moneda: legacy.moneda,
    metodoPago: legacy.metodo_pago,
    idUnico: legacy.id_unico,
    pagador: legacy.pagador || '',
    ...mapV2RowToExtendedFields(row),
    _sortKey: row.fecha_carga || row.created_at || null,
  };
}

async function fetchLegacyRowsForUser(supabase, userId, tenantId) {
  const { data, error } = await forTenant(tenantId)
    .from('movimientos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_MOVIMIENTOS_READ);

  if (error) {
    throw error;
  }

  return data || [];
}

async function fetchV2RowsForUser(supabase, userId) {
  const capabilities = await resolveV2Capabilities(supabase);
  if (!capabilities.movimientosV2) return [];

  const { data, error } = await supabase
    .from('movimientos_v2')
    .select('*')
    .eq('user_id', userId)
    .order('fecha_carga', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

async function resolveReadModelRows(supabase, userId, tenantId) {
  const legacyRows = await fetchLegacyRowsForUser(supabase, userId, tenantId);
  const v2Rows = await fetchV2RowsForUser(supabase, userId);
  const legacyIds = new Set(legacyRows.map(row => String(row.id)));
  const v2OnlyRows = v2Rows.filter(row => !row.legacy_row_id || !legacyIds.has(String(row.legacy_row_id)));

  const v2ByLegacyId = new Map();
  for (const v2Row of v2Rows) {
    if (v2Row.legacy_row_id && legacyIds.has(String(v2Row.legacy_row_id))) {
      v2ByLegacyId.set(String(v2Row.legacy_row_id), v2Row);
    }
  }

  return {
    legacyRows,
    v2OnlyRows,
    v2ByLegacyId,
  };
}

function sortByKeyAsc(items, getKey) {
  return [...items].sort((a, b) => {
    const keyA = getKey(a) || '';
    const keyB = getKey(b) || '';
    return String(keyA).localeCompare(String(keyB));
  });
}

function buildLegacySupabaseRowWrapper(userId, tenantId, row) {
  return {
    _supabase: true,
    id: row.id,
    get(field) {
      const legacyFecha = formatLegacyDate(row.fecha);
      const legacyHora = formatLegacyHour(row.hora);
      const legacyEstado = mapDbStateToLegacyDisplay(row.estado);
      const legacyTipo = mapDbTipoToLegacyDisplay(row.tipo);
      const legacyMetodoPago = getDbPaymentMethod(row);
      const legacyFechaCobro = formatLegacyDate(row.fecha_cobro);
      const map = {
        'Fecha': legacyFecha,
        'fecha': legacyFecha,
        'Hora': legacyHora,
        'hora': legacyHora,
        'Descripcion': row.descripcion,
        'descripcion': row.descripcion,
        'Monto': row.monto,
        'monto': row.monto,
        'Estado': legacyEstado,
        'estado': legacyEstado,
        'Tipo': legacyTipo,
        'tipo': legacyTipo,
        'Moneda': row.moneda,
        'moneda': row.moneda,
        'MetodoPago': legacyMetodoPago,
        'metodopago': legacyMetodoPago,
        'ID_Unico': row.id_unico,
        'ID_unico': row.id_unico,
        'ID_uNico': row.id_unico,
        'idunico': row.id_unico,
        'MontoPesos': row.monto_pesos,
        'montopesos': row.monto_pesos,
        'ID_Origen': row.id_origen,
        'FechaCobro': legacyFechaCobro,
        'fechacobro': legacyFechaCobro,
      };
      return map[field];
    },
    set(field, value) {
      const map = {
        'Descripcion': 'descripcion',
        'descripcion': 'descripcion',
        'Monto': 'monto',
        'monto': 'monto',
        'Estado': 'estado',
        'estado': 'estado',
        'Moneda': 'moneda',
        'moneda': 'moneda',
        'MetodoPago': 'metodo_pago',
        'metodopago': 'metodo_pago',
        'MontoPesos': 'monto_pesos',
        'montopesos': 'monto_pesos',
        'FechaCobro': 'fecha_cobro',
        'fechacobro': 'fecha_cobro',
      };
      if (map[field]) {
        this._updates = this._updates || {};
        this._updates[map[field]] = value;
      }
    },
    async save() {
      if (this._updates) {
        const supabase2 = getSupabase();
        const legacySnapshot = buildLegacySnapshotFromRow(row);
        const updates = { ...this._updates };
        const legacyCapabilities = await resolveLegacyCapabilities(supabase2);
        if (updates.metodo_pago !== undefined) {
          updates.medio_pago = normalizeMetodoPago(updates.metodo_pago) || null;
        }
        if (updates.fecha_cobro !== undefined) {
          updates.fecha_cobro = toDbDate(updates.fecha_cobro) || null;
        }
        if (!legacyCapabilities.extendedMovimientos) {
          delete updates.medio_pago;
          delete updates.referencia_id;
        }
        if (!legacyCapabilities.fechaCobro) {
          delete updates.fecha_cobro;
        }
        const { error: updateError } = await forTenant(tenantId)
          .from('movimientos')
          .update(updates)
          .eq('id', this.id);
        if (updateError) {
          throw new Error(`Supabase movimientos update failed: ${updateError.message}`);
        }
        // Sheet best-effort en background (Supabase ya guardó): no demora la request.
        runInBackground(userId, () => syncRowUpdateToSheet(userId, row.id_unico, updates), 'sheet-update');
        try {
          await syncLegacyUpdateToV2(supabase2, userId, legacySnapshot, updates);
        } catch (v2Error) {
          console.error('Supabase movimientos_v2 sync update error:', v2Error.message);
        }
        Object.assign(row, updates);
        this._updates = {};
      }
    },
    async delete() {
      const supabase2 = getSupabase();
      const legacyRowId = row.id;
      const { error: deleteError } = await forTenant(tenantId)
        .from('movimientos')
        .delete()
        .eq('id', this.id);
      if (deleteError) {
        throw new Error(`Supabase movimientos delete failed: ${deleteError.message}`);
      }
      // Sheet best-effort en background (Supabase ya borró): no demora la request.
      runInBackground(userId, () => syncRowDeleteToSheet(userId, row.id_unico), 'sheet-delete');
      try {
        await syncLegacyDeleteToV2(supabase2, legacyRowId);
      } catch (v2Error) {
        console.error('Supabase movimientos_v2 sync delete error:', v2Error.message);
      }
    },
    _sortKey: row.created_at || null,
  };
}

function buildV2SupabaseRowWrapper(userId, row) {
  return {
    _supabase: true,
    _v2: true,
    id: row.id,
    get(field) {
      const legacy = mapV2RowToLegacySnapshot(row);
      const map = {
        'Fecha': legacy.fecha,
        'fecha': legacy.fecha,
        'Hora': legacy.hora,
        'hora': legacy.hora,
        'Descripcion': legacy.descripcion,
        'descripcion': legacy.descripcion,
        'Monto': legacy.monto,
        'monto': legacy.monto,
        'Estado': legacy.estado,
        'estado': legacy.estado,
        'Tipo': legacy.tipo,
        'tipo': legacy.tipo,
        'Moneda': legacy.moneda,
        'moneda': legacy.moneda,
        'MetodoPago': legacy.metodo_pago,
        'metodopago': legacy.metodo_pago,
        'ID_Unico': legacy.id_unico,
        'ID_unico': legacy.id_unico,
        'ID_uNico': legacy.id_unico,
        'idunico': legacy.id_unico,
        'MontoPesos': legacy.monto_pesos,
        'montopesos': legacy.monto_pesos,
        'Pagador': legacy.pagador || '',
        'pagador': legacy.pagador || '',
      };
      return map[field];
    },
    set(field, value) {
      const map = {
        'Descripcion': 'descripcion',
        'descripcion': 'descripcion',
        'Monto': 'monto',
        'monto': 'monto',
        'Estado': 'estado',
        'estado': 'estado',
        'Moneda': 'moneda',
        'moneda': 'moneda',
        'MetodoPago': 'metodo_pago',
        'metodopago': 'metodo_pago',
        'MontoPesos': 'monto_pesos',
        'montopesos': 'monto_pesos',
      };
      if (map[field]) {
        this._updates = this._updates || {};
        this._updates[map[field]] = value;
      }
    },
    async save() {
      if (this._updates) {
        const supabase2 = getSupabase();
        const legacySnapshot = mapV2RowToLegacySnapshot(row);
        const updates = { ...this._updates };
        const nextPayload = buildMovimientoV2UpdatePayload({
          legacyRow: legacySnapshot,
          updates,
          currentV2: row,
          allowPartialState: updates.estado !== undefined,
        });

        const { data: updatedV2, error } = await supabase2
          .from('movimientos_v2')
          .update(nextPayload)
          .eq('id', this.id)
          .select('*')
          .single();

        if (error) {
          throw error;
        }

        const capabilities = await resolveV2Capabilities(supabase2);
        if (capabilities.movimientoEventosV2 && updates.estado !== undefined) {
          const transitionEvent = buildMovimientoV2TransitionEvent({
            movimientoId: row.id,
            userId,
            previousV2: row,
            nextV2: updatedV2,
            metodoPago: updates.metodo_pago,
          });

          if (transitionEvent) {
            const { error: eventError } = await supabase2
              .from('movimiento_eventos_v2')
              .insert(transitionEvent);

            if (eventError) {
              console.error('Supabase movimiento_eventos_v2 direct transition error:', eventError.message);
            }
          }
        }

        Object.assign(row, updatedV2);
        this._updates = {};
      }
    },
    async delete() {
      const supabase2 = getSupabase();
      const { error: deleteError } = await supabase2
        .from('movimientos_v2')
        .delete()
        .eq('id', this.id);
      if (deleteError) {
        throw new Error(`Supabase movimientos_v2 delete failed: ${deleteError.message}`);
      }
    },
    _sortKey: row.fecha_carga || row.created_at || null,
  };
}

async function obtenerDatosSheet(userId) {
  if (!USE_SUPABASE) {
    return getSheetService().obtenerDatosSheet(userId);
  }

  const supabase = getSupabase();
  if (!supabase) {
    return getSheetService().obtenerDatosSheet(userId);
  }

  const tenantId = await resolveTenantId(userId);
  if (!tenantId) {
    return getSheetService().obtenerDatosSheet(userId);
  }

  try {
    const { legacyRows, v2OnlyRows, v2ByLegacyId } = await resolveReadModelRows(supabase, userId, tenantId);
    const combined = [
      ...legacyRows.map(row => mapLegacyDbRowToPlainData(row, v2ByLegacyId.get(String(row.id)) || null)),
      ...v2OnlyRows.map(mapV2RowToPlainData),
    ];

    return sortByKeyAsc(combined, row => row._sortKey)
      .map(({ _sortKey, ...row }) => row)
      .filter(d =>
      d.fecha && d.fecha.trim() !== '' &&
      d.descripcion && d.descripcion.trim() !== '' &&
      d.monto && d.monto !== 0
      );
  } catch (err) {
    console.error('Supabase obtenerDatos catch:', err.message);
    return getSheetService().obtenerDatosSheet(userId);
  }
}

async function getDocCliente(userId, fresh = false) {
  return getSheetService().getDocCliente(userId, fresh);
}

async function findSheetRowByIdUnico(userId, idUnico) {
  if (!idUnico) return null;

  const sheet = await getSheetService().getSheetCliente(userId);
  if (!sheet) return null;

  const rows = await sheet.getRows();
  return rows.find(row => getRowIdUnico(row, '') === idUnico) || null;
}

async function syncRowUpdateToSheet(userId, rowIdUnico, updates = {}) {
  const sheetRow = await findSheetRowByIdUnico(userId, rowIdUnico);
  if (!sheetRow) return;

  const fieldMap = {
    descripcion: 'Descripcion',
    monto: 'Monto',
    estado: 'Estado',
    moneda: 'Moneda',
    metodo_pago: 'MetodoPago',
    medio_pago: 'MetodoPago',
    monto_pesos: 'MontoPesos',
    id_unico: 'ID_Unico',
    id_origen: 'ID_Origen',
    referencia_id: 'ReferenciaId',
    fecha_cobro: 'FechaCobro',
  };

  for (const [key, value] of Object.entries(updates)) {
    if (fieldMap[key]) {
      // fecha_cobro llega en ISO (o null) desde el wrapper de Supabase; el
      // Sheet usa el mismo formato DD/MM/YYYY que el resto de las columnas
      // de fecha.
      const sheetValue = key === 'fecha_cobro' ? formatLegacyDate(value) : value;
      sheetRow.set(fieldMap[key], sheetValue);
    }
  }

  await sheetRow.save();
  await aplicarColorMontoEnFila(
    sheetRow,
    updates.monto !== undefined ? updates.monto : sheetRow.get('Monto'),
    updates.estado !== undefined ? updates.estado : sheetRow.get('Estado')
  );
}

async function syncRowDeleteToSheet(userId, rowIdUnico) {
  const sheetRow = await findSheetRowByIdUnico(userId, rowIdUnico);
  if (!sheetRow) return;
  await sheetRow.delete();
}

async function getSheetCliente(userId) {
  if (!USE_SUPABASE) {
    return getSheetService().getSheetCliente(userId);
  }

  return {
    _supabase: true,
    userId,
    async addRow(rowData, opts) {
      return addRow(userId, rowData, opts);
    },
    async getRows() {
      return getRows(userId);
    },
  };
}

async function addRow(userId, rowData, options = {}) {
  return withUserWriteLock(userId, () => doAddRow(userId, rowData, options));
}

async function doAddRow(userId, rowData, options = {}) {
  if (!USE_SUPABASE) {
    const sheet = await getSheetService().getSheetCliente(userId);
    if (!sheet) return null;
    await getSheetService().ensureSheetStructure(sheet);
    const row = await sheet.addRow(rowData, { insert: true });
    await aplicarColorMontoEnFila(row, rowData.Monto, rowData.Estado);
    emitMovimientosUpdated(userId);
    return row;
  }

  const supabase = getSupabase();
  if (!supabase) {
    const sheet = await getSheetService().getSheetCliente(userId);
    if (!sheet) return null;
    await getSheetService().ensureSheetStructure(sheet);
    const row = await sheet.addRow(rowData, { insert: true });
    await aplicarColorMontoEnFila(row, rowData.Monto, rowData.Estado);
    emitMovimientosUpdated(userId);
    return row;
  }

  const legacyCapabilities = await resolveLegacyCapabilities(supabase);
  const supabaseRow = {
    user_id: userId,
    fecha: toDbDate(rowData.Fecha) || new Date().toISOString().slice(0, 10),
    hora: rowData.Hora || '',
    descripcion: rowData.Descripcion || '',
    monto: parseFloat(rowData.Monto) || 0,
    estado: rowData.Estado || 'Cobrado',
    tipo: getTipoMovimientoFromLegacy(rowData.Tipo),
    categoria: rowData.Categoria || null,
    moneda: rowData.Moneda || 'Pesos',
    metodo_pago: rowData.MetodoPago || '',
    medio_pago: normalizeMetodoPago(rowData.MetodoPago || rowData.MedioPago || '') || null,
    id_unico: rowData.ID_Unico || '',
    monto_pesos: parseFloat(rowData.MontoPesos) || parseFloat(rowData.Monto) || 0,
    id_origen: rowData.ID_Origen || '',
    referencia_id: options.movimientoV2Data?.referenciaId || rowData.ReferenciaId || null,
    paciente: rowData.Paciente || null,
    profesional: rowData.Profesional || null,
    tratamiento: rowData.Tratamiento || null,
    proveedor: rowData.Proveedor || null,
    fecha_prestacion: toDbDate(rowData.FechaPrestacion) || null,
    fecha_vencimiento: toDbDate(rowData.FechaVencimiento) || null,
    // No se stampea acá: FechaCobro solo se setea en la transición real
    // Pendiente -> Cobrado (ver doEjecutarCobrar / updateMovimiento). Esto
    // queda en null salvo que el caller la pase explícitamente.
    fecha_cobro: toDbDate(rowData.FechaCobro) || null,
  };

  if (!legacyCapabilities.extendedMovimientos) {
    delete supabaseRow.categoria;
    delete supabaseRow.medio_pago;
    delete supabaseRow.referencia_id;
  }

  if (!legacyCapabilities.extendedCampos) {
    delete supabaseRow.paciente;
    delete supabaseRow.profesional;
    delete supabaseRow.tratamiento;
    delete supabaseRow.proveedor;
    delete supabaseRow.fecha_prestacion;
    delete supabaseRow.fecha_vencimiento;
  }

  if (!legacyCapabilities.fechaCobro) {
    delete supabaseRow.fecha_cobro;
  }

  await ensureProfile(userId);

  const tenantId = await resolveTenantId(userId);
  if (!tenantId) {
    console.error('Supabase addRow: no se pudo resolver tenantId, usando solo Sheet para', userId);
    const sheet = await getSheetService().getSheetCliente(userId);
    if (!sheet) return null;
    await getSheetService().ensureSheetStructure(sheet);
    const row = await sheet.addRow(rowData, { insert: true });
    await aplicarColorMontoEnFila(row, rowData.Monto, rowData.Estado);
    emitMovimientosUpdated(userId);
    return row;
  }

  const { data, error } = await forTenant(tenantId)
    .from('movimientos')
    .insert(supabaseRow)
    .select()
    .single();

  if (error) {
    console.error('Supabase addRow error:', error.message);
    try {
      const sheet = await getSheetService().getSheetCliente(userId);
      if (sheet) {
        await getSheetService().ensureSheetStructure(sheet);
        const row = await sheet.addRow(rowData, { insert: true });
        await aplicarColorMontoEnFila(row, rowData.Monto, rowData.Estado);
      }
    } catch (e) {
      console.error('Sheet fallback error:', e.message);
    }
    return null;
  }

  try {
    await insertMovimientoV2FromLegacy(
      supabase,
      userId,
      rowData,
      data?.id || null,
      options.movimientoV2Data || {}
    );
  } catch (v2Error) {
    console.error('Supabase movimientos_v2 sync insert error:', v2Error.message);
  }

  // dual-write best-effort: Supabase ya es la fuente de verdad, así que el
  // backup a Google Sheets se hace en background bajo el lock del usuario (para
  // no pisar otras escrituras del mismo user) sin demorar la respuesta. Si
  // Sheets está lento o sobre cuota, no afecta al bot/dashboard.
  runInBackground(userId, async () => {
    const sheet = await getSheetService().getSheetCliente(userId);
    if (!sheet) return;
    await getSheetService().ensureSheetStructure(sheet);
    const row = await sheet.addRow(rowData, { insert: true });
    await aplicarColorMontoEnFila(row, rowData.Monto, rowData.Estado);
  }, 'sheet-addRow');

  emitMovimientosUpdated(userId);
  return data || rowData;
}

async function getRows(userId) {
  if (!USE_SUPABASE) {
    const sheet = await getSheetService().getSheetCliente(userId);
    if (!sheet) return [];
    return sheet.getRows();
  }

  const supabase = getSupabase();
  if (!supabase) {
    const sheet = await getSheetService().getSheetCliente(userId);
    if (!sheet) return [];
    return sheet.getRows();
  }

  const tenantId = await resolveTenantId(userId);
  if (!tenantId) {
    const sheet = await getSheetService().getSheetCliente(userId);
    if (!sheet) return [];
    return sheet.getRows();
  }

  try {
    const { legacyRows, v2OnlyRows } = await resolveReadModelRows(supabase, userId, tenantId);
    const combined = [
      ...legacyRows.map(row => buildLegacySupabaseRowWrapper(userId, tenantId, row)),
      ...v2OnlyRows.map(row => buildV2SupabaseRowWrapper(userId, row)),
    ];

    return sortByKeyAsc(combined, row => row._sortKey);
  } catch (err) {
    console.error('Supabase getRows catch:', err.message);
    const sheet = await getSheetService().getSheetCliente(userId);
    if (!sheet) return [];
    return sheet.getRows();
  }
}

async function getProfile(userId) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Supabase getProfile error:', error.message);
    }
    return null;
  }
  return data;
}

async function upsertProfile(userId, profileData) {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      web_user_id: profileData.webUserId || null,
      email: profileData.email || null,
      display_name: profileData.display_name || null,
      sheet_id: profileData.sheetId || null,
      plan: profileData.plan || 'free',
    });

  if (error) {
    console.error('Supabase upsertProfile error:', error.message);
    return false;
  }
  return true;
}

// Encuentra una fila por ID único entre los wrappers ya cargados o haciendo una carga fresca.
// Usa getRowIdUnico para manejar todas las variantes de nombre de columna.
async function findRowByIdUnico(userId, idUnico) {
  if (!idUnico) return null;
  const rows = await getRows(userId);
  return rows.find(row => {
    // Wrappers de Supabase y filas de Sheets — ambos implementan .get()
    if (typeof row.get === 'function') {
      return getRowIdUnico(row, '') === idUnico;
    }
    return row.idUnico === idUnico;
  }) || null;
}

// Fallback: encuentra una fila por descripción + monto cuando no tiene ID_Unico.
// Se usa para limpiar filas viejas desde el dashboard.
async function findRowByCompositeKey(userId, { descripcion, monto, fecha }) {
  const rows = await getRows(userId);
  const montoNum = parseFloat(monto);
  return rows.find(row => {
    const desc = typeof row.get === 'function' ? (row.get('Descripcion') || row.get('descripcion') || '') : (row.descripcion || '');
    const mont = typeof row.get === 'function' ? parseFloat(row.get('Monto') || row.get('monto') || 0) : parseFloat(row.monto || 0);
    const fec  = typeof row.get === 'function' ? (row.get('Fecha') || row.get('fecha') || '') : (row.fecha || '');
    return desc.trim().toLowerCase() === String(descripcion || '').trim().toLowerCase()
      && Math.abs(mont - montoNum) < 0.01
      && (!fecha || fec.includes(String(fecha).substring(0, 5))); // compara dd/mm al menos
  }) || null;
}

// Actualiza un movimiento por ID único.
async function updateMovimiento(userId, idUnico, updates) {
  await withUserWriteLock(userId, async () => {
    const row = await findRowByIdUnico(userId, idUnico);
    if (!row) throw new Error('movimiento_no_encontrado');

    const fieldMap = {
      descripcion: 'Descripcion',
      monto:       'Monto',
      estado:      'Estado',
      moneda:      'Moneda',
      metodoPago:  'MetodoPago',
      metodo_pago: 'MetodoPago',
      montoPesos:  'MontoPesos',
      fechaCobro:  'FechaCobro',
      fecha_cobro: 'FechaCobro',
    };

    // Stampear/limpiar FechaCobro solo en la transición real de estado, no en
    // cualquier edición. Cobrado -> Pendiente limpia la fecha: si no, quedaría
    // una fecha de cobro fantasma en un movimiento que ya no está cobrado.
    if (updates.estado !== undefined) {
      const estadoPrevio = row.get('Estado');
      if (updates.estado === 'Cobrado' && estadoPrevio === 'Pendiente') {
        const hoy = new Date();
        updates = { ...updates, fechaCobro: `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth() + 1).toString().padStart(2, '0')}/${hoy.getFullYear()}` };
      } else if (updates.estado === 'Pendiente' && estadoPrevio === 'Cobrado') {
        updates = { ...updates, fechaCobro: '' };
      }
    }

    for (const [key, value] of Object.entries(updates)) {
      const col = fieldMap[key];
      if (col !== undefined) row.set(col, value);
    }

    await row.save();
  });
  invalidateCache(userId);
  emitMovimientosUpdated(userId);
}

// Elimina un movimiento por ID único.
async function deleteMovimiento(userId, idUnico) {
  await withUserWriteLock(userId, async () => {
    const row = await findRowByIdUnico(userId, idUnico);
    if (!row) throw new Error('movimiento_no_encontrado');
    await row.delete();
  });
  invalidateCache(userId);
  emitMovimientosUpdated(userId);
}

// Elimina un movimiento por clave compuesta (para filas sin ID_Unico).
async function deleteMovimientoByKey(userId, compositeKey) {
  await withUserWriteLock(userId, async () => {
    const row = await findRowByCompositeKey(userId, compositeKey);
    if (!row) throw new Error('movimiento_no_encontrado');
    await row.delete();
  });
  invalidateCache(userId);
  emitMovimientosUpdated(userId);
}

module.exports = {
  getSheetId,
  invalidateCache,
  getDocCliente,
  getSheetCliente,
  obtenerDatosSheet,
  addRow,
  getRows,
  findRowByIdUnico,
  findRowByCompositeKey,
  updateMovimiento,
  deleteMovimiento,
  deleteMovimientoByKey,
  getProfile,
  upsertProfile,
};
