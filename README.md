# PagosPendientes
Aplicación web estática para registrar gastos pendientes de cobrar. Inicia sesión con Google (ventana estándar de Google) y guarda los datos en un Excel (`.xlsx`, hojas `Gastos` y `Pendientes`) en tu Drive.

La versión visible de la aplicación usa el formato `MAJOR.MINOR.PATCH`, comenzando en `1.0.0`: incrementa PATCH para correcciones pequeñas, MINOR para funcionalidades compatibles y MAJOR para cambios incompatibles.

## Configuración de Google (solo el publicador)
El ID de cliente OAuth es público y se define en `config.js`; los usuarios no lo ven. Se obtiene en [Google Cloud Console](https://console.cloud.google.com/): habilita Google Drive API, configura la pantalla de consentimiento y crea un ID de cliente de tipo aplicación web. Agrega el sitio publicado a los orígenes autorizados de JavaScript (por ejemplo `https://usuario.github.io`, sin ruta) y, en modo de prueba, tu cuenta como usuario de prueba. Nunca publiques el secreto de cliente.

## Uso
1. Pulsa **Iniciar sesión con Google** y acepta los permisos.
2. En **Configuración de la cuenta** edita el nombre del archivo (por defecto `PagosPendientes.xlsx`); se crea si no existe. Puedes volver con el botón **Configuración**.
3. Agrega gastos, divide uniforme o manual y marca cobros.

## Seguridad
- Permiso mínimo de Drive (`drive.file`): solo archivos creados por la app.
- Token y datos de sesión se guardan en `sessionStorage` (accesible a los scripts de la página y borrado al cerrar la pestaña); al cerrar sesión se revoca el token.
- CSP, SRI para SheetJS, escape de HTML en todo dato renderizado y escape de consultas a Drive.

Pruebas de la lógica: `npm test`.
