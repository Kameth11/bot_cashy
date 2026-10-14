const { bot } = require('../../lib/telegraf');
const { esAdminOriginal } = require('../../auth');
const { USE_SUPABASE } = require('../../config');
const reconciliacion = require('../../services/reconciliacion.service');
const fallos = require('../../services/dual-write-fallos.service');
const textos = require('../../messages');

const fmt = n => `$${Number(n).toLocaleString('es-AR')}`;
const lista = (ids, max = 5) => ids.slice(0, max).join(', ') + (ids.length > max ? ` … (+${ids.length - max})` : '');

function formatear(r) {
  if (r.error) return `👤 ${r.userId}: ⚠️ ${r.error}`;
  if (r.coincide) return `👤 ${r.userId}: ✅ coincide (${r.totalSheet} movimientos en Sheets y ${r.totalSupabase} en Supabase)`;
  const l = [`👤 ${r.userId}: ❌ hay diferencias (Sheets ${r.totalSheet}, Supabase ${r.totalSupabase})`];
  if (r.soloSheet.length) l.push(`  • Solo en Sheets (${r.soloSheet.length}): ${lista(r.soloSheet)}`);
  if (r.soloSupabase.length) l.push(`  • Solo en Supabase (${r.soloSupabase.length}): ${lista(r.soloSupabase)}`);
  for (const m of r.montoDistinto.slice(0, 5)) l.push(`  • ${m.id}: Sheets ${fmt(m.sheet)} vs Supabase ${fmt(m.supabase)}`);
  if (r.montoDistinto.length > 5) l.push(`  • … (+${r.montoDistinto.length - 5} con monto distinto)`);
  for (const m of r.mesesConDiferencia.slice(0, 6)) {
    l.push(`  • ${m.mes}: Sheets ${m.sheet.cantidad} (ing ${fmt(m.sheet.ingresos)} / egr ${fmt(m.sheet.egresos)}) vs Supabase ${m.supabase.cantidad} (ing ${fmt(m.supabase.ingresos)} / egr ${fmt(m.supabase.egresos)})`);
  }
  if (r.sheetSinId || r.supabaseSinId) l.push(`  • Sin ID_Unico: Sheets ${r.sheetSinId}, Supabase ${r.supabaseSinId} (no se pueden cruzar)`);
  return l.join('\n');
}

bot.command('reconciliar', async (ctx) => {
  if (!esAdminOriginal(ctx.from.id)) return ctx.reply(textos.comandos.reconciliar.soloElAdministradorPuedeUsar);
  if (!USE_SUPABASE) return ctx.reply(textos.comandos.reconciliar.supabaseNoEstaActivoNo);

  try {
    await ctx.reply(textos.comandos.reconciliar.comparandoGoogleSheetsConSupabase);
    const partes = [];
    for (const ownerId of reconciliacion.listarDuenos()) {
      try {
        partes.push(formatear(await reconciliacion.reconciliarUsuario(ownerId)));
      } catch (err) {
        partes.push(`👤 ${ownerId}: ⚠️ no se pudo comparar (${err.message})`);
      }
    }
    const f = fallos.resumen();
    partes.push(`\n🧾 Escrituras que fallaron desde el último arranque: ${f.totalDesdeArranque} (última hora: ${f.ultimaHora})`);
    for (const x of f.ultimos) partes.push(`  • ${new Date(x.ts).toLocaleString('es-AR')} ${x.tipo} (${x.userId ?? '-'}): ${x.mensaje}`);

    const texto = partes.join('\n');
    for (let i = 0; i < texto.length; i += 3800) await ctx.reply(texto.slice(i, i + 3800));
  } catch (err) {
    console.error('Error /reconciliar:', err.message);
    ctx.reply('❌ No se pudo reconciliar: ' + err.message);
  }
});
