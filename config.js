// El Client ID de OAuth es público por diseño (no es un secreto). Lo define el
// publicador de la app una sola vez; los usuarios finales nunca lo escriben.
window.APP_CONFIG = Object.freeze({
  GOOGLE_CLIENT_ID: 'REEMPLAZAR_CON_TU_CLIENT_ID.apps.googleusercontent.com',
  DEFAULT_FILE_NAME: 'PagosPendientes.xlsx',
});
