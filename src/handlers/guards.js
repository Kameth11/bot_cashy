const state = require('../state');

function tieneProcesoPendiente(userId) {
  return state.pendingAgendaConfirm.has(userId) ||
    state.pendingRegistros.has(userId) ||
    state.pendingDeletes.has(userId) ||
    state.pendingEdits.has(userId) ||
    state.pendingCotizaciones.has(userId) ||
    state.pendingPayments.has(userId) ||
    state.pendingLimpiezas.has(userId) ||
    state.pendingReinicios.has(userId) ||
    state.pendingDescripcion.has(userId) ||
    state.pendingIngresoPacientes.has(userId);
}

module.exports = { tieneProcesoPendiente };
