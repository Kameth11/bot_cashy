#!/usr/bin/env node

/**
 * Script de migración: Google Sheets → Supabase
 * 
 * Uso:
 *   node scripts/migrate-sheet.js
 * 
 * Requisitos:
 *   - SUPABASE_URL y SUPABASE_ANON_KEY en .env
 *   - USE_SUPABASE=false (correr con Sheets como fuente)
 *   - El Google Sheet debe estar accesible
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { legacyDateToIso, getTipoMovimientoFromLegacy, normalizeMetodoPago } = require('../src/utils/movimiento-v2');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Error: SUPABASE_URL y SUPABASE_ANON_KEY deben estar en .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Importar el servicio de sheets existente
const { obtenerDatosSheet, getSheetId } = require('../src/services/sheet.service');
const { obtenerClientePorUserId } = require('../src/auth');
const clienteService = require('../src/services/cliente.service');

async function migrateUsers() {
  console.log('\n📋 Migrando perfiles de usuario...');
  const clientes = clienteService.clientes;
  let migrated = 0;
  let errors = 0;

  for (const [userId, data] of Object.entries(clientes)) {
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: parseInt(userId),
          email: data.email || null,
          display_name: data.email ? data.email.split('@')[0] : null,
          sheet_id: data.sheetId || null,
          plan: 'free',
          usuarios: data.usuarios || [],
        });

      if (error) {
        console.error(`  ❌ Usuario ${userId}: ${error.message}`);
        errors++;
      } else {
        console.log(`  ✅ Usuario ${userId} (${data.email || 'sin email'})`);
        migrated++;
      }
    } catch (e) {
      console.error(`  ❌ Usuario ${userId}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n  migrados: ${migrated}, errores: ${errors}`);
  return { migrated, errors };
}

async function migrateMovimientos() {
  console.log('\n📋 Migrando movimientos...');
  const clientes = clienteService.clientes;
  let totalMigrated = 0;
  let totalErrors = 0;

  for (const [userId, data] of Object.entries(clientes)) {
    console.log(`\n  Procesando usuario ${userId} (${data.email || 'sin email'})...`);

    try {
      const datos = await obtenerDatosSheet(parseInt(userId));

      if (!datos || datos.length === 0) {
        console.log(`  ⏭️ Sin movimientos para usuario ${userId}`);
        continue;
      }

      console.log(`  📊 Encontrados ${datos.length} movimientos`);

      // Migrar en lotes de 50
      const batchSize = 50;
      for (let i = 0; i < datos.length; i += batchSize) {
        const batch = datos.slice(i, i + batchSize);

        const rows = batch.map(d => ({
          user_id: parseInt(userId),
          fecha: legacyDateToIso(d.fecha) || d.fecha || new Date().toISOString().slice(0, 10),
          hora: d.hora || '',
          descripcion: d.descripcion || '',
          monto: parseFloat(d.monto) || 0,
          estado: d.estado || 'Cobrado',
          tipo: getTipoMovimientoFromLegacy(d.tipo || 'Ingreso'),
          categoria: d.categoria || null,
          moneda: d.moneda || 'Pesos',
          metodo_pago: d.metodoPago || '',
          medio_pago: normalizeMetodoPago(d.metodoPago || '') || null,
          id_unico: d.idUnico || '',
          monto_pesos: parseFloat(d.montoPesos) || parseFloat(d.monto) || 0,
          id_origen: '',
        }));

        const { error } = await supabase
          .from('movimientos')
          .insert(rows);

        if (error) {
          console.error(`  ❌ Error en lote ${i}-${i + batch.length}: ${error.message}`);
          totalErrors += batch.length;
        } else {
          totalMigrated += batch.length;
          console.log(`  ✅ Lote ${i + 1}-${Math.min(i + batchSize, datos.length)} insertado`);
        }
      }

    } catch (e) {
      console.error(`  ❌ Error procesando usuario ${userId}: ${e.message}`);
      totalErrors++;
    }
  }

  console.log(`\n  Total migrados: ${totalMigrated}, Total errores: ${totalErrors}`);
  return { totalMigrated, totalErrors };
}

async function verifyMigration() {
  console.log('\n📋 Verificando migración...');
  const clientes = clienteService.clientes;

  for (const [userId] of Object.entries(clientes)) {
    const { data, error } = await supabase
      .from('movimientos')
      .select('id', { count: 'exact', head: false })
      .eq('user_id', parseInt(userId));

    if (error) {
      console.error(`  ❌ Error verificando usuario ${userId}: ${error.message}`);
      continue;
    }

    const originalData = await obtenerDatosSheet(parseInt(userId));
    const originalCount = originalData ? originalData.length : 0;
    const migratedCount = data ? data.length : 0;

    if (originalCount === migratedCount) {
      console.log(`  ✅ Usuario ${userId}: ${migratedCount} movimientos (coincide)`);
    } else {
      console.warn(`  ⚠️ Usuario ${userId}: original=${originalCount}, migrado=${migratedCount}`);
    }
  }
}

async function main() {
  console.log('🚀 Migración Google Sheets → Supabase');
  console.log('========================================\n');

  // Verify connection
  const { data, error } = await supabase.from('profiles').select('id').limit(1);
  if (error) {
    console.error('❌ No se pudo conectar a Supabase:', error.message);
    console.error('\nAsegurate de:');
    console.error('  1. Haber ejecutado sql/schema.sql en Supabase SQL Editor');
    console.error('  2. Haber configurado SUPABASE_URL y SUPABASE_ANON_KEY en .env');
    process.exit(1);
  }

  console.log('✅ Conexión a Supabase OK\n');

  // Step 1: Migrate users
  const userResult = await migrateUsers();

  // Step 2: Migrate movimientos
  const movResult = await migrateMovimientos();

  // Step 3: Verify
  await verifyMigration();

  console.log('\n========================================');
  console.log('🎉 Migración completada!');
  console.log(`  Usuarios: ${userResult.migrated} migrados, ${userResult.errors} errores`);
  console.log(`  Movimientos: ${movResult.totalMigrated} migrados, ${movResult.totalErrors} errores`);
  console.log('\n  Siguiente paso:');
  console.log('  1. Verificar que los datos coincidan');
  console.log('  2. Cambiar USE_SUPABASE=true en .env');
  console.log('  3. Reiniciar el bot');
}

main().catch(console.error);
