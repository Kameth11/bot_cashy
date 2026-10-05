#!/usr/bin/env node
// Importa el Personal que hoy vive en el Google Sheet (pestañas Personal, Viajes,
// Presupuestos y Preferencias) a las tablas por persona de Supabase.
//
//   node scripts/importar-personal-a-supabase.js                  # SIMULACRO: no escribe nada
//   node scripts/importar-personal-a-supabase.js --aplicar        # escribe en Supabase
//   node scripts/importar-personal-a-supabase.js --user 123456    # solo esa persona
//
// Es IDEMPOTENTE: se puede correr varias veces, no duplica. Requisitos: migraciones 008
// y 013 aplicadas, y las variables de entorno de siempre (.env: Sheets y Supabase).
//
// Lee SIEMPRE del Sheet, aunque PERSONAL_STORE ya esté en 'supabase' (por eso lo fuerza
// antes de cargar nada). La lógica de mapeo está en src/services/personal-importacion.js.

process.env.PERSONAL_STORE = 'sheets';

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const idxUser = args.indexOf('--user');
const soloUsuario = idxUser >= 0 ? String(args[idxUser + 1] || '').trim() : null;

async function main() {
  const clienteService = require('../src/services/cliente.service');
  const config = require('../src/config');
  const { importarPersona, contar } = require('../src/services/personal-importacion');
  const repo = require('../src/services/personal-repo.supabase');
  const personal = require('../src/services/personal.service');
  const { getDocCliente } = require('../src/services/sheet.service');

  if (!config.USE_SUPABASE) {
    console.error('USE_SUPABASE no está en true: no hay a dónde importar.');
    process.exit(1);
  }

  await clienteService.listo;

  // Personas con Personal en el Sheet: las cuentas con registro propio (dueños) y el admin.
  const ids = new Set(Object.keys(clienteService.clientes));
  if (config.AUTHORIZED_USER_ID) ids.add(String(config.AUTHORIZED_USER_ID));
  const personas = soloUsuario ? [soloUsuario] : [...ids];

  console.log(aplicar ? '=== IMPORTACIÓN (escribe en Supabase) ===' : '=== SIMULACRO (no escribe nada) ===');
  console.log(`Personas a revisar: ${personas.length}\n`);

  let errores = 0;
  for (const userId of personas) {
    try {
      const datos = await leerDelSheet(userId, { personal, getDocCliente });
      const total = datos.movimientos.length + datos.viajes.length + datos.presupuestos.length + Object.keys(datos.preferencias).length;
      if (total === 0) { console.log(`- ${userId}: sin Personal en el Sheet`); continue; }

      const r = await importarPersona({ userId, datos, repo, aplicar });
      imprimir(r, contar);
    } catch (err) {
      errores++;
      console.error(`- ${userId}: ERROR ${err.message}`);
    }
  }

  console.log(aplicar
    ? '\nListo. Verificá en Supabase (movimientos_personales) antes de activar PERSONAL_STORE=supabase.'
    : '\nSimulacro terminado: no se escribió nada. Si el informe te cierra, corré de nuevo con --aplicar.');
  process.exit(errores > 0 ? 1 : 0);
}

// Lectura de solo lectura: no crea pestañas en el Sheet de nadie.
async function leerDelSheet(userId, { personal, getDocCliente }) {
  const [movimientos, presupuestos, preferencias] = await Promise.all([
    personal.obtenerMovimientosPersonales(userId),
    personal.obtenerPresupuestos(userId),
    personal.leerPreferencias(userId),
  ]);

  let viajes = [];
  const doc = await getDocCliente(userId);
  const hoja = doc && doc.sheetsByTitle && doc.sheetsByTitle[personal.TAB_VIAJES];
  if (hoja) {
    const filas = await hoja.getRows();
    viajes = filas.map(r => ({
      idViaje: r.get('ID_Viaje') || null,
      nombre: r.get('Nombre'),
      fechaInicio: r.get('FechaInicio'),
      fechaFin: r.get('FechaFin'),
      estado: r.get('Estado'),
      presupuesto: r.get('Presupuesto'),
      moneda: r.get('Moneda'),
    }));
  }
  return { movimientos, viajes, presupuestos, preferencias };
}

function imprimir(r, contar) {
  const m = r.movimientos;
  console.log(`- ${r.userId}`);
  console.log(`    movimientos : ${m.leidos} leídos · ${m.aImportar} a importar · ${m.yaExistentes} ya estaban · ${m.descartados.length} descartados${r.aplicado ? ` · ${m.importados} importados` : ''}`);
  if (m.descartados.length) console.log(`                  descartados por motivo: ${JSON.stringify(contar(m.descartados))}`);
  if (m.avisos.length) console.log(`                  categorías ajustadas a "otros": ${m.avisos.length}`);
  console.log(`    viajes      : ${r.viajes.leidos} leídos · ${r.viajes.aImportar} a importar · ${r.viajes.yaExistentes} ya estaban${r.aplicado ? ` · ${r.viajes.importados} importados` : ''}`);
  console.log(`    presupuestos: ${r.presupuestos.leidos} leídos · ${r.presupuestos.aImportar} a importar${r.aplicado ? ` · ${r.presupuestos.importados} importados` : ''}`);
  console.log(`    preferencias: ${r.preferencias.leidas} leídas · ${r.preferencias.aImportar} a importar${r.aplicado ? ` · ${r.preferencias.importadas} importadas` : ''}`);
}

if (require.main === module) {
  main().catch(err => { console.error('Error:', err.message); process.exit(1); });
}
