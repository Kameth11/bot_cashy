const { bot } = require('../../lib/telegraf');
const personalService = require('../../services/personal.service');
const { formatMonto, escapeMarkdown } = require('../../utils/formatter');

// Barra de progreso en texto, para el estado de los presupuestos.
function barra(porcentaje) {
  const llenos = Math.min(Math.round(porcentaje / 10), 10);
  return '█'.repeat(llenos) + '░'.repeat(10 - llenos);
}

function etiqueta(categoria) {
  return escapeMarkdown(String(categoria || '').replace(/_/g, ' '));
}

// Los números salen de calcularResumenPersonal, el mismo que usa el dashboard,
// para que bot y web no puedan mostrar totales distintos.
function construirMensajeResumen(resumen) {
  if (resumen.cantidad === 0) {
    return (
      '🏠 *Finanzas personales*\n\n' +
      'Todavía no hay movimientos personales este mes.\n\n' +
      'Probá escribiendo:\n' +
      '`nafta 20000`\n' +
      '`super 45000`\n' +
      '`netflix 5000`'
    );
  }

  let msg = '🏠 *Finanzas personales — este mes*\n\n';
  msg += `💚 Ingresos: ${formatMonto(resumen.ingresos, 'Pesos')}\n`;
  msg += `🔴 Gastos: ${formatMonto(resumen.egresos, 'Pesos')}\n`;
  msg += `${resumen.balance >= 0 ? '✅' : '⚠️'} Balance: ${formatMonto(resumen.balance, 'Pesos')}\n`;

  if (resumen.porCategoria.length > 0) {
    msg += '\n*Gastos por categoría:*\n';
    for (const c of resumen.porCategoria) {
      msg += `• ${etiqueta(c.categoria)}: ${formatMonto(c.total, 'Pesos')} (${c.porcentaje}%)\n`;
    }
  }

  if (resumen.presupuestos.length > 0) {
    msg += '\n*Presupuestos:*\n';
    for (const p of resumen.presupuestos) {
      const icono = p.excedido ? '🔴' : p.enAlerta ? '⚠️' : '✅';
      msg += `${icono} ${etiqueta(p.categoria)}\n`;
      msg += `   ${barra(p.porcentaje)} ${p.porcentaje}% `;
      msg += `(${formatMonto(p.gastado, p.moneda)} de ${formatMonto(p.limite, p.moneda)})\n`;
    }
  }

  if (resumen.viaje) {
    const v = resumen.viaje;
    msg += `\n✈️ *Viaje activo: ${escapeMarkdown(v.nombre)}*\n`;
    msg += `   Gastado: ${formatMonto(v.total, 'Pesos')}`;
    if (v.presupuesto) {
      const pct = Math.round((v.total / v.presupuesto) * 100);
      msg += ` de ${formatMonto(v.presupuesto, v.moneda)} (${pct}%)`;
    }
    msg += '\n';
  }

  return msg;
}

bot.command('personal', async (ctx) => {
  try {
    const resumen = await personalService.calcularResumenPersonal(ctx.from.id);
    return ctx.reply(construirMensajeResumen(resumen), { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error en /personal:', error.message);
    return ctx.reply('❌ No pude armar el resumen personal. Intentá de nuevo.');
  }
});

module.exports = { construirMensajeResumen, barra };
