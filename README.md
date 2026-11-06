# PagosPendientes
Aplicación web estática para registrar gastos pendientes de cobrar. Inicia sesión con Google (ventana estándar de Google) y guarda los datos en un Excel (`.xlsx`, hojas `Gastos` y `Pendientes`) en tu Drive.

## Puesta en marcha (una sola vez, el publicador)
1. En Google Cloud Console crea un *OAuth Client ID* (Web), agrega el origen donde se publique (p. ej. GitHub Pages) y habilita la *Google Drive API*.
2. Coloca el Client ID en `config.js` (es público, no es un secreto).
3. Publica el repositorio (GitHub Pages).

## Uso
1. Pulsa **Iniciar sesión con Google** y acepta los permisos.
2. En **Configuración** edita el nombre del archivo (por defecto `PagosPendientes.xlsx`); se crea si no existe.
3. Agrega gastos, divide uniforme o manual y marca cobros.

## Seguridad
- Permiso mínimo de Drive (`drive.file`): solo archivos creados por la app.
- Token y datos de sesión en `sessionStorage` (se borran al cerrar la pestaña); al cerrar sesión se revoca el token.
- CSP, SRI para SheetJS, escape de HTML en todo dato renderizado y escape de consultas a Drive.

Pruebas de la lógica: `npm test`.
