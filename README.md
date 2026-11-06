# PagosPendientes
Aplicación web estática para registrar gastos pendientes de cobrar. Inicia sesión con Google, y guarda los datos en un archivo Excel (`.xlsx`) en Drive (hojas `Gastos` y `Pendientes`).

## Uso
1. En Google Cloud Console crea un *OAuth Client ID* (Web) y agrega el origen donde se publique (p. ej. GitHub Pages) y habilita la *Google Drive API*.
2. Publica este repositorio (GitHub Pages, rama principal, carpeta raíz) y abre la página.
3. En **Configuración** pega el Client ID, inicia sesión (se piden permisos de Drive y perfil) y asocia el archivo Excel (enlace/ID) o crea uno nuevo.
4. Agrega gastos: descripción, total, fecha, personas, división uniforme o manual, y opción de registrarlo como ya cobrado. Se muestra el monto pendiente por persona y puedes marcar cobros.

Pruebas de la lógica: `npm test`.
