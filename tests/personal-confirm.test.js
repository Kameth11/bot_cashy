const {
  crearMensajeConfirmacion,
  confirmationButtons,
  esAmbitoPersonal,
} = require('../src/handlers/nlp-confirm');
const { parsearFecha } = require('../src/handlers/commands/viaje');

function textosDeBotones(markup) {
  return markup.reply_markup.inline_keyboard.flat().map(b => b.text);
}

function callbacksDeBotones(markup) {
  return markup.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
}

describe('esAmbitoPersonal', () => {
  test('reconoce el ámbito personal', () => {
    expect(esAmbitoPersonal({ ambito: 'personal' })).toBe(true);
    expect(esAmbitoPersonal({ ambito: 'Personal' })).toBe(true);
  });

  test('todo lo demás es consultorio', () => {
    expect(esAmbitoPersonal({ ambito: 'consultorio' })).toBe(false);
    expect(esAmbitoPersonal({})).toBe(false);
    expect(esAmbitoPersonal(null)).toBe(false);
  });
});

describe('crearMensajeConfirmacion — ámbito personal', () => {
  const base = {
    ambito: 'personal',
    tipo: 'gasto',
    descripcion: 'Nafta',
    monto: 20000,
    moneda: 'Pesos',
    categoria: 'transporte',
    metodo_pago: 'tarjeta',
  };

  test('muestra el ámbito y la categoría, no paciente ni tratamiento', () => {
    const msg = crearMensajeConfirmacion(base);
    expect(msg).toContain('🏠 Personal');
    expect(msg).toContain('transporte');
    expect(msg).not.toContain('Paciente');
    expect(msg).not.toContain('Tratamiento');
  });

  test('muestra el viaje cuando el gasto se le atribuye', () => {
    const msg = crearMensajeConfirmacion({ ...base, viajeNombre: 'Brasil' });
    expect(msg).toContain('✈️ Brasil');
  });

  test('no muestra línea de viaje si no hay viaje', () => {
    expect(crearMensajeConfirmacion(base)).not.toContain('Viaje:');
  });

  test('reemplaza el guion bajo de la categoría por espacio', () => {
    const msg = crearMensajeConfirmacion({ ...base, categoria: 'comida_afuera' });
    expect(msg).toContain('comida afuera');
  });
});

describe('crearMensajeConfirmacion — ámbito consultorio', () => {
  const base = {
    ambito: 'consultorio',
    tipo: 'ingreso',
    descripcion: 'Juan',
    monto: 15000,
    moneda: 'Pesos',
    pacienteNombre: 'Juan',
    tratamientoNombre: 'Consulta',
    estado: 'Cobrado',
  };

  test('mantiene los campos clínicos', () => {
    const msg = crearMensajeConfirmacion(base);
    expect(msg).toContain('🏥 Consultorio');
    expect(msg).toContain('Paciente');
    expect(msg).toContain('Tratamiento');
  });

  test('avisa cuando el ámbito se asumió por ser ambiguo', () => {
    const msg = crearMensajeConfirmacion({ ...base, tipo: 'gasto', ambiguoAmbito: true });
    expect(msg).toContain('Asumí que es del consultorio');
  });

  test('no avisa nada cuando el ámbito es inequívoco', () => {
    expect(crearMensajeConfirmacion(base)).not.toContain('Asumí');
  });
});

describe('confirmationButtons', () => {
  test('en consultorio ofrece pasar a personal', () => {
    const botones = textosDeBotones(confirmationButtons({ ambito: 'consultorio' }));
    expect(botones).toContain('🏠 Es personal');
    expect(botones).not.toContain('🏥 Es del consultorio');
  });

  test('en personal ofrece volver al consultorio', () => {
    const botones = textosDeBotones(confirmationButtons({ ambito: 'personal' }));
    expect(botones).toContain('🏥 Es del consultorio');
  });

  test('incluye siempre el callback del toggle de ámbito', () => {
    expect(callbacksDeBotones(confirmationButtons({}))).toContain('nlp_toggle_ambito');
  });

  test('ofrece desatribuir del viaje solo si el gasto está atribuido', () => {
    const conViaje = confirmationButtons({ ambito: 'personal', viajeId: 'viaje_1' });
    expect(callbacksDeBotones(conViaje)).toContain('nlp_quitar_viaje');

    const sinViaje = confirmationButtons({ ambito: 'personal' });
    expect(callbacksDeBotones(sinViaje)).not.toContain('nlp_quitar_viaje');
  });

  test('no ofrece desatribuir en el ámbito consultorio', () => {
    const markup = confirmationButtons({ ambito: 'consultorio', viajeId: 'viaje_1' });
    expect(callbacksDeBotones(markup)).not.toContain('nlp_quitar_viaje');
  });

  test('conserva guardar, cancelar y editar', () => {
    const cbs = callbacksDeBotones(confirmationButtons({}));
    expect(cbs).toContain('nlp_save');
    expect(cbs).toContain('nlp_cancel');
    expect(cbs).toContain('nlp_edit');
  });
});

describe('parsearFecha (/viaje)', () => {
  test('acepta DD/MM y completa el año actual', () => {
    const anio = new Date().getFullYear();
    expect(parsearFecha('10/01')).toBe(`10/01/${anio}`);
  });

  test('acepta DD/MM/YYYY y DD/MM/YY', () => {
    expect(parsearFecha('10/01/2026')).toBe('10/01/2026');
    expect(parsearFecha('10/01/26')).toBe('10/01/2026');
  });

  test('rellena con cero a la izquierda', () => {
    expect(parsearFecha('5/3/2026')).toBe('05/03/2026');
  });

  test('rechaza fechas imposibles y basura', () => {
    expect(parsearFecha('32/01/2026')).toBeNull();
    expect(parsearFecha('10/13/2026')).toBeNull();
    expect(parsearFecha('Brasil')).toBeNull();
    expect(parsearFecha('')).toBeNull();
  });
});
