const axios = require('axios');
const { fetchCotizacionBluelytics } = require('../lib/bluelytics');
const state = require('../state');

async function fetchCotizacionEuro() {
  const response = await axios.get('https://dolarapi.com/v1/cotizaciones', { timeout: 10000 });
  const eur = response?.data?.find(c => c.moneda === 'EUR');
  const { compra, venta } = eur || {};
  if (typeof compra !== 'number' || typeof venta !== 'number') {
    throw new Error('Respuesta invalida de dolarapi (euro)');
  }
  return Math.round(((compra + venta) / 2) * 100) / 100;
}

async function obtenerCotizacionDolar() {
  try {
    const dolar = await fetchCotizacionBluelytics();
    state.cotizacionDolar = dolar;
    state.cotizacionFecha = new Date();
    console.log(`Cotizacion dolar blue: $${dolar}`);
  } catch (err) {
    console.error('Error al obtener cotizacion dolar:', err.message);
  }

  try {
    const euro = await fetchCotizacionEuro();
    state.cotizacionEuro = euro;
    console.log(`Cotizacion euro blue: $${euro}`);
  } catch (err) {
    console.error('Error al obtener cotizacion euro:', err.message);
  }

  return state.cotizacionDolar;
}

module.exports = { obtenerCotizacionDolar };
