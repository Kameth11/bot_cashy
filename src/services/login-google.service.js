// Verificación de "Entrar con Google" (Google Identity Services).
//
// El navegador manda el ID token (`credential`) que le dio Google. NUNCA se confía
// en lo que el navegador dice de sí mismo: el token se verifica acá, con la firma
// de Google y comprobando que fue emitido para NUESTRO Client ID.
//
// Del token solo se usa `sub` (identificador estable de la cuenta de Google). El
// email se muestra en el bot para que la persona confirme qué cuenta vincula, pero
// no sirve para reconocer a nadie: ver ARCHITECTURE.md "Login con Google".

const { OAuth2Client } = require('google-auth-library');

const MAX_CREDENCIAL = 4096;
let verificador = null; // inyectable en tests

function clientId() {
  return String(process.env.GOOGLE_CLIENT_ID || '').trim();
}

function configurado() {
  return Boolean(clientId());
}

/**
 * @returns {Promise<{sub:string, email:string, nombre:string}>}
 * @throws {Error} 'google_no_configurado' | 'google_credencial_invalida' | 'google_email_no_verificado'
 */
async function verificarCredencial(credential) {
  if (!configurado()) throw new Error('google_no_configurado');
  if (typeof credential !== 'string' || !credential || credential.length > MAX_CREDENCIAL) {
    throw new Error('google_credencial_invalida');
  }

  let payload;
  try {
    if (verificador) {
      payload = await verificador(credential, clientId());
    } else {
      const ticket = await new OAuth2Client(clientId()).verifyIdToken({ idToken: credential, audience: clientId() });
      payload = ticket.getPayload();
    }
  } catch {
    throw new Error('google_credencial_invalida');
  }

  if (!payload || !payload.sub) throw new Error('google_credencial_invalida');
  if (!payload.email || payload.email_verified !== true) throw new Error('google_email_no_verificado');

  return {
    sub: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    nombre: String(payload.name || '').slice(0, 80),
  };
}

// Solo para tests.
function _setVerificador(fn) { verificador = fn; }

module.exports = { clientId, configurado, verificarCredencial, MAX_CREDENCIAL, _setVerificador };
