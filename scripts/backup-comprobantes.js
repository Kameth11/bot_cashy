#!/usr/bin/env node
// Copia el bucket privado `comprobantes` de Supabase Storage a una carpeta local.
// Uso: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backup-comprobantes.js <carpeta-destino>
// Es incremental por tamaño: si el archivo ya existe con el mismo tamaño, lo saltea.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'comprobantes';

async function listar(storage, prefijo = '') {
  const archivos = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await storage.from(BUCKET).list(prefijo, { limit: 100, offset });
    if (error) throw new Error(`list(${prefijo || '/'}): ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      const ruta = prefijo ? `${prefijo}/${item.name}` : item.name;
      if (item.id === null) archivos.push(...await listar(storage, ruta)); // carpeta
      else archivos.push({ ruta, size: item.metadata?.size });
    }
    if (data.length < 100) break;
  }
  return archivos;
}

async function main() {
  const destino = process.argv[2];
  const url = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!destino || !url || !key) {
    console.error('Uso: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backup-comprobantes.js <carpeta>');
    process.exit(2);
  }
  const storage = createClient(url, key).storage;
  const archivos = await listar(storage);
  let copiados = 0;
  for (const { ruta, size } of archivos) {
    const local = path.join(destino, ruta);
    if (size != null && fs.existsSync(local) && fs.statSync(local).size === size) continue;
    const { data, error } = await storage.from(BUCKET).download(ruta);
    if (error) throw new Error(`download(${ruta}): ${error.message}`);
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, Buffer.from(await data.arrayBuffer()));
    copiados++;
  }
  console.log(`Comprobantes: ${archivos.length} en el bucket, ${copiados} copiados.`);
}

main().catch(err => { console.error('Falló el respaldo de comprobantes:', err.message); process.exit(1); });
