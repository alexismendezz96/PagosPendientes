const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const clientId = '123-example.apps.googleusercontent.com';

function setup(initialSession, fetch = async () => ({ ok: true, json: async () => ({ email: 'user@example.com' }) }), extras = {}) {
  const data = new Map(initialSession ? [['pp_session', JSON.stringify(initialSession)]] : []);
  const preferences = new Map();
  const elements = new Map();
  const tokenClients = [];
  const timers = [];
  const mode = { value: 'equal' };
  let revoked;
  const element = (id) => {
    if (!elements.has(id)) {
      const classes = new Set(['loading', 'login', 'config', 'app', 'userBox', 'userPhoto',
        'btnConfigBack', 'summaryActions', 'summary', 'newExpense', 'details'].includes(id) ? ['hidden'] : []);
      elements.set(id, {
        value: '', textContent: '', className: '',
        firstElementChild: { textContent: '' },
        setAttribute(name, value) { this[name] = value; },
        removeAttribute(name) { delete this[name]; },
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
    document: {
      documentElement: { dataset: {} },
      getElementById: element,
      querySelector: () => mode,
      querySelectorAll: () => [],
    },
    navigator: {},
    sessionStorage: {
      getItem: (key) => data.get(key) || null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    },
    localStorage: {
      getItem: (key) => preferences.get(key) || null,
      setItem: (key, value) => preferences.set(key, value),
    },
    fetch,
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    AbortSignal,
    URL,
    clearTimeout() {},
    console,
    ...extras,
  };
  vm.runInNewContext(source, context);
  return { element, data, preferences, tokenClients, timers, mode, document: context.document, revoked: () => revoked };
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
  assert.equal(isHidden(app, 'summaryActions'), true);
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
  assert.equal(isHidden(app, 'summary'), false);
  assert.equal(isHidden(app, 'newExpense'), true);
  assert.equal(isHidden(app, 'details'), true);
});

test('navega entre resumen, pagos, detalles y configuración sin mostrar secciones simultáneas', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'Gastos');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const fetch = async (url) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ email: 'user@example.com' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'file-id' }] }) };
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup({ ...activeSession, fileName: 'PagosPendientes.xlsx' }, fetch, { XLSX, Logic });
  await flush();
  const expectView = (visible) => {
    for (const id of ['summary', 'newExpense', 'details']) {
      assert.equal(isHidden(app, id), id !== visible, id);
    }
    assert.equal(isHidden(app, 'app'), false);
    assert.equal(isHidden(app, 'config'), true);
    assert.equal(isHidden(app, 'summaryActions'), visible !== 'summary');
  };
  expectView('summary');
  app.element('btnDetails').onclick();
  expectView('details');
  app.element('filterPerson').value = 'Ana';
  app.element('filterStatus').value = 'Cobrado';
  app.element('btnSettings').onclick();
  assert.equal(app.element('btnConfigBack').textContent, 'Volver a pendientes');
  app.element('btnSettings').onclick();
  app.element('btnConfigBack').onclick();
  expectView('details');
  assert.equal(app.element('filterPerson').value, 'Ana');
  assert.equal(app.element('filterStatus').value, 'Cobrado');
  app.element('btnDetailsBack').onclick();
  expectView('summary');
  app.element('btnNewExpense').onclick();
  expectView('newExpense');
  app.element('desc').value = 'Gasto sin terminar';
  app.element('btnSettings').onclick();
  assert.equal(app.element('btnConfigBack').textContent, 'Volver al nuevo pago');
  app.element('btnConfigBack').onclick();
  expectView('newExpense');
  assert.equal(app.element('desc').value, 'Gasto sin terminar');
  app.element('btnExpenseBack').onclick();
  expectView('summary');
  app.element('btnSettings').onclick();
  assert.equal(isHidden(app, 'config'), false);
  assert.equal(isHidden(app, 'app'), true);
  assert.equal(isHidden(app, 'summaryActions'), true);
  assert.equal(isHidden(app, 'btnConfigBack'), false);
  assert.equal(app.element('btnConfigBack').textContent, 'Volver al resumen');
  app.element('btnConfigBack').onclick();
  expectView('summary');
});

test('sin archivo configurado no permite volver al resumen', async () => {
  const app = setup(activeSession);
  await flush();
  assert.equal(isHidden(app, 'config'), false);
  assert.equal(isHidden(app, 'btnConfigBack'), true);
  app.element('btnConfigBack').onclick();
  assert.equal(isHidden(app, 'config'), false);
  assert.equal(isHidden(app, 'app'), true);
});

test('muestra la foto de Google disponible y la oculta al fallar o cerrar sesión', async () => {
  const app = setup(activeSession, async () => ({
    ok: true, json: async () => ({ email: 'user@example.com', picture: 'https://lh3.googleusercontent.com/photo' }),
  }));
  await flush();
  assert.equal(isHidden(app, 'userPhoto'), false);
  assert.equal(app.element('userPhoto').src, 'https://lh3.googleusercontent.com/photo');
  app.element('userPhoto').onerror();
  assert.equal(isHidden(app, 'userPhoto'), true);
  assert.equal(app.element('userPhoto').src, undefined);
  app.element('btnLogout').onclick();
  assert.equal(app.element('userEmail').textContent, '');
});

test('no carga fotos desde un origen que no sea Google', async () => {
  for (const picture of ['https://googleusercontent.com.evil.example/photo', 'http://lh3.googleusercontent.com/photo', 'not-a-url']) {
    const app = setup(activeSession, async () => ({ ok: true, json: async () => ({ picture }) }));
    await flush();
    assert.equal(isHidden(app, 'userPhoto'), true);
    assert.equal(app.element('userPhoto').src, undefined);
  }
});

test('al fallar el cambio de archivo conserva el archivo abierto anteriormente', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'Gastos');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  let searches = 0;
  const fetch = async (url) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ email: 'user@example.com' }) };
    if (url.includes('?q=')) {
      if (++searches > 1) throw new Error('Sin conexión');
      return { ok: true, json: async () => ({ files: [{ id: 'file-id' }] }) };
    }
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup({ ...activeSession, fileName: 'original.xlsx' }, fetch, { XLSX, Logic });
  await flush();
  app.element('btnSettings').onclick();
  app.element('fileName').value = 'otro.xlsx';
  app.element('configForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.equal(app.element('msg').textContent, 'Sin conexión');
  assert.equal(isHidden(app, 'config'), false);
  app.element('btnConfigBack').onclick();
  app.element('btnSettings').onclick();
  assert.equal(app.element('fileName').value, 'original.xlsx');
  assert.equal(JSON.parse(app.data.get('pp_session')).fileId, 'file-id');
});

test('recuerda el archivo por cuenta y conserva el flujo de pagos y cobros', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const saved = new Map();
  const localStorage = {
    getItem: (key) => saved.get(key) || null,
    setItem: (key, value) => saved.set(key, value),
  };
  let account = '123';
  let bytes;
  const fetch = async (url, opts = {}) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ email: 'user@example.com', sub: account }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: bytes ? [{ id: 'file-id' }] : [] }) };
    if (opts.method === 'POST') return { ok: true, json: async () => ({ id: 'file-id' }) };
    if (opts.method === 'PATCH') { bytes = opts.body; return { ok: true }; }
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup(undefined, fetch, { XLSX, Logic, localStorage });
  const signIn = async () => {
    startLogin(app);
    await app.tokenClients.at(-1).options.callback({
      access_token: 'test-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file',
    });
  };
  await signIn();
  assert.equal(isHidden(app, 'config'), false);
  app.element('fileName').value = 'mis-pagos.xlsx';
  app.element('configForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.equal(saved.get('pp_file_123'), 'mis-pagos.xlsx');
  assert.equal(isHidden(app, 'summary'), false);

  app.element('btnNewExpense').onclick();
  app.element('desc').value = 'Almuerzo';
  app.element('total').value = '20';
  app.element('peopleRows').oninput({ target: { dataset: { person: '0' }, value: 'Ana' } });
  app.element('btnAddPerson').onclick();
  app.element('peopleRows').oninput({ target: { dataset: { person: '1' }, value: 'Luis' } });
  app.element('btnAdd').onclick();
  await flush();
  assert.match(app.element('byPerson').innerHTML, /Ana/);
  assert.equal(isHidden(app, 'expenseForm'), true);
  assert.equal(isHidden(app, 'expenseSaved'), false);
  app.element('btnSavedBack').onclick();
  app.element('btnDetails').onclick();
  app.element('detail').onclick({ target: { dataset: { i: '0' } } });
  await flush();
  const workbook = XLSX.read(bytes);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Pendientes);
  assert.equal(rows[0].Estado, 'Cobrado');
  assert.equal(rows[1].Estado, 'Pendiente');

  app.element('btnLogout').onclick();
  await signIn();
  assert.equal(isHidden(app, 'summary'), false);
  assert.equal(app.element('fileName').value, 'mis-pagos.xlsx');
  assert.doesNotMatch(app.element('detail').innerHTML, /Cobrado/);
  app.element('filterStatus').value = 'Cobrado';
  app.element('filterStatus').oninput();
  assert.match(app.element('detail').innerHTML, /Cobrado/);

  app.element('btnLogout').onclick();
  account = '456';
  await signIn();
  assert.equal(isHidden(app, 'config'), false);
  assert.equal(app.element('fileName').value, 'PagosPendientes.xlsx');
});

test('informa si el navegador no permite recordar el archivo', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'Gastos');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const fetch = async (url) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'file-id' }] }) };
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const localStorage = { setItem() { throw new Error('Blocked'); } };
  const app = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic, localStorage });
  await flush();
  assert.equal(isHidden(app, 'summary'), false);
  assert.match(app.element('msg').textContent, /no se pudo recordar/);
});

test('guarda personas por cuenta, filtra el resumen y evita reenviar el gasto', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  let bytes;
  let writes = 0;
  const fetch = async (url, opts = {}) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123', name: 'Usuario', email: 'u@example.com' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: bytes ? [{ id: 'id' }] : [] }) };
    if (opts.method === 'POST') return { ok: true, json: async () => ({ id: 'id' }) };
    if (opts.method === 'PATCH') { bytes = opts.body; writes++; return { ok: true }; }
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup(undefined, fetch, { XLSX, Logic });
  startLogin(app);
  await app.tokenClients[0].options.callback({ access_token: 't', expires_in: 3600, scope: 'drive.file' });
  assert.equal(app.element('userName').textContent, 'Usuario');
  app.element('configForm').onsubmit({ preventDefault() {} });
  await flush();
  app.element('btnNewExpense').onclick();
  app.element('peopleRows').oninput({ target: { dataset: { person: '0' }, value: 'Ana' } });
  app.element('peopleRows').onclick({ target: { dataset: { savePerson: '0' } } });
  assert.equal(app.preferences.get('pp_people_123'), '["Ana"]');
  app.element('btnAddPerson').onclick();
  app.element('peopleRows').oninput({ target: { dataset: { person: '1' }, value: 'Ana María' } });
  app.element('desc').value = 'Comida';
  app.element('total').value = '10';
  app.element('btnAdd').onclick();
  await flush();
  assert.equal(writes, 2);
  assert.equal(app.element('desc').value, '');
  assert.equal(isHidden(app, 'expenseForm'), true);
  app.element('btnSavedBack').onclick();
  assert.match(app.element('byPerson').innerHTML, /class="person-row-link" role="link" tabindex="0"/);
  app.element('byPerson').onclick({ target: { closest: () => ({ dataset: { personIndex: '0' } }) } });
  assert.equal(app.element('filterPerson').value, 'Ana');
  assert.match(app.element('detail').innerHTML, /Ana/);
  assert.doesNotMatch(app.element('detail').innerHTML, /Ana María/);
  app.element('filterPerson').oninput();
  assert.match(app.element('detail').innerHTML, /Ana María/);
  app.element('btnDetailsBack').onclick();
  const row = { dataset: { personIndex: '1' }, closest() { return this; } };
  let prevented = false;
  app.element('byPerson').onkeydown({ key: 'Enter', target: row, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(app.element('filterPerson').value, 'Ana María');
  app.element('btnDetailsBack').onclick();
  app.element('btnNewExpense').onclick();
  assert.match(app.element('savedPeople').innerHTML, /Ana/);
  app.element('btnAdd').onclick();
  await flush();
  assert.equal(writes, 2);
  app.element('btnLogout').onclick();
  assert.equal(app.element('userName').textContent, '');
  assert.equal(app.element('savedPeople').innerHTML, '');
});

test('el tema se recuerda y las notificaciones desaparecen automáticamente', () => {
  const app = setup();
  app.element('btnTheme').onclick();
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  assert.equal(app.preferences.get('pp_theme'), 'dark');
  app.element('peopleRows').onclick({ target: { dataset: { savePerson: '0' } } });
  assert.match(app.element('msg').textContent, /Escribe el nombre/);
  app.timers.at(-1)();
  assert.equal(isHidden(app, 'msg'), true);
});

test('cada nuevo gasto comienza con la fecha local actual', () => {
  let day = 5;
  class LocalDate extends Date {
    getFullYear() { return 2026; }
    getMonth() { return 10; }
    getDate() { return day; }
  }
  const app = setup(undefined, undefined, { Date: LocalDate });
  assert.equal(app.element('fecha').value, '2026-11-05');
  day = 6;
  app.element('btnNewExpense').onclick();
  assert.equal(app.element('fecha').value, '2026-11-06');
  app.element('btnAnotherExpense').onclick();
  assert.equal(app.element('fecha').value, '2026-11-06');
});

test('mantiene los importes manuales y revierte un gasto si falla el guardado', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'Gastos');
  let bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  let fail = true;
  const fetch = async (url, opts = {}) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'id' }] }) };
    if (opts.method === 'PATCH') {
      if (fail) throw new Error('Sin conexión');
      bytes = opts.body;
      return { ok: true };
    }
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic });
  await flush();
  app.element('btnNewExpense').onclick();
  app.mode.value = 'manual';
  app.element('peopleRows').oninput({ target: { dataset: { person: '0' }, value: 'Ana' } });
  app.element('manual').oninput({ target: { dataset: { i: '0' }, value: '3' } });
  app.element('btnAddPerson').onclick();
  app.element('peopleRows').oninput({ target: { dataset: { person: '1' }, value: 'Luis' } });
  app.element('manual').oninput({ target: { dataset: { i: '1' }, value: '7' } });
  app.element('desc').value = 'Comida';
  app.element('total').value = '10';
  app.element('btnAdd').onclick();
  await flush();
  assert.equal(app.element('msg').textContent, 'Sin conexión');
  assert.equal(isHidden(app, 'expenseForm'), false);
  fail = false;
  app.element('btnAdd').onclick();
  await flush();
  const saved = XLSX.read(bytes);
  const rows = XLSX.utils.sheet_to_json(saved.Sheets.Pendientes);
  assert.deepEqual(rows.map((row) => row.Monto), [3, 7]);
  assert.equal(XLSX.utils.sheet_to_json(saved.Sheets.Gastos).length, 1);
});
