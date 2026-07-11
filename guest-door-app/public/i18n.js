// Übersetzungen für das Gäste-Frontend. Die Admin-Seite bleibt bewusst nur Deutsch
// (nur für den Gastgeber gedacht).
const SUPPORTED_LANGS = ['de', 'en', 'fr', 'es'];

const TRANSLATIONS = {
  de: {
    title: 'Willkommen 👋',
    greeting: (name) => `Hallo ${name}!`,
    pinIntro: 'Bitte gib die PIN ein, die du von deinem Gastgeber erhalten hast.',
    pinSubmit: 'Bestätigen',
    bellTitle: 'Fast geschafft!',
    bellText: (label) =>
      label
        ? `Bitte betätige jetzt einmal die Klingel bei „${label}“ an der Gegensprechanlage.`
        : 'Bitte betätige jetzt einmal die Klingel an der Gegensprechanlage.',
    bellWaiting: 'Wir warten auf dein Klingeln …',
    streetOpenTitle: 'Haustür ist offen! 🚪',
    streetOpenText: (loc) =>
      loc ? `Bitte gehe jetzt hoch zu: ${loc}.` : 'Bitte gehe jetzt hoch zur Wohnungstür.',
    continueBtn: 'Weiter',
    apartmentTitle: 'Wohnungstür öffnen',
    apartmentIntro: 'Das ist deine Wohnungstür. Drücke den Button, sobald du davor stehst.',
    apartmentBtn: 'Wohnungstür öffnen',
    doneTitle: 'Willkommen zuhause! 🎉',
    doneText: (loc) =>
      'Bitte schließe die Wohnungstür hinter dir.' + (loc ? ` Dein Zimmer ist: ${loc}.` : ''),
    doneFooter: 'Wir wünschen dir einen schönen Aufenthalt!',
    errors: {
      network: 'Verbindung zum Server fehlgeschlagen.',
      rate_limited: 'Zu viele Versuche. Bitte später erneut versuchen.',
      pin_required: 'PIN erforderlich.',
      invalid_pin: 'PIN ungültig oder aktuell nicht gültig.',
      session_invalid: 'Sitzung abgelaufen oder ungültig. Bitte PIN erneut eingeben.',
      door_not_open: 'Die Haustür wurde noch nicht geöffnet.',
      apartment_door_failed: 'Wohnungstür konnte nicht geöffnet werden. Bitte erneut versuchen.',
      street_door_failed: 'Haustür konnte nicht geöffnet werden. Bitte erneut klingeln oder Gastgeber kontaktieren.',
      generic: 'Es ist ein Fehler aufgetreten.',
    },
  },
  en: {
    title: 'Welcome 👋',
    greeting: (name) => `Hi ${name}!`,
    pinIntro: 'Please enter the PIN you received from your host.',
    pinSubmit: 'Confirm',
    bellTitle: 'Almost there!',
    bellText: (label) =>
      label
        ? `Please ring the doorbell for "${label}" once on the intercom.`
        : 'Please ring the doorbell once on the intercom.',
    bellWaiting: 'Waiting for your ring …',
    streetOpenTitle: 'Front door is open! 🚪',
    streetOpenText: (loc) =>
      loc ? `Please head up now to: ${loc}.` : 'Please head up to the apartment door now.',
    continueBtn: 'Continue',
    apartmentTitle: 'Open apartment door',
    apartmentIntro: 'This is your apartment door. Press the button once you are standing in front of it.',
    apartmentBtn: 'Open apartment door',
    doneTitle: 'Welcome home! 🎉',
    doneText: (loc) =>
      'Please close the apartment door behind you.' + (loc ? ` Your room is: ${loc}.` : ''),
    doneFooter: 'We wish you a pleasant stay!',
    errors: {
      network: 'Could not connect to the server.',
      rate_limited: 'Too many attempts. Please try again later.',
      pin_required: 'PIN required.',
      invalid_pin: 'PIN invalid or not currently valid.',
      session_invalid: 'Session expired or invalid. Please enter your PIN again.',
      door_not_open: 'The front door has not been opened yet.',
      apartment_door_failed: 'The apartment door could not be opened. Please try again.',
      street_door_failed: 'The front door could not be opened. Please ring again or contact your host.',
      generic: 'Something went wrong.',
    },
  },
  fr: {
    title: 'Bienvenue 👋',
    greeting: (name) => `Bonjour ${name} !`,
    pinIntro: 'Veuillez saisir le code PIN reçu de votre hôte.',
    pinSubmit: 'Confirmer',
    bellTitle: 'Presque terminé !',
    bellText: (label) =>
      label
        ? `Merci de sonner une fois à l'interphone, au nom « ${label} ».`
        : "Merci de sonner une fois à l'interphone.",
    bellWaiting: 'En attente de votre sonnette…',
    streetOpenTitle: "La porte d'entrée est ouverte ! 🚪",
    streetOpenText: (loc) =>
      loc
        ? `Merci de monter maintenant jusqu'à : ${loc}.`
        : "Merci de monter maintenant jusqu'à la porte de l'appartement.",
    continueBtn: 'Continuer',
    apartmentTitle: "Ouvrir la porte de l'appartement",
    apartmentIntro: "Voici la porte de votre appartement. Appuyez sur le bouton une fois que vous êtes devant.",
    apartmentBtn: 'Ouvrir la porte',
    doneTitle: 'Bienvenue chez vous ! 🎉',
    doneText: (loc) =>
      "Merci de refermer la porte de l'appartement derrière vous." + (loc ? ` Votre chambre est : ${loc}.` : ''),
    doneFooter: 'Nous vous souhaitons un excellent séjour !',
    errors: {
      network: 'Échec de la connexion au serveur.',
      rate_limited: 'Trop de tentatives. Merci de réessayer plus tard.',
      pin_required: 'Code PIN requis.',
      invalid_pin: 'Code PIN invalide ou non valable actuellement.',
      session_invalid: 'Session expirée ou invalide. Merci de ressaisir le code PIN.',
      door_not_open: "La porte d'entrée n'a pas encore été ouverte.",
      apartment_door_failed: "La porte de l'appartement n'a pas pu être ouverte. Merci de réessayer.",
      street_door_failed: "La porte d'entrée n'a pas pu être ouverte. Merci de resonner ou de contacter votre hôte.",
      generic: "Une erreur s'est produite.",
    },
  },
  es: {
    title: 'Bienvenido 👋',
    greeting: (name) => `¡Hola ${name}!`,
    pinIntro: 'Introduce el PIN que te ha dado tu anfitrión.',
    pinSubmit: 'Confirmar',
    bellTitle: '¡Casi listo!',
    bellText: (label) =>
      label
        ? `Por favor, toca una vez el timbre del portero automático en "${label}".`
        : 'Por favor, toca una vez el timbre del portero automático.',
    bellWaiting: 'Esperando a que toques el timbre…',
    streetOpenTitle: '¡La puerta de la calle está abierta! 🚪',
    streetOpenText: (loc) =>
      loc ? `Sube ahora hasta: ${loc}.` : 'Sube ahora hasta la puerta del apartamento.',
    continueBtn: 'Continuar',
    apartmentTitle: 'Abrir la puerta del apartamento',
    apartmentIntro: 'Esta es la puerta de tu apartamento. Pulsa el botón en cuanto estés delante de ella.',
    apartmentBtn: 'Abrir la puerta',
    doneTitle: '¡Bienvenido a casa! 🎉',
    doneText: (loc) =>
      'Cierra la puerta del apartamento detrás de ti.' + (loc ? ` Tu habitación es: ${loc}.` : ''),
    doneFooter: '¡Que disfrutes de tu estancia!',
    errors: {
      network: 'No se pudo conectar con el servidor.',
      rate_limited: 'Demasiados intentos. Inténtalo de nuevo más tarde.',
      pin_required: 'PIN requerido.',
      invalid_pin: 'PIN no válido o no vigente en este momento.',
      session_invalid: 'La sesión ha caducado o no es válida. Vuelve a introducir el PIN.',
      door_not_open: 'La puerta de la calle todavía no se ha abierto.',
      apartment_door_failed: 'No se pudo abrir la puerta del apartamento. Inténtalo de nuevo.',
      street_door_failed: 'No se pudo abrir la puerta de la calle. Vuelve a tocar el timbre o contacta con tu anfitrión.',
      generic: 'Se ha producido un error.',
    },
  },
};

function detectLanguage() {
  const saved = sessionStorage.getItem('guestLang');
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;

  const browserLangs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const raw of browserLangs) {
    const short = (raw || '').slice(0, 2).toLowerCase();
    if (SUPPORTED_LANGS.includes(short)) return short;
  }
  return 'de';
}
