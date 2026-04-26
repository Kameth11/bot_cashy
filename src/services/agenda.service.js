const { getDocCliente, invalidateCache } = require('./sheet.service');

async function crearTabAgendaSiNoExiste(userId) {
  const docCliente = await getDocCliente(userId, true);
  if (!docCliente) return null;

  try {
    let agendaSheet = docCliente.sheetsByTitle['Agenda'];
    if (!agendaSheet) {
      agendaSheet = await docCliente.addSheet({
        title: 'Agenda',
        headerValues: ['Fecha', 'Hora', 'Cliente', 'Servicio', 'Estado']
      });
      console.log('Tab Agenda creado');
    }
    return agendaSheet;
  } catch (error) {
    console.error('Error al crear tab Agenda:', error.message);
    return null;
  }
}

async function guardarTurnosAgenda(userId, turnos) {
  const agendaSheet = await crearTabAgendaSiNoExiste(userId);
  if (!agendaSheet) {
    throw new Error('No se pudo acceder a la tab Agenda');
  }

  const now = new Date();
  const fechaStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;

  let guardados = 0;
  for (const turno of turnos) {
    try {
      await agendaSheet.addRow({
        Fecha: fechaStr,
        Hora: turno.hora || '',
        Cliente: turno.cliente || '',
        Servicio: turno.servicio || '',
        Estado: turno.estado || 'Pendiente'
      }, { insert: true });
      guardados++;
    } catch (rowError) {
      console.error('Error al guardar turno:', rowError.message);
    }
  }

  invalidateCache(userId);
  return { guardados, fechaStr };
}

module.exports = {
  crearTabAgendaSiNoExiste,
  guardarTurnosAgenda,
};
