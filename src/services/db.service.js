const { getSupabase, isAvailable } = require('../lib/supabase');
const { USE_SUPABASE, SPREADSHEET_ID } = require('../config');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');
const { aplicarColorMontoEnFila } = require('./sheet-format.service');
const { getRowIdUnico } = require('../utils/sheet-row');

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

async function ensureProfile(userId) {
  if (!USE_SUPABASE) return;

  const supabase = getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('Supabase ensureProfile select error:', error.message);
    return;
  }

  if (data) return;

  const cliente = obtenerClientePorUserId(userId);
  const profileRow = {
    id: userId,
    email: cliente?.email || null,
    display_name: cliente?.email ? cliente.email.split('@')[0] : null,
    sheet_id: cliente?.sheetId || (esAdminOriginal(userId) ? SPREADSHEET_ID : null),
    usuarios: Array.isArray(cliente?.usuarios) ? cliente.usuarios : [],
  };

  const { error: upsertError } = await supabase
    .from('profiles')
    .upsert(profileRow, { onConflict: 'id' });

  if (upsertError) {
    console.error('Supabase ensureProfile upsert error:', upsertError.message);
  }
}

async function obtenerDatosSheet(userId) {
  if (!USE_SUPABASE) {
    return getSheetService().obtenerDatosSheet(userId);
  }

  const supabase = getSupabase();
  if (!supabase) {
    return getSheetService().obtenerDatosSheet(userId);
  }

  try {
    const { data, error } = await supabase
      .from('movimientos')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Supabase obtenerDatos error:', error.message);
      return getSheetService().obtenerDatosSheet(userId);
    }

    return data.map(row => ({
      fecha: row.fecha || '',
      hora: row.hora || '',
      descripcion: row.descripcion || '',
      monto: parseFloat(row.monto) || 0,
      montoPesos: parseFloat(row.monto_pesos) || parseFloat(row.monto) || 0,
      estado: row.estado || '',
      tipo: row.tipo || '',
      moneda: row.moneda || 'Pesos',
      metodoPago: row.metodo_pago || '',
      idUnico: row.id_unico || '',
    })).filter(d =>
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
    monto_pesos: 'MontoPesos',
    id_unico: 'ID_Unico',
    id_origen: 'ID_Origen',
  };

  for (const [key, value] of Object.entries(updates)) {
    if (fieldMap[key]) {
      sheetRow.set(fieldMap[key], value);
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
      return addRow(userId, rowData);
    },
    async getRows() {
      return getRows(userId);
    },
  };
}

async function addRow(userId, rowData) {
  if (!USE_SUPABASE) {
    const sheet = await getSheetService().getSheetCliente(userId);
    if (!sheet) return null;
    const row = await sheet.addRow(rowData, { insert: true });
    await aplicarColorMontoEnFila(row, rowData.Monto, rowData.Estado);
    return row;
  }

  const supabase = getSupabase();
  if (!supabase) {
    const sheet = await getSheetService().getSheetCliente(userId);
    if (!sheet) return null;
    const row = await sheet.addRow(rowData, { insert: true });
    await aplicarColorMontoEnFila(row, rowData.Monto, rowData.Estado);
    return row;
  }

  const supabaseRow = {
    user_id: userId,
    fecha: rowData.Fecha || '',
    hora: rowData.Hora || '',
    descripcion: rowData.Descripcion || '',
    monto: parseFloat(rowData.Monto) || 0,
    estado: rowData.Estado || 'Cobrado',
    tipo: rowData.Tipo || '',
    moneda: rowData.Moneda || 'Pesos',
    metodo_pago: rowData.MetodoPago || '',
    id_unico: rowData.ID_Unico || '',
    monto_pesos: parseFloat(rowData.MontoPesos) || parseFloat(rowData.Monto) || 0,
    id_origen: rowData.ID_Origen || '',
  };

  await ensureProfile(userId);

  const { data, error } = await supabase
    .from('movimientos')
    .insert(supabaseRow)
    .select()
    .single();

  if (error) {
    console.error('Supabase addRow error:', error.message);
    // fallback to sheet
    try {
      const sheet = await getSheetService().getSheetCliente(userId);
      if (sheet) {
        const row = await sheet.addRow(rowData, { insert: true });
        await aplicarColorMontoEnFila(row, rowData.Monto, rowData.Estado);
      }
    } catch (e) {
      console.error('Sheet fallback error:', e.message);
    }
    return rowData;
  }

  // dual-write: also write to sheet as backup
  try {
    const sheet = await getSheetService().getSheetCliente(userId);
    if (sheet) {
      const row = await sheet.addRow(rowData, { insert: true });
      await aplicarColorMontoEnFila(row, rowData.Monto, rowData.Estado);
    }
  } catch (e) {
    // sheet write failed, thats OK - supabase is source of truth
  }

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

  try {
    const { data, error } = await supabase
      .from('movimientos')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Supabase getRows error:', error.message);
      const sheet = await getSheetService().getSheetCliente(userId);
      if (!sheet) return [];
      return sheet.getRows();
    }

    return data.map(row => ({
      _supabase: true,
      id: row.id,
      get(field) {
        const map = {
          'Fecha': row.fecha,
          'fecha': row.fecha,
          'Hora': row.hora,
          'hora': row.hora,
          'Descripcion': row.descripcion,
          'descripcion': row.descripcion,
          'Monto': row.monto,
          'monto': row.monto,
          'Estado': row.estado,
          'estado': row.estado,
          'Tipo': row.tipo,
          'tipo': row.tipo,
          'Moneda': row.moneda,
          'moneda': row.moneda,
          'MetodoPago': row.metodo_pago,
          'metodopago': row.metodo_pago,
          'ID_Unico': row.id_unico,
          'ID_unico': row.id_unico,
          'ID_uNico': row.id_unico,
          'idunico': row.id_unico,
          'MontoPesos': row.monto_pesos,
          'montopesos': row.monto_pesos,
          'ID_Origen': row.id_origen,
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
        };
        if (map[field]) {
          this._updates = this._updates || {};
          this._updates[map[field]] = value;
        }
      },
      async save() {
        if (this._updates) {
          const supabase2 = getSupabase();
          const updates = { ...this._updates };
          await supabase2
            .from('movimientos')
            .update(updates)
            .eq('id', this.id);
          try {
            await syncRowUpdateToSheet(userId, row.id_unico, updates);
          } catch (sheetError) {
            console.error('Sheet sync update error:', sheetError.message);
          }
          Object.assign(row, updates);
          this._updates = {};
        }
      },
      async delete() {
        const supabase2 = getSupabase();
        await supabase2
          .from('movimientos')
          .delete()
          .eq('id', this.id);
        try {
          await syncRowDeleteToSheet(userId, row.id_unico);
        } catch (sheetError) {
          console.error('Sheet sync delete error:', sheetError.message);
        }
      },
    }));
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

module.exports = {
  getSheetId,
  invalidateCache,
  getDocCliente,
  getSheetCliente,
  obtenerDatosSheet,
  addRow,
  getRows,
  getProfile,
  upsertProfile,
};
