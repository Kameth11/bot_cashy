// Permisos granulares por usuario dentro de un consultorio.
// Única fuente de verdad: todo el sistema referencia estas constantes.

const PERMISOS = [
  'ver_agenda',
  'editar_agenda',
  'ver_movimientos',
  'cargar_movimientos',
  'editar_movimientos',
  'ver_balance',
];

// Presets: plantillas rápidas para asignar en el dashboard o por comando.
// Solo son azúcar para la UI — internamente siempre se guarda el array de permisos.
const PRESETS = {
  odontologo: ['ver_agenda', 'editar_agenda'],
  recepcion:  ['ver_agenda', 'editar_agenda', 'ver_movimientos', 'cargar_movimientos', 'editar_movimientos', 'ver_balance'],
  contadora:  ['ver_movimientos', 'ver_balance'],
};

// Mínimo que recibe cualquier miembro sin permisos asignados explícitamente.
const DEFAULT_PERMISOS = ['ver_agenda'];

// El dueño siempre tiene todo, implícito (no se persiste).
const ADMIN_PERMISOS = [...PERMISOS];

// Infiere el nombre del preset a partir de un array de permisos (para mostrar en UI).
// Devuelve null si no matchea ningún preset exacto.
function detectarPreset(permisos) {
  const sorted = [...permisos].sort().join(',');
  for (const [nombre, perms] of Object.entries(PRESETS)) {
    if ([...perms].sort().join(',') === sorted) return nombre;
  }
  return null;
}

function puede(permisos, permiso) {
  return Array.isArray(permisos) && permisos.includes(permiso);
}

// Valida que todos los permisos del array sean conocidos.
function validarPermisos(permisos) {
  if (!Array.isArray(permisos)) return false;
  return permisos.every(p => PERMISOS.includes(p));
}

module.exports = { PERMISOS, PRESETS, DEFAULT_PERMISOS, ADMIN_PERMISOS, detectarPreset, puede, validarPermisos };
