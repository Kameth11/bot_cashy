const { bot } = require('../../lib/telegraf');
const personalService = require('../../services/personal.service');
const { formatMonto } = require('../../utils/formatter');
const { escapeMarkdown } = require('../../utils/formatter');

function mesActualIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function esEgreso(tipo) {
  return ['gasto', 'egreso'].includes(String(tipo || '').toLowerCase());
}

// Barra de progreso en texto, para el estado de los presupuestos.
function barra(porcentaje) {
  const llenos = Math.min(Math.round(porcentaje / 10), 10);
  return '█'.repeat(llenos) + '░'.repeat(10 - llenos);
}

async function construirResumenPersonal(userId) {
  const movimientos = await personalService.obtenerMovimientosPersonales(userId);
  const mes = mesActualIso();

  const delMes = movimientos.filter(m => {
    const iso = personalService.fechaStrAIso(m.fecha);
    return iso && iso.startsWith(mes);
  });

  if (delMes.length === 0) {
    return (
      '🏠 *Finanzas personales*\n\n' +
      'Todavía no hay movimientos personales este mes.\n\n' +
      'Probá escribiendo:\n' +
      '`nafta 20000`\n' +
      '`super 45000`\n' +
      '`netflix 5000`'
    );
  }

  let ingresos = 0;
  let egresos = 0;
  const porCategoria = new Map();

  for (const m of delMes) {
    const monto = Math.abs(Number(m.montoPesos) || Number(m.monto) || 0);
    if (esEgreso(m.tipo)) {
      egresos += monto;
      const cat = m.categoria || 'otros';
      porCategoria.set(cat, (porCategoria.get(cat) || 0) + monto);
    } else {
      ingresos += monto;
    }
  }

  const balance = ingresos - egresos;
  const ordenadas = [...porCategoria.entries()].sort((a, b) => b[1] - a[1]);

  let msg = '🏠 *Finanzas personales — este mes*\n\n';
  msg += `💚 Ingresos: ${formatMonto(ingresos, 'Pesos')}\n`;
  msg += `🔴 Gastos: ${formatMonto(egresos, 'Pesos')}\n`;
  msg += `${balance >= 0 ? '✅' : '⚠️'} Balance: ${formatMonto(balance, 'Pesos')}\n\n`;

  msg += '*Gastos por categoría:*\n';
  for (const [cat, total] of ordenadas) {
    const pct = egresos > 0 ? Math.round((total / egresos) * 100) : 0;
    msg += `• ${escapeMarkdown(cat.replace(/_/g, ' '))}: ${formatMonto(total, 'Pesos')} (${pct}%)\n`;
  }

  // Estado de los presupuestos definidos, si hay alguno.
  const presupuestos = await personalService.obtenerPresupuestos(userId);
  if (presupuestos.length > 0) {
    const lineas = [];
    for (const p of presupuestos) {
      const estado = await personalService.evaluarPresupuesto(userId, p.categoria);
      if (!estado) continue;
      const icono = estado.excedido ? '🔴' : estado.enAlerta ? '⚠️' : '✅';
      lineas.push(
        `${icono} ${escapeMarkdown(p.categoria.replace(/_/g, ' '))}\n` +
        `   ${barra(estado.porcentaje)} ${estado.porcentaje}% ` +
        `(${formatMonto(estado.gastado, estado.moneda)} de ${formatMonto(estado.limite, estado.moneda)})`
      );
    }
    if (lineas.length > 0) {
      msg += `\n*Presupuestos:*\n${lineas.join('\n')}\n`;
    }
  }

  // Viaje activo con su total acumulado.
  const viaje = await personalService.obtenerViajeActivo(userId);
  if (viaje) {
    const totalViaje = movimientos
      .filter(m => m.viajeId === viaje.idViaje && esEgreso(m.tipo))
      .reduce((acc, m) => acc + Math.abs(Number(m.montoPesos) || Number(m.monto) || 0), 0);

    msg += `\n✈️ *Viaje activo: ${escapeMarkdown(viaje.nombre)}*\n`;
    msg += `   Gastado: ${formatMonto(totalViaje, 'Pesos')}`;
    if (viaje.presupuesto) {
      const pct = Math.round((totalViaje / viaje.presupuesto) * 100);
      msg += ` de ${formatMonto(viaje.presupuesto, viaje.moneda)} (${pct}%)`;
    }
    msg += '\n';
  }

  return msg;
}

bot.command('personal', async (ctx) => {
  try {
    const msg = await construirResumenPersonal(ctx.from.id);
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error en /personal:', error.message);
    return ctx.reply('❌ No pude armar el resumen personal. Intentá de nuevo.');
  }
});

module.exports = { construirResumenPersonal };
