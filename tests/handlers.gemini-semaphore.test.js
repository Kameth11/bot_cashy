// Guarda de escalabilidad (nivel fuente): los handlers de foto y voz deben
// envolver la llamada a Gemini con el semáforo compartido. Invocar los
// handlers reales necesitaría un ctx de Telegram completo; este guard explícito
// evita que alguien borre el semáforo en silencio y vuelva a disparar N
// llamadas simultáneas a Gemini (memoria + CPU + rate limit del proveedor).

const fs = require('fs');
const path = require('path');

function leer(rel) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', rel), 'utf8');
}

describe('semáforo de Gemini en handlers de media', () => {
  test('photo.js envuelve procesarFotoAgenda con geminiMediaSemaphore.run', () => {
    const src = leer('photo.js');
    expect(src).toMatch(/geminiMediaSemaphore/);
    expect(src).toMatch(/geminiMediaSemaphore\.run\(\s*\(\)\s*=>\s*procesarFotoAgenda/);
  });

  test('voice.js envuelve la transcripción con geminiMediaSemaphore.run', () => {
    const src = leer('voice.js');
    expect(src).toMatch(/geminiMediaSemaphore/);
    expect(src).toMatch(/geminiMediaSemaphore\.run\(\s*\(\)\s*=>\s*geminiService\.transcribirAudio/);
  });

  test('el semáforo compartido limita a 3 en vuelo', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'semaphore.js'), 'utf8');
    expect(src).toMatch(/geminiMediaSemaphore\s*=\s*createSemaphore\(\s*3\s*,/);
  });
});
