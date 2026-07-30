const { bot } = require('../../lib/telegraf');
const personalService = require('../../services/personal.service');
const { formatMonto, escapeMarkdown } = require('../../utils/formatter');

const USO =
  '✈️ *Viajes*\n\n' +
  '`/viaje` — ver el viaje activo y su total\n' +
  '`/viaje nuevo <nombre> <desde> <hasta>` — abrir un viaje\n' +
  '`/viaje cerrar` — cerrar el viaje activo\n\n' +
  'Ejemplo:\n' +
  '`/viaje nuevo Brasil 10/01/2026 20/01/2026`\n\n' +
  '_Los gastos personales que caigan en esas fechas se atribuyen solos._\n' +
  '_Los gastos de la casa (luz, alquiler, expensas) quedan afuera._';

// DD/MM/YYYY, con año opcional (asume el actual).
function parsearFecha(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const dia = String(m[1]).padStart(2, '0');
  const mes = String(m[2]).padStart(2, '0');
  let anio = m[3] || String(new Date().getFullYear());
  if (anio.length === 2) anio = `20${anio}`;
  if (Number(mes) < 1 || Number(mes) > 12 || Number(dia) < 1 || Number(dia) > 31) return null;
  return `${dia}/${mes}/${anio}`;
}

async function mostrarViajeActivo(ctx, userId) {
  const viaje = await personalService.obtenerViajeActivo(userId);
  if (!viaje) {
    return ctx.reply(
      '✈️ No tenés ningún viaje activo.\n\n' +
      'Abrí uno con:\n`/viaje nuevo Brasil 10/01 20/01`',
      { parse_mode: 'Markdown' }
    );
  }

  const movimientos = await personalService.obtenerMovimientosPersonales(userId);
  const delViaje = movimientos.filter(m => m.viajeId === viaje.idViaje);
  const total = delViaje.reduce(
    (acc, m) => acc + Math.abs(Number(m.montoPesos) || Number(m.monto) || 0),
    0
  );

  const porCategoria = new Map();
  for (const m of delViaje) {
    const cat = m.categoria || 'otros';
    const monto = Math.abs(Number(m.montoPesos) || Number(m.monto) || 0);
    porCategoria.set(cat, (porCategoria.get(cat) || 0) + monto);
  }

  let msg = `✈️ *${escapeMarkdown(viaje.nombre)}*\n\n`;
  msg += `📅 ${viaje.fechaInicio || '—'} a ${viaje.fechaFin || 'sin cierre'}\n`;
  msg += `💰 Gastado: ${formatMonto(total, 'Pesos')}\n`;

  if (viaje.presupuesto) {
    const pct = Math.round((total / viaje.presupuesto) * 100);
    const icono = total > viaje.presupuesto ? '🔴' : pct >= 80 ? '⚠️' : '✅';
    msg += `${icono} Presupuesto: ${formatMonto(viaje.presupuesto, viaje.moneda)} (${pct}%)\n`;
  }

  msg += `🧾 Movimientos: ${delViaje.length}\n`;

  if (porCategoria.size > 0) {
    msg += '\n*Por categoría:*\n';
    for (const [cat, monto] of [...porCategoria.entries()].sort((a, b) => b[1] - a[1])) {
      msg += `• ${escapeMarkdown(cat.replace(/_/g, ' '))}: ${formatMonto(monto, 'Pesos')}\n`;
    }
  }

  return ctx.reply(msg, { parse_mode: 'Markdown' });
}

bot.command('viaje', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.trim().split(/\s+/).slice(1);

  try {
    if (args.length === 0) {
      return mostrarViajeActivo(ctx, userId);
    }

    const sub = args[0].toLowerCase();

    if (sub === 'ayuda' || sub === 'help') {
      return ctx.reply(USO, { parse_mode: 'Markdown' });
    }

    if (sub === 'cerrar' || sub === 'fin') {
      const cerrado = await personalService.cerrarViaje(userId);
      if (!cerrado) return ctx.reply('✈️ No hay ningún viaje activo para cerrar.');
      return ctx.reply(
        `✅ Viaje *${escapeMarkdown(cerrado.nombre)}* cerrado.\n\n` +
        'Los gastos nuevos ya no se le atribuyen.',
        { parse_mode: 'Markdown' }
      );
    }

    if (sub === 'nuevo' || sub === 'new') {
      const activo = await personalService.obtenerViajeActivo(userId);
      if (activo) {
        return ctx.reply(
          `⚠️ Ya tenés el viaje *${escapeMarkdown(activo.nombre)}* activo.\n\n` +
          'Cerralo primero con `/viaje cerrar`.',
          { parse_mode: 'Markdown' }
        );
      }

      // Las fechas van al final; lo del medio es el nombre.
      const resto = args.slice(1);
      const fechas = [];
      while (resto.length > 0 && parsearFecha(resto[resto.length - 1]) && fechas.length < 2) {
        fechas.unshift(parsearFecha(resto.pop()));
      }
      const nombre = resto.join(' ').trim();

      if (!nombre) {
        return ctx.reply('⚠️ Falta el nombre del viaje.\n\n' + USO, { parse_mode: 'Markdown' });
      }
      if (fechas.length === 0) {
        return ctx.reply(
          '⚠️ Falta al menos la fecha de inicio.\n\n' +
          'Ejemplo: `/viaje nuevo Brasil 10/01 20/01`',
          { parse_mode: 'Markdown' }
        );
      }

      const viaje = await personalService.crearViaje(userId, {
        nombre,
        fechaInicio: fechas[0],
        fechaFin: fechas[1] || '',
      });

      return ctx.reply(
        `✅ *Viaje abierto: ${escapeMarkdown(viaje.nombre)}*\n\n` +
        `📅 ${viaje.fechaInicio}${viaje.fechaFin ? ` a ${viaje.fechaFin}` : ' (sin cierre)'}\n\n` +
        'Los gastos personales de esas fechas se le atribuyen solos.\n' +
        '_La luz, el alquiler y las expensas quedan afuera — no son del viaje._',
        { parse_mode: 'Markdown' }
      );
    }

    return ctx.reply(USO, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error en /viaje:', error.message);
    return ctx.reply('❌ No pude procesar el comando de viaje. Intentá de nuevo.');
  }
});

module.exports = { parsearFecha };
