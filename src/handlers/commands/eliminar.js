const { bot } = require('../../lib/telegraf');
const { getSheetCliente } = require('../../services/sheet.service');
const { formatMonto } = require('../../utils/formatter');
const state = require('../../state');

bot.command('eliminar', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);

    if (args.length === 0) {
      return ctx.reply('⚠️ Uso: /eliminar [ID o nombre]\n\nEjemplo: /eliminar consulta Juan');
    }

    const texto = ctx.message.text.replace('/eliminar', '').trim().toLowerCase();
    console.log('DEBUG /eliminar - Buscando:', texto);

    const sheet = await getSheetCliente(ctx.from.id);
    if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');
    const filas = await sheet.getRows();

    console.log('DEBUG /eliminar - Total filas:', filas.length);
    
    if (filas.length > 0) {
      const primeraFila = filas[0].toObject ? filas[0].toObject() : filas[0];
      console.log('DEBUG /eliminar - Columnas disponibles:', Object.keys(primeraFila));
      console.log('DEBUG /eliminar - Primera fila:', primeraFila);
    }

    let filaActual = null;
    const coincidencias = [];

    filas.forEach((f, index) => {
      const desc = (
        f.get('Descripcion') || 
        f.get('descripcion') || 
        f.get('Paciente') || 
        f.get('paciente') || 
        f.get('Nombre') || 
        f.get('nombre') || 
        ''
      ).toLowerCase();
      
      const id = (
        f.get('ID_Unico') || 
        f.get('ID_unico') || 
        f.get('ID_uNico') || 
        f.get('idunico') || 
        ''
      ).toLowerCase();

      console.log(`DEBUG /eliminar - Fila ${index}: desc="${desc}", id="${id}"`);

      if (id === texto || desc.includes(texto)) {
        console.log(`DEBUG /eliminar - ¡COINCIDENCIA en fila ${index}!`);
        coincidencias.push({ fila: f, index });
      }
    });

    console.log('DEBUG /eliminar - Coincidencias encontradas:', coincidencias.length);

    if (coincidencias.length === 0) {
      let msg = '❌ No se encontró ningún movimiento con ese nombre o ID.\n\n';
      msg += '📋 *Últimos 5 movimientos:*\n\n';
      
      const ultimosMovimientos = filas.slice(-5).reverse();
      ultimosMovimientos.forEach((f, i) => {
        const desc = f.get('Descripcion') || f.get('descripcion') || f.get('Paciente') || f.get('paciente') || f.get('Nombre') || f.get('nombre') || 'Sin descripción';
        const monto = f.get('Monto') || f.get('monto') || '0';
        const fecha = f.get('Fecha') || f.get('fecha') || '';
        msg += `${i + 1}. ${desc}\n`;
        msg += `   $${monto} - ${fecha}\n\n`;
      });
      
      msg += '💡 *Tip:* Intenta copiar parte del nombre exacto de arriba.';
      
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    if (coincidencias.length > 1) {
      let msg = `⚠️ *Varias coincidencias (${coincidencias.length}):*\n\n`;
      coincidencias.slice(0, 5).forEach((c, i) => {
        const f = c.fila;
        const desc = f.get('Descripcion') || f.get('descripcion') || f.get('Paciente') || f.get('paciente') || f.get('Nombre') || f.get('nombre') || 'Sin descripción';
        msg += `${i + 1}. ${desc}\n`;
        msg += `   ${formatMonto(parseFloat(f.get('Monto') || f.get('monto') || 0), f.get('Moneda') || f.get('moneda') || 'Pesos')} - ${f.get('Fecha') || f.get('fecha')}\n\n`;
      });
      msg += `\nEspecificá mejor el nombre o usa /listar para ver todos.`;
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    filaActual = coincidencias[0].fila;

    const monto = parseFloat(filaActual.get('Monto') || filaActual.get('monto') || 0);
    const moneda = filaActual.get('Moneda') || filaActual.get('moneda') || 'Pesos';
    const desc = filaActual.get('Descripcion') || filaActual.get('descripcion') || filaActual.get('Paciente') || filaActual.get('paciente') || filaActual.get('Nombre') || filaActual.get('nombre') || 'Sin descripción';
    const id = filaActual.get('ID_Unico') || filaActual.get('ID_unico') || filaActual.get('ID_uNico') || filaActual.get('idunico') || 'sin-id';
    const fecha = filaActual.get('Fecha') || filaActual.get('fecha') || 'N/A';
    const hora = filaActual.get('Hora') || filaActual.get('hora') || 'N/A';
    const tipo = filaActual.get('Tipo') || filaActual.get('tipo') || 'N/A';
    const metodo = filaActual.get('MetodoPago') || filaActual.get('metodopago') || 'N/A';
    const estado = filaActual.get('Estado') || filaActual.get('estado') || 'N/A';

    state.pendingDeletes.set(ctx.from.id, { 
      fila: filaActual,
      index: coincidencias[0].index,
      sheet, 
      desc, 
      monto, 
      moneda, 
      id,
      fecha,
      hora,
      tipo,
      metodo,
      estado
    });

    let msg = `⚠️ *¿ELIMINAR ESTE MOVIMIENTO?*\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📝 ${desc}\n`;
    msg += `💰 ${formatMonto(monto, moneda)}\n`;
    msg += `📅 ${fecha} ${hora}\n`;
    msg += `🏷️ Tipo: ${tipo}\n`;
    msg += `💳 Método: ${metodo}\n`;
    msg += `📊 Estado: ${estado}\n`;
    msg += `🆔 ${id}\n`;
    msg += `📄 Fila: #${coincidencias[0].index + 1} del Sheet\n\n`;
    msg += `⚠️ *¿Confirmas la eliminación?*\n`;
    msg += `Responde *sí* para confirmar o *no* para cancelar.`;

    ctx.reply(msg, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error /eliminar:', error.message, error.stack);
    ctx.reply('❌ Error al buscar movimiento. Verifica los logs.');
  }
});

module.exports = {};
