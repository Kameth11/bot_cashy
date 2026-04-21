const { fetchCotizacionBluelytics } = require('../lib/bluelytics');
const state = require('../state');

async function obtenerCotizacionDolar() {
  try {
    console.log('Obteniendo cotizacion de Bluelytics...');
    const value = await fetchCotizacionBluelytics();
    state.cotizacionDolar = value;
    state.cotizacionFecha = new Date();
    console.log(`Cotizacion dolar (Bluelytics): $${state.cotizacionDolar} - Fecha: ${state.cotizacionFecha}`);
    return state.cotizacionDolar;
  } catch (error) {
    console.error('Error al obtener cotizacion Bluelytics:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    return null;
  }
}

module.exports = { obtenerCotizacionDolar };
