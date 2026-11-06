# Control de pagos pendientes
Aplicación web estática para registrar gastos pendientes de cobrar. Inicia sesión con Google (ventana estándar de Google) y guarda los datos en un Excel (`.xlsx`, hojas `Gastos`, `Pendientes` y `Personas`) en tu Drive.

La versión visible de la aplicación usa el formato `MAJOR.MINOR.PATCH`, comenzando en `1.0.0`: incrementa PATCH para correcciones pequeñas, MINOR para funcionalidades compatibles y MAJOR para cambios incompatibles.

## Configuración de Google (solo el publicador)
El ID de cliente OAuth es público y se define en `config.js`; los usuarios no lo ven. Se obtiene en [Google Cloud Console](https://console.cloud.google.com/): habilita Google Drive API, configura la pantalla de consentimiento y crea un ID de cliente de tipo aplicación web. Agrega el sitio publicado a los orígenes autorizados de JavaScript (por ejemplo `https://usuario.github.io`, sin ruta) y, en modo de prueba, tu cuenta como usuario de prueba. Nunca publiques el secreto de cliente.

## Uso
1. Pulsa **Iniciar sesión con Google** y acepta los permisos.
2. En **Configuración de la cuenta** edita el nombre del archivo (por defecto `PagosPendientes.xlsx`); se crea si no existe. Puedes volver con el botón **Configuración**.
3. En el resumen consulta el total pendiente y los importes por persona; pulsa una fila para ver solo sus pagos pendientes. Usa **Ver pendientes** para marcar cobros o **Agregar nuevo pago** para registrar un gasto y dividirlo uniforme o manualmente.
4. Vuelve al resumen desde cada sección. **Configuración** permite cambiar el archivo o regresar a la pantalla anterior sin modificarlo; los filtros y los datos del formulario se conservan.

La ventana de pagos pendientes muestra pendientes por defecto; puedes filtrar por estado, rangos de fechas del gasto y de cobro y nombre de persona. Los filtros de fecha de cobro excluyen registros sin fecha válida. El filtro de persona sugiere nombres guardados en el Excel, aunque también permite buscar cualquier nombre. Se muestran 50 pagos por página; el total incluye todos los resultados filtrados, no solo los visibles. Puedes revertir un cobro desde su registro después de confirmarlo. El botón de tema permite alternar entre claro y oscuro; la elección se recuerda en el navegador.

Se recomienda conservar como máximo un año de historial de cobros y hacer una copia manual del Excel en Drive. En Configuración, **Eliminar cobros antiguos** elimina, previa confirmación, los pagos cobrados antes de la fecha de hoy menos tres meses de calendario y los gastos que se queden sin pagos. No elimina pendientes, cobros sin fecha válida ni gastos que aún tengan pagos. La operación se aplica al archivo abierto, aunque se haya escrito otro nombre en configuración, y no puede deshacerse desde la aplicación. La advertencia a partir de 1,000 pagos es orientativa, no un límite de rendimiento medido.

Al guardar se conservan las hojas adicionales en la medida en que la biblioteca de Excel las admite, pero podrían perder formato, gráficos u otros elementos. Las hojas administradas por la aplicación (`Gastos`, `Pendientes` y `Personas`) se reconstruyen y también pueden perder formato o contenido adicional. Evita editar el archivo desde otros dispositivos o desde Excel mientras esté abierto en la aplicación: los cambios simultáneos podrían sobrescribirse.

Si un guardado falla, puede no saberse si Drive llegó a recibirlo. Revisa el archivo en Drive y vuelve a abrirlo desde Configuración antes de intentar guardar de nuevo; esto evita que la aplicación sobrescriba un resultado incierto con datos anteriores.

Las acciones generales están dentro de cada pantalla, debajo del título y antes del contenido, y permanecen visibles al desplazarse. Las acciones de cada pago permanecen junto a su registro.

Las notificaciones utilizan un espacio fijo bajo la barra superior para evitar que la página se mueva al mostrarlas u ocultarlas.

Al registrar un gasto, escribe cada nombre en su campo o elige una sugerencia de las personas guardadas. **Guardar persona** añade un nombre nuevo a la hoja `Personas` del Excel abierto. Desde **Administrar personas** puedes agregarlas, modificar sus nombres o quitarlas de la lista; modificar un nombre también actualiza sus pagos y eliminarlo de la lista no elimina pagos. Se rechazan nombres duplicados sin distinguir mayúsculas ni espacios exteriores.

Al abrir un archivo, las personas de la lista anterior del navegador para esa cuenta se migran una sola vez al Excel abierto; la copia local se elimina solo después de guardarlas correctamente. Los archivos antiguos sin hoja `Personas` se abren con la lista vacía. La lista se comparte entre dispositivos que abran el mismo archivo, y es independiente entre archivos.

La instalación es opcional desde el menú del navegador compatible (por ejemplo, **Instalar aplicación** en Chrome); la aplicación no muestra un aviso ni botón de instalación. Para ello debe publicarse mediante HTTPS o abrirse en localhost. La interfaz se adapta a pantallas móviles. La instalación conserva los archivos de la interfaz para facilitar la apertura, pero iniciar sesión y consultar o guardar pagos requiere conexión a Google y Drive; los datos de pagos no se almacenan para uso sin conexión.

La foto y el nombre de perfil de Google se muestran cuando están disponibles, junto con el correo.
El nombre del archivo se recuerda en el navegador para cada cuenta de Google. Al iniciar sesión nuevamente en ese navegador se abre el resumen; en otro navegador o si se borran los datos del sitio hay que configurar el archivo otra vez.

## Seguridad
- Permiso mínimo de Drive (`drive.file`): solo archivos creados por la app.
- Token y datos de sesión se guardan en `sessionStorage` (accesible a los scripts de la página y borrado al cerrar la pestaña); al cerrar sesión se revoca el token.
- El nombre del archivo, el identificador de la cuenta y la preferencia de tema se conservan en `localStorage`; no se guarda allí el token ni las nuevas personas guardadas.
- SheetJS 0.20.3 se sirve desde el repositorio con SRI; la app no depende de un CDN para procesar Excel.
- CSP, escape de HTML en todo dato renderizado y escape de consultas a Drive.

Pruebas de la lógica: `npm test`.
