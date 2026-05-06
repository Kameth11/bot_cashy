const { getSupabase, isAvailable } = require('../lib/supabase');
const { USE_SUPABASE, SPREADSHEET_ID } = require('../config');
const { esAdminOriginal } = require('../auth');
const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');

const sheetService = require('./sheet.service');
const { aplicarColorMontoEnFila } = require('./sheet-format.service');

function getSheetId(userId) {
  return sheetService.getSheetId(userId);
}

function invalidateCache(userId) {
  if (USE_SUPABASE) {
    // no cache needed with Supabase
  }
  sheetService.invalidateCache(userId);
}

async function obtenerDatosSheet(userId) {
  if (!USE_SUPABASE) {
    return sheetService.obtenerDatosSheet(userId);
  }

  const supabase = getSupabase();
  if (!supabase) {
    return sheetService.obtenerDatosSheet(userId);
  }

  try {
    const { data, error } = await supabase
      .from('movimientos')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Supabase obtenerDatos error:', error.message);
      return sheetService.obtenerDatosSheet(userId);
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
    return sheetService.obtenerDatosSheet(userId);
  }
}

async function getSheetCliente(userId) {
  if (!USE_SUPABASE) {
    return sheetService.getSheetCliente(userId);
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
    const sheet = await sheetService.getSheetCliente(userId);
    if (!sheet) return null;
    const row = await sheet.addRow(rowData, { insert: true });
    await aplicarColorMontoEnFila(row, rowData.Monto, rowData.Estado);
    return row;
  }

  const supabase = getSupabase();
  if (!supabase) {
    const sheet = await sheetService.getSheetCliente(userId);
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

  const { data, error } = await supabase
    .from('movimientos')
    .insert(supabaseRow)
    .select()
    .single();

  if (error) {
    console.error('Supabase addRow error:', error.message);
    // fallback to sheet
    try {
      const sheet = await sheetService.getSheetCliente(userId);
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
    const sheet = await sheetService.getSheetCliente(userId);
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
    const sheet = await sheetService.getSheetCliente(userId);
    if (!sheet) return [];
    return sheet.getRows();
  }

  const supabase = getSupabase();
  if (!supabase) {
    const sheet = await sheetService.getSheetCliente(userId);
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
      const sheet = await sheetService.getSheetCliente(userId);
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
          await supabase2
            .from('movimientos')
            .update(this._updates)
            .eq('id', this.id);
          this._updates = {};
        }
      },
      async delete() {
        const supabase2 = getSupabase();
        await supabase2
          .from('movimientos')
          .delete()
          .eq('id', this.id);
      },
    }));
  } catch (err) {
    console.error('Supabase getRows catch:', err.message);
    const sheet = await sheetService.getSheetCliente(userId);
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
  getDocCliente: sheetService.getDocCliente,
  getSheetCliente,
  obtenerDatosSheet,
  addRow,
  getRows,
  getProfile,
  upsertProfile,
};
