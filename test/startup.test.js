const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../startup.js'), 'utf8');

function setup(ready) {
  const listeners = {};
  const elements = {
    startupError: { classList: { remove(name) { this.removed = name; } } },
    btnLogin: {},
    btnTheme: {},
  };
  const window = {
    appReady: ready,
    addEventListener(name, callback) { listeners[name] = callback; },
  };
  vm.runInNewContext(source, { window, document: { getElementById: (id) => elements[id] } });
  return { listeners, elements };
}

test('suprime la invitación automática sin desactivar la instalación del navegador', () => {
  const { listeners } = setup(true);
  let prevented = false;
  listeners.beforeinstallprompt({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('informa si la aplicación no se inicia y no deja botones inoperantes', () => {
  const { listeners, elements } = setup(false);
  listeners.load();
  assert.equal(elements.startupError.classList.removed, 'hidden');
  assert.equal(elements.btnLogin.disabled, true);
  assert.equal(elements.btnTheme.disabled, true);
});

test('no muestra un error cuando la aplicación se inició', () => {
  const { listeners, elements } = setup(true);
  listeners.load();
  assert.equal(elements.startupError.classList.removed, undefined);
  assert.equal(elements.btnLogin.disabled, undefined);
});

test('la caché contiene los mismos recursos versionados que la página', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const worker = fs.readFileSync(require.resolve('../service-worker.js'), 'utf8');
  for (const resource of ['styles.css', 'startup.js', 'config.js', 'logic.js', 'app.js', 'manifest.webmanifest']) {
    const url = `${resource}?v=1.2.9`;
    assert.ok(html.includes(url), url);
    assert.ok(worker.includes(`'${url}'`), url);
  }
});

test('las acciones de cada pantalla siguen a su título y preceden al contenido', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  for (const [section, title, action, content] of [
    ['login', 'Bienvenido', 'btnLogin', 'Registra gastos'],
    ['config', 'Configuración de la cuenta', 'btnSave', 'Elige el archivo'],
    ['summary', 'Resumen de pendientes', 'btnDetails', 'Consulta cuánto'],
    ['newExpense', 'Agregar nuevo pago', 'btnAdd', 'expenseForm'],
    ['details', 'Pagos pendientes', 'btnDetailsBack', 'Consulta los pendientes'],
  ]) {
    const start = html.indexOf(`<section id="${section}"`);
    const end = html.indexOf('</section>', start);
    const page = html.slice(start, end);
    assert.ok(page.indexOf(title) < page.indexOf(action), section);
    assert.ok(page.indexOf(action) < page.indexOf(content), section);
    assert.ok(page.includes('class="view-actions'), section);
  }
  assert.match(html, /id="btnSave"[^>]*form="configForm"/);
  assert.doesNotMatch(html.slice(html.indexOf('<header'), html.indexOf('</header>')), /id="(?:summaryActions|detailsActions)"/);
});
