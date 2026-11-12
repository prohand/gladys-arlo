// -----------------------------------------------------------------------------
// User-facing messages: action answers and connection statuses.
//
// Every message is a multi-language object `{ en, fr, de, es }`: Gladys shows
// the reader's language and falls back to English.
// -----------------------------------------------------------------------------

import { localize, pick } from './i18n.js';

export const MESSAGES = {
  NO_CREDENTIALS: {
    en: 'Enter the email and the password of your Arlo account, then save.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte Arlo, puis enregistrez.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines Arlo-Kontos ein und speichere.',
    es: 'Introduzca el correo y la contraseña de su cuenta Arlo y guarde.',
  },
  CODE_REQUIRED: {
    en: 'Arlo needs a verification code: click "Send me a code", then "Validate the code".',
    fr: 'Arlo demande un code de vérification : cliquez sur « M’envoyer un code », puis « Valider le code ».',
    de: 'Arlo verlangt einen Bestätigungscode: Klicke auf „Code senden“ und dann auf „Code bestätigen“.',
    es: 'Arlo pide un código de verificación: pulse «Enviarme un código» y luego «Validar el código».',
  },
  NO_PENDING_CODE: {
    en: 'No code is waiting. Click "Send me a code" first (a code is valid 10 minutes).',
    fr: 'Aucun code en attente. Cliquez d’abord sur « M’envoyer un code » (un code est valable 10 minutes).',
    de: 'Kein Code ausstehend. Klicke zuerst auf „Code senden“ (ein Code ist 10 Minuten gültig).',
    es: 'No hay ningún código pendiente. Pulse primero «Enviarme un código» (un código vale 10 minutos).',
  },
  ALREADY_TRUSTED: {
    en: 'No code needed: Arlo trusts this Gladys. Connected.',
    fr: 'Pas besoin de code : Arlo fait confiance à ce Gladys. Connecté.',
    de: 'Kein Code nötig: Arlo vertraut diesem Gladys. Verbunden.',
    es: 'No hace falta código: Arlo confía en este Gladys. Conectado.',
  },
  INIT_FAILED: {
    en: 'Initialization failed, check the integration logs.',
    fr: 'L’initialisation a échoué, consultez les logs de l’intégration.',
    de: 'Initialisierung fehlgeschlagen, prüfe die Logs der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
};

/** "Code sent to j***@example.com: type it in Validate the code." */
export function codeSent(destination) {
  const to = destination ? ` (${destination})` : '';
  return {
    en: `Code sent${to}. Type it below in "Validate the code" within 10 minutes.`,
    fr: `Code envoyé${to}. Saisissez-le ci-dessous dans « Valider le code » sous 10 minutes.`,
    de: `Code gesendet${to}. Gib ihn innerhalb von 10 Minuten unten bei „Code bestätigen“ ein.`,
    es: `Código enviado${to}. Introdúzcalo abajo en «Validar el código» antes de 10 minutos.`,
  };
}

/** "Connected to Arlo: 4 devices." */
export function connectedWith(count) {
  return localize((language) =>
    pick(language, {
      en: `Connected to Arlo: ${count} device(s) found. Add them from the Discovery tab.`,
      fr: `Connecté à Arlo : ${count} appareil(s) trouvé(s). Ajoutez-les depuis l’onglet Découverte.`,
      de: `Mit Arlo verbunden: ${count} Gerät(e) gefunden. Füge sie im Tab „Erkennung“ hinzu.`,
      es: `Conectado a Arlo: ${count} dispositivo(s) encontrado(s). Añádalos desde la pestaña Descubrimiento.`,
    }),
  );
}

/** "Arlo answered: <reason>" — the reason stays in English, as Arlo sent it. */
export function arloFailed(reason) {
  const text = String(reason ?? '').slice(0, 300);
  return {
    en: `Arlo refused or could not be reached: ${text}`,
    fr: `Arlo a refusé ou est injoignable : ${text}`,
    de: `Arlo hat abgelehnt oder ist nicht erreichbar: ${text}`,
    es: `Arlo ha rechazado o no está accesible: ${text}`,
  };
}
