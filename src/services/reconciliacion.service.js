// Compara los movimientos de Google Sheets con los de Supabase (tabla `movimientos`)
// de un mismo consultorio. SOLO LEE: no corrige nada (PLAN_BASE_DE_DATOS.md, fase 3).

function tipoNormalizado(tipo) {
  return String(tipo || '').trim().toLowerCase().startsWith('egr') ? 'egreso' : 'ingreso';
}

// "DD/MM/AAAA" o "AAAA-MM-DD[...]" -> "AAAA-MM". '' si no se entiende.
function mesDe(fecha) {
  const s = String(fecha || '').trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}`;
  m = s.match(/^(\d{4})-(\d{2})-\d{2}/);
  return m ? `${m[1]}-${m[2]}` : '';
}

const aNumero = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const redondear = n => Math.round(n * 100) / 100;

// Entrada: listas de { id, fecha, tipo, montoPesos } ya normalizadas.
function compararMovimientos(sheet, db) {
  const idsSheet = new Map();
  const idsDb = new Map();
  let sheetSinId = 0;
  let dbSinId = 0;
  for (const m of sheet) { if (m.id) idsSheet.set(String(m.id), m); else sheetSinId++; }
  for (const m of db) { if (m.id) idsDb.set(String(m.id), m); else dbSinId++; }

  const soloSheet = [...idsSheet.keys()].filter(id => !idsDb.has(id));
  const soloSupabase = [...idsDb.keys()].filter(id => !idsSheet.has(id));
  const montoDistinto = [];
  for (const [id, a] of idsSheet) {
    const b = idsDb.get(id);
    if (b && Math.abs(Math.abs(aNumero(a.montoPesos)) - Math.abs(aNumero(b.montoPesos))) > 0.01) {
      montoDistinto.push({ id, sheet: Math.abs(aNumero(a.montoPesos)), supabase: Math.abs(aNumero(b.montoPesos)) });
    }
  }

  const acumular = lista => {
    const porMes = new Map();
    for (const m of lista) {
      const mes = mesDe(m.fecha);
      if (!mes) continue;
      const t = porMes.get(mes) || { cantidad: 0, ingresos: 0, egresos: 0 };
      t.cantidad++;
      if (tipoNormalizado(m.tipo) === 'egreso') t.egresos += Math.abs(aNumero(m.montoPesos));
      else t.ingresos += Math.abs(aNumero(m.montoPesos));
      porMes.set(mes, t);
    }
    return porMes;
  };
  const mesesSheet = acumular(sheet);
  const mesesDb = acumular(db);
  const meses = [...new Set([...mesesSheet.keys(), ...mesesDb.keys()])].sort();
  const vacio = { cantidad: 0, ingresos: 0, egresos: 0 };
  const mesesConDiferencia = [];
  for (const mes of meses) {
    const a = mesesSheet.get(mes) || vacio;
    const b = mesesDb.get(mes) || vacio;
    if (a.cantidad !== b.cantidad || Math.abs(a.ingresos - b.ingresos) > 0.01 || Math.abs(a.egresos - b.egresos) > 0.01) {
      mesesConDiferencia.push({
        mes,
        sheet: { ...a, ingresos: redondear(a.ingresos), egresos: redondear(a.egresos) },
        supabase: { ...b, ingresos: redondear(b.ingresos), egresos: redondear(b.egresos) },
      });
    }
  }

  return {
    totalSheet: sheet.length,
    totalSupabase: db.length,
    sheetSinId,
    supabaseSinId: dbSinId,
    soloSheet,
    soloSupabase,
    montoDistinto,
    mesesConDiferencia,
    coincide: !soloSheet.length && !soloSupabase.length && !montoDistinto.length && !mesesConDiferencia.length,
  };
}

// Dueños (uno por Sheet/consultorio): invitados comparten el del dueño.
function listarDuenos() {
  const clienteService = require('./cliente.service');
  const out = [];
  for (const [id, c] of Object.entries(clienteService.clientes || {})) {
    if (c && String(c.ownerId ?? id) === String(id)) out.push(Number(id));
  }
  return out;
}

async function reconciliarUsuario(userId) {
  const { toMovimiento, isValidMovimientoRow } = require('../utils/sheet-row');
  const dbService = require('./db.service');
  const { getSupabase } = require('../lib/supabase');
  const { resolveTenantId } = require('./tenant.service');

  const supabase = getSupabase();
  if (!supabase) return { userId, error: 'Supabase no está activo' };
  const tenantId = await resolveTenantId(userId);
  if (!tenantId) return { userId, error: 'No se pudo resolver el consultorio en Supabase' };
  const sheet = await dbService.getSheetCliente(userId);
  if (!sheet) return { userId, error: 'No se pudo abrir el Google Sheet' };

  const filasSheet = (await sheet.getRows()).filter(isValidMovimientoRow).map(r => {
    const m = toMovimiento(r);
    return { id: m.idUnico, fecha: m.fecha, tipo: m.tipo, montoPesos: m.montoPesos || m.monto };
  });
  const filasDb = (await dbService.fetchLegacyRowsForUser(supabase, userId, tenantId))
    .filter(r => r.fecha && r.descripcion && Number(r.monto) !== 0)
    .map(r => ({ id: r.id_unico, fecha: r.fecha, tipo: r.tipo, montoPesos: r.monto_pesos || r.monto }));

  return { userId, ...compararMovimientos(filasSheet, filasDb) };
}


module.exports = { compararMovimientos, mesDe, listarDuenos, reconciliarUsuario };
