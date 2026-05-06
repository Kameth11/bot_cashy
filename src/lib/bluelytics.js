const axios = require('axios');

async function fetchCotizacionBluelytics() {
  const response = await axios.get('https://api.bluelytics.com.ar/v2/latest', {
    timeout: 10000,
  });

  const value = response?.data?.blue?.value_avg;
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error('Respuesta invalida de Bluelytics');
  }

  return value;
}

module.exports = { fetchCotizacionBluelytics };
