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
      elements.set(id, {
        value: '', textContent: '', className: '',
        classList: { toggle() {}, add() {} },
        focus() { this.focused = true; },
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
    window: { APP_CONFIG: { DEFAULT_FILE_NAME: 'PagosPendientes.xlsx' }, google, location: { origin: 'https://example.github.io' } },
    google,
    document: {
      getElementById: element,
      querySelectorAll: () => [],
    },
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

function submit(app, value) {
  app.element('clientId').value = value;
  app.element('loginForm').onsubmit({ preventDefault() {} });
}

test('solicita ID válido y abre el flujo de Google sin almacenar secretos', async () => {
  const app = setup();
  submit(app, 'client-secret');
  assert.equal(app.tokenClients.length, 0);
  assert.equal(app.element('clientId').focused, true);
  assert.match(app.element('msg').textContent, /ID de cliente OAuth válido/);

  submit(app, ` ${clientId} `);
  assert.equal(app.tokenClients.length, 1);
  const client = app.tokenClients[0];
  assert.equal(client.options.client_id, clientId);
  assert.equal(client.requested, true);
  assert.deepEqual(JSON.parse(app.data.get('pp_session')), { clientId });
  await client.options.callback({
    access_token: 'test-token', expires_in: 3600,
    scope: 'https://www.googleapis.com/auth/drive.file',
  });
  const session = JSON.parse(app.data.get('pp_session'));
  assert.equal(session.clientId, clientId);
  assert.equal(session.token, 'test-token');
  assert.equal(session.email, 'user@example.com');

  app.element('btnLogout').onclick();
  assert.equal(app.revoked(), 'test-token');
  assert.equal(app.data.has('pp_session'), false);
  assert.equal(app.element('clientId').value, '');
});

test('restaura el ID al recargar y conserva solo el ID tras caducar', () => {
  const app = setup({ clientId, token: 'expired', expiresAt: Date.now() - 1 });
  assert.equal(app.element('clientId').value, clientId);
  submit(app, clientId);
  assert.deepEqual(JSON.parse(app.data.get('pp_session')), { clientId });
  assert.equal(app.tokenClients[0].requested, true);
});

test('permite corregir el ID y muestra errores de la ventana de Google', () => {
  const app = setup();
  submit(app, clientId);
  submit(app, '456-other.apps.googleusercontent.com');
  assert.equal(app.tokenClients[1].options.client_id, '456-other.apps.googleusercontent.com');
  app.tokenClients[1].options.error_callback();
  assert.match(app.element('msg').textContent, /ventana de Google/);
});
