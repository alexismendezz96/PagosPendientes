const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const clientId = '123-example.apps.googleusercontent.com';

function setup(initialSession) {
  const data = new Map(initialSession ? [['pp_session', JSON.stringify(initialSession)]] : []);
  const elements = new Map();
  const tokenClients = [];
  let revoked;
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, { value: '', textContent: '', className: '', classList: { toggle() {}, add() {}, contains: () => true } });
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
    fetch: async () => ({ ok: true, json: async () => ({ email: 'user@example.com' }) }),
    setTimeout: () => 1,
    clearTimeout() {},
    console,
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
  app.tokenClients[0].options.error_callback();
  assert.match(app.element('msg').textContent, /ventana de Google/);
});
