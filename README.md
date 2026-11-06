# Control de pagos pendientes
Aplicación web estática para registrar gastos pendientes de cobrar. Inicia sesión con Google (ventana estándar de Google) y guarda los datos en un Excel (`.xlsx`, hojas `Gastos` y `Pendientes`) en tu Drive.

La versión visible de la aplicación usa el formato `MAJOR.MINOR.PATCH`, comenzando en `1.0.0`: incrementa PATCH para correcciones pequeñas, MINOR para funcionalidades compatibles y MAJOR para cambios incompatibles.

## Configuración de Google (solo el publicador)
El ID de cliente OAuth es público y se define en `config.js`; los usuarios no lo ven. Se obtiene en [Google Cloud Console](https://console.cloud.google.com/): habilita Google Drive API, configura la pantalla de consentimiento y crea un ID de cliente de tipo aplicación web. Agrega el sitio publicado a los orígenes autorizados de JavaScript (por ejemplo `https://usuario.github.io`, sin ruta) y, en modo de prueba, tu cuenta como usuario de prueba. Nunca publiques el secreto de cliente.

## Uso
1. Pulsa **Iniciar sesión con Google** y acepta los permisos.
2. En **Configuración de la cuenta** edita el nombre del archivo (por defecto `PagosPendientes.xlsx`); se crea si no existe. Puedes volver con el botón **Configuración**.
3. En el resumen consulta los pendientes por persona y pulsa un nombre para ver solo sus pagos pendientes. Usa **Ver pendientes** para marcar cobros o **Agregar nuevo pago** para registrar un gasto y dividirlo uniforme o manualmente.
4. Vuelve al resumen desde cada sección. **Configuración** permite cambiar el archivo o regresar a la pantalla anterior sin modificarlo; los filtros y los datos del formulario se conservan.

La ventana de pagos pendientes muestra pendientes por defecto; puedes filtrar por estado, rango de fechas del gasto y nombre de persona. El botón de tema permite alternar entre claro y oscuro; la elección se recuerda en el navegador.

Al registrar un gasto, agrega un campo por persona. **Guardar persona** añade el nombre a las sugerencias para próximos gastos en ese navegador y cuenta de Google; no se sincroniza con otros dispositivos. Después de guardar el gasto, elige entre volver al resumen o agregar otro registro con el formulario limpio.

La instalación es opcional desde el menú del navegador compatible (por ejemplo, **Instalar aplicación** en Chrome); la aplicación no muestra un aviso ni botón de instalación. Para ello debe publicarse mediante HTTPS o abrirse en localhost. La interfaz se adapta a pantallas móviles. La instalación conserva los archivos de la interfaz para facilitar la apertura, pero iniciar sesión y consultar o guardar pagos requiere conexión a Google y Drive; los datos de pagos no se almacenan para uso sin conexión.

La foto y el nombre de perfil de Google se muestran cuando están disponibles, junto con el correo.
El nombre del archivo se recuerda en el navegador para cada cuenta de Google. Al iniciar sesión nuevamente en ese navegador se abre el resumen; en otro navegador o si se borran los datos del sitio hay que configurar el archivo otra vez.

## Seguridad
- Permiso mínimo de Drive (`drive.file`): solo archivos creados por la app.
- Token y datos de sesión se guardan en `sessionStorage` (accesible a los scripts de la página y borrado al cerrar la pestaña); al cerrar sesión se revoca el token.
- El nombre del archivo, las personas guardadas por cuenta, el identificador de la cuenta y la preferencia de tema se conservan en `localStorage`; no se guarda allí el token.
- SheetJS 0.20.3 se sirve desde el repositorio con SRI; la app no depende de un CDN para procesar Excel.
- CSP, escape de HTML en todo dato renderizado y escape de consultas a Drive.

Pruebas de la lógica: `npm test`.
