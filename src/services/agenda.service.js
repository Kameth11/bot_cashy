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

  if (!Array.isArray(turnos) || turnos.length === 0) {
    throw new Error('No hay turnos para guardar');
  }

  const now = new Date();
  const fechaStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;

  let guardados = 0;
  let errores = 0;
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
      errores++;
      console.error('Error al guardar turno:', rowError.message);
    }
  }

  if (guardados === 0) {
    throw new Error('No se pudo guardar ningun turno en Agenda');
  }

  invalidateCache(userId);
  return { guardados, errores, total: turnos.length, fechaStr };
}

module.exports = {
  crearTabAgendaSiNoExiste,
  guardarTurnosAgenda,
};
