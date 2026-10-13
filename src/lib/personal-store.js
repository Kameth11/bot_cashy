// Dónde vive el ámbito personal y quién puede usarlo.
//
//   PERSONAL_STORE=supabase (producción) Tablas por persona (user_id): cada usuario
//                           registrado tiene el suyo, privado. Requiere USE_SUPABASE=true.
//   PERSONAL_STORE=sheets   Modo anterior (es lo que toma config si la variable falta):
//                           pestañas del sheet del DUEÑO. Un agregado comparte ese sheet,
//                           así que Personal es solo del dueño/admin.
//
// Se lee la config en cada llamada (no al cargar el módulo) para que los tests puedan
// cambiarla.

const config = require('../config');

function personalEnSupabase() {
  return config.PERSONAL_STORE === 'supabase' && Boolean(config.USE_SUPABASE);
}

module.exports = { personalEnSupabase };
