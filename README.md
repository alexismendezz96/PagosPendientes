# PagosPendientes
Aplicación web estática para registrar gastos pendientes de cobrar. Inicia sesión con Google (ventana estándar de Google) y guarda los datos en un Excel (`.xlsx`, hojas `Gastos` y `Pendientes`) en tu Drive.

## Configuración de Google
El ID de cliente (público, no es un secreto) se define en `config.js`; si se deja vacío, la app lo solicita al iniciar. Google requiere un proyecto OAuth; la aplicación no puede crearlo automáticamente. En [Google Cloud Console](https://console.cloud.google.com/), habilita Google Drive API, configura la pantalla de consentimiento y crea un ID de cliente OAuth de tipo aplicación web. Agrega el origen de la página a los orígenes autorizados de JavaScript (por ejemplo, `https://usuario.github.io`, sin la ruta del repositorio). Si la app está en modo de prueba, agrega tu cuenta como usuario de prueba.

## Uso
1. Introduce el ID de cliente en la pantalla inicial, pulsa **Iniciar sesión con Google** y acepta los permisos. El ID se conserva solo en la pestaña actual, incluso si se recarga, y se elimina al cerrar sesión o la pestaña.
2. En **Configuración** edita el nombre del archivo (por defecto `PagosPendientes.xlsx`); se crea si no existe.
3. Agrega gastos, divide uniforme o manual y marca cobros.

## Seguridad
- Permiso mínimo de Drive (`drive.file`): solo archivos creados por la app.
- El ID de cliente es público; no introduzcas ni publiques el secreto de cliente. El ID, token y datos de sesión se guardan en `sessionStorage` (accesible a los scripts de la página y borrado al cerrar la pestaña); al cerrar sesión se revoca el token.
- CSP, SRI para SheetJS, escape de HTML en todo dato renderizado y escape de consultas a Drive.

Pruebas de la lógica: `npm test`.
