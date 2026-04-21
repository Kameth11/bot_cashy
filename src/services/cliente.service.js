const fs = require('fs');
const { CLIENTES_FILE } = require('../config');

function cargarClientes() {
  try {
    if (fs.existsSync(CLIENTES_FILE)) {
      const data = fs.readFileSync(CLIENTES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error al cargar clientes:', error.message);
  }
  return {};
}

function guardarClientes(clientesObj) {
  try {
    fs.writeFileSync(CLIENTES_FILE, JSON.stringify(clientesObj, null, 2));
  } catch (error) {
    console.error('Error al guardar clientes:', error.message);
  }
}

let clientes = cargarClientes();
console.log('Clientes cargados:', Object.keys(clientes).length);

module.exports = {
  get clientes() { return clientes; },
  set clientes(val) { clientes = val; },
  cargarClientes,
  guardarClientes,
};
