const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const clientId = '123-example.apps.googleusercontent.com';

function setup(initialSession, fetch = async () => ({ ok: true, json: async () => ({ email: 'user@example.com' }) }), extras = {}) {
  const data = new Map(initialSession ? [['pp_session', JSON.stringify(initialSession)]] : []);
  const elements = new Map();
  const tokenClients = [];
  let revoked;
  const element = (id) => {
    if (!elements.has(id)) {
      const classes = new Set(['loading', 'login', 'config', 'app', 'userBox'].includes(id) ? ['hidden'] : []);
      elements.set(id, {
        value: '', textContent: '', className: '',
        classList: {
          toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
          add(name) { classes.add(name); },
          contains(name) { return classes.has(name); },
        },
      });
    }
    return elements.get(id);
  };
  const google = { accounts: { oauth2: {
    initTokenClient(options) {
      const client = { options, requestAccessToken() { client.requested = true; } };
      tokenClients.push(client);
      return client;
    },
    revoke(token) { revoked = token; },
  } } };
  const context = {
    window: { APP_CONFIG: { DEFAULT_FILE_NAME: 'PagosPendientes.xlsx', GOOGLE_CLIENT_ID: clientId }, google },
    google,
    document: { getElementById: element, querySelectorAll: () => [] },
    sessionStorage: {
      getItem: (key) => data.get(key) || null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    },
    fetch,
    setTimeout: () => 1,
    AbortSignal,
    clearTimeout() {},
    console,
    ...extras,
  };
  vm.runInNewContext(source, context);
  return { element, data, tokenClients, revoked: () => revoked };
}

const startLogin = (app) => app.element('btnLogin').onclick();

test('el login usa el ID de config.js y guarda solo la sesión de la pestaña', async () => {
  const app = setup();
  startLogin(app);
  const client = app.tokenClients[0];
  assert.equal(client.options.client_id, clientId);
  assert.equal(client.requested, true);

  await client.options.callback({
    access_token: 'test-token', expires_in: 3600,
    scope: 'https://www.googleapis.com/auth/drive.file',
  });
  const session = JSON.parse(app.data.get('pp_session'));
  assert.equal(session.token, 'test-token');
  assert.equal(session.email, 'user@example.com');
  assert.equal(app.element('fileName').value, 'PagosPendientes.xlsx');

  app.element('btnLogout').onclick();
  assert.equal(app.revoked(), 'test-token');
  assert.equal(app.data.has('pp_session'), false);
});

test('rechaza la sesión si falta el permiso de Drive', async () => {
  const app = setup();
  startLogin(app);
  await app.tokenClients[0].options.callback({ access_token: 't', expires_in: 3600, scope: 'openid' });
  assert.match(app.element('msg').textContent, /permiso de Drive/);
  assert.equal(app.data.has('pp_session'), false);
});

test('muestra el error si se cierra la ventana de Google', () => {
  const app = setup();
  startLogin(app);
  app.tokenClients[0].options.error_callback({ type: 'popup_closed' });
  assert.match(app.element('msg').textContent, /se cerró/);
  app.tokenClients[0].options.error_callback({ type: 'popup_failed_to_open' });
  assert.match(app.element('msg').textContent, /bloqueó la ventana/);
});

const isHidden = (app, id) => app.element(id).classList.contains('hidden');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const activeSession = { token: 'test-token', expiresAt: Date.now() + 3600000 };

test('sin sesión se muestra el login y se oculta la carga', () => {
  const app = setup();
  assert.equal(isHidden(app, 'loading'), true);
  assert.equal(isHidden(app, 'login'), false);
});

test('mantiene la carga visible sin mostrar login mientras se restaura la sesión', async () => {
  let resolveUser;
  const app = setup(activeSession, () => new Promise((resolve) => { resolveUser = resolve; }));
  assert.equal(isHidden(app, 'loading'), false);
  assert.equal(isHidden(app, 'login'), true);
  assert.equal(isHidden(app, 'config'), true);
  resolveUser({ ok: true, json: async () => ({ email: 'user@example.com' }) });
  await flush();
  assert.equal(isHidden(app, 'loading'), true);
  assert.equal(isHidden(app, 'login'), true);
  assert.equal(isHidden(app, 'config'), false);
});

test('muestra login y un error si falla la restauración de la sesión', async () => {
  const app = setup(activeSession, async () => { throw new Error('Sin conexión'); });
  await flush();
  assert.equal(isHidden(app, 'loading'), true);
  assert.equal(isHidden(app, 'login'), false);
  assert.equal(app.element('msg').textContent, 'Sin conexión');
});

test('una sesión rechazada vuelve al login y se elimina', async () => {
  const app = setup(activeSession, async () => ({ status: 401, ok: false }));
  await flush();
  assert.equal(isHidden(app, 'loading'), true);
  assert.equal(isHidden(app, 'login'), false);
  assert.equal(app.data.has('pp_session'), false);
  assert.match(app.element('msg').textContent, /sesión expiró/);
});

test('si falla la apertura del archivo se muestra configuración en lugar de quedar cargando', async () => {
  const app = setup({ ...activeSession, fileName: 'PagosPendientes.xlsx' });
  await flush();
  assert.equal(isHidden(app, 'loading'), true);
  assert.equal(isHidden(app, 'config'), false);
  assert.match(app.element('msg').textContent, /librería de Excel/);
});

test('mantiene la carga hasta que el archivo existente está listo', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'Gastos');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  let resolveFile;
  const fetch = async (url) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ email: 'user@example.com' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'file-id' }] }) };
    return new Promise((resolve) => { resolveFile = resolve; });
  };
  const app = setup({ ...activeSession, fileName: 'PagosPendientes.xlsx' }, fetch, { XLSX, Logic });
  await flush();
  assert.equal(isHidden(app, 'loading'), false);
  assert.equal(isHidden(app, 'login'), true);
  assert.equal(isHidden(app, 'config'), true);
  resolveFile({ ok: true, arrayBuffer: async () => bytes });
  await flush();
  assert.equal(isHidden(app, 'loading'), true);
  assert.equal(isHidden(app, 'app'), false);
});
