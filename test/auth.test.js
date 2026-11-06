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
  const modeInputs = [{}, {}];
  let revoked;
  const element = (id) => {
    if (!elements.has(id)) {
      const classes = new Set(['loading', 'login', 'config', 'app', 'userBox', 'userPhoto',
        'btnConfigBack', 'savedActions', 'summary', 'newExpense', 'details', 'managePeople'].includes(id) ? ['hidden'] : []);
      elements.set(id, {
        value: '', textContent: '', className: '', checked: false,
        getBoundingClientRect() { return { height: 56 }; },
        firstElementChild: { textContent: '' },
        focus() {},
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
    window: { APP_CONFIG: { DEFAULT_FILE_NAME: 'PagosPendientes.xlsx', GOOGLE_CLIENT_ID: clientId }, google, addEventListener() {}, confirm: () => true },
    google,
    document: {
      documentElement: { dataset: {}, style: { setProperty() {} } },
      getElementById: element,
      querySelector: (selector) => selector === 'input[name=mode]:checked' ? mode : {
        set checked(value) {
          if (value) mode.value = selector.includes('value=manual') ? 'manual' : 'equal';
        },
      },
      querySelectorAll: () => modeInputs,
    },
    navigator: {},
    Logic: require('../logic'),
    sessionStorage: {
      getItem: (key) => data.get(key) || null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    },
    localStorage: {
      getItem: (key) => preferences.get(key) || null,
      setItem: (key, value) => preferences.set(key, value),
      removeItem: (key) => preferences.delete(key),
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
  return { element, data, preferences, tokenClients, timers, mode, modeInputs, document: context.document, window: context.window, revoked: () => revoked };
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
  assert.match(app.element('msg').textContent, /Sin conexión/);
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
  assert.equal(app.element('pendingTotal').textContent, '0.00');

  app.element('btnNewExpense').onclick();
  app.element('desc').value = 'Almuerzo';
  app.element('total').value = '20';
  app.element('peopleRows').oninput({ target: { dataset: { person: '0' }, value: 'Ana' } });
  app.element('btnAddPerson').onclick();
  app.element('peopleRows').oninput({ target: { dataset: { person: '1' }, value: 'Luis' } });
  app.element('btnAdd').onclick();
  await flush();
  assert.match(app.element('byPerson').innerHTML, /Ana/);
  assert.equal(app.element('pendingTotal').textContent, '20.00');
  assert.equal(isHidden(app, 'expenseForm'), true);
  assert.equal(isHidden(app, 'expenseSaved'), false);
  assert.equal(isHidden(app, 'expenseActions'), true);
  assert.equal(isHidden(app, 'savedActions'), false);
  app.element('btnSavedBack').onclick();
  app.element('btnDetails').onclick();
  app.element('detail').onclick({ target: { dataset: { i: '0' } } });
  await flush();
  assert.equal(app.element('pendingTotal').textContent, '10.00');
  const workbook = XLSX.read(bytes);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Pendientes);
  assert.equal(rows[0].Estado, 'Cobrado');
  assert.equal(rows[1].Estado, 'Pendiente');

  app.element('filterStatus').value = 'Cobrado';
  app.element('filterStatus').oninput();
  assert.match(app.element('detail').innerHTML, /Revertir cobro/);
  app.element('detail').onclick({ target: { dataset: { undo: '0' } } });
  await flush();
  assert.equal(app.element('pendingTotal').textContent, '20.00');
  assert.equal(XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Pendientes)[0].Estado, 'Pendiente');
  app.element('filterStatus').value = 'Pendiente';
  app.element('filterStatus').oninput();
  app.element('detail').onclick({ target: { dataset: { i: '0' } } });
  await flush();

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
  const localStorage = { getItem() { return null; }, setItem() { throw new Error('Blocked'); } };
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
  assert.equal(isHidden(app, 'expenseActions'), false);
  assert.equal(isHidden(app, 'savedActions'), true);
  app.element('peopleRows').oninput({ target: { dataset: { person: '0' }, value: 'Ana' } });
  assert.equal(isHidden(app, 'save-person-0'), false);
  app.element('peopleRows').onclick({ target: { dataset: { savePerson: '0' } } });
  await flush();
  assert.equal(app.preferences.has('pp_people_123'), false);
  assert.equal(XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Personas)[0].Nombre, 'Ana');
  app.element('peopleRows').oninput({ target: { dataset: { person: '0' }, value: 'aNA' } });
  assert.equal(isHidden(app, 'save-person-0'), true);
  app.element('btnAddPerson').onclick();
  app.element('peopleRows').oninput({ target: { dataset: { person: '1' }, value: 'Ana María' } });
  app.element('desc').value = 'Comida';
  app.element('total').value = '10';
  app.element('btnAdd').onclick();
  await flush();
  assert.equal(writes, 3);
  assert.equal(XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Pendientes)[0].Persona, 'Ana');
  assert.equal(app.element('desc').value, '');
  assert.equal(isHidden(app, 'expenseForm'), true);
  app.element('btnSavedBack').onclick();
  assert.match(app.element('byPerson').innerHTML, /class="person-row-link" role="link" tabindex="0"/);
  app.element('byPerson').onclick({ target: { closest: () => ({ dataset: { personIndex: '0' } }) } });
  assert.equal(app.element('filterPerson').value, 'Ana');
  assert.match(app.element('detail').innerHTML, /Ana/);
  assert.doesNotMatch(app.element('detail').innerHTML, /Ana María/);
  assert.equal(app.element('detailTotal').textContent, '5.00');
  app.element('filterPerson').oninput();
  assert.match(app.element('detail').innerHTML, /Ana María/);
  app.element('filterPerson').value = 'MARÍA';
  app.element('filterPerson').oninput();
  assert.match(app.element('detail').innerHTML, /Ana María/);
  assert.equal(app.element('detailTotal').textContent, '5.00');
  assert.doesNotMatch(app.element('detail').innerHTML, /<td>Ana<\/td>/);
  app.element('filterPerson').value = '';
  app.element('filterPerson').oninput();
  assert.match(app.element('detail').innerHTML, /<td>Ana<\/td>/);
  assert.match(app.element('detail').innerHTML, /Ana María/);
  assert.equal(app.element('detailTotal').textContent, '10.00');
  app.element('btnDetailsBack').onclick();
  const row = { dataset: { personIndex: '1' }, closest() { return this; } };
  let prevented = false;
  app.element('byPerson').onkeydown({ key: 'Enter', target: row, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(app.element('filterPerson').value, 'Ana María');
  app.element('btnDetailsBack').onclick();
  app.element('btnNewExpense').onclick();
  assert.match(app.element('savedPeople').innerHTML, /Ana/);
  assert.match(app.element('peopleRows').innerHTML, /<input[^>]+list="savedPeople"/);
  assert.doesNotMatch(app.element('peopleRows').innerHTML, /<select/);
  assert.match(app.element('peopleRows').innerHTML, /id="save-person-0" class="btn btn-secondary hidden"/);
  app.element('peopleRows').oninput({ target: { dataset: { person: '0' }, value: 'Ana' } });
  assert.equal(isHidden(app, 'save-person-0'), true);
  app.element('btnAdd').onclick();
  await flush();
  assert.equal(writes, 3);
  app.element('btnLogout').onclick();
  assert.equal(app.element('userName').textContent, '');
  assert.equal(app.element('savedPeople').innerHTML, '');
});

test('el tema se recuerda y las notificaciones desaparecen automáticamente', async () => {
  const app = setup();
  app.element('btnTheme').onclick();
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  assert.equal(app.preferences.get('pp_theme'), 'dark');
  app.element('peopleRows').onclick({ target: { dataset: { savePerson: '0' } } });
  await flush();
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
  assert.match(app.element('msg').textContent, /Sin conexión.*no se pudo confirmar/i);
  assert.equal(isHidden(app, 'expenseForm'), false);
  fail = false;
  app.element('btnSettings').onclick();
  app.element('configForm').onsubmit({ preventDefault() {} });
  await flush();
  app.element('btnAdd').onclick();
  await flush();
  const saved = XLSX.read(bytes);
  const rows = XLSX.utils.sheet_to_json(saved.Sheets.Pendientes);
  assert.deepEqual(rows.map((row) => row.Monto), [3, 7]);
  assert.equal(XLSX.utils.sheet_to_json(saved.Sheets.Gastos).length, 1);
});

test('previsualiza el reparto uniforme y coincide con los importes guardados', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'Gastos');
  let bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const fetch = async (url, opts = {}) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'id' }] }) };
    if (opts.method === 'PATCH') { bytes = opts.body; return { ok: true }; }
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic });
  await flush();
  app.element('btnNewExpense').onclick();
  assert.match(app.element('equalPreviewHint').textContent, /total válido/);
  app.element('total').value = '10';
  app.element('total').oninput();
  app.element('peopleRows').oninput({ target: { dataset: { person: '0' }, value: 'Ana' } });
  assert.match(app.element('equalPreviewList').innerHTML, /Ana: <strong>10\.00/);
  app.element('btnAddPerson').onclick();
  assert.equal(app.element('equalPreviewList').innerHTML, '');
  app.element('peopleRows').oninput({ target: { dataset: { person: '1' }, value: 'ana' } });
  assert.match(app.element('equalPreviewHint').textContent, /No repitas/);
  app.element('peopleRows').oninput({ target: { dataset: { person: '1' }, value: 'Luis' } });
  app.element('btnAddPerson').onclick();
  app.element('peopleRows').oninput({ target: { dataset: { person: '2' }, value: '<Eva>' } });
  assert.equal(app.element('equalPreviewList').innerHTML,
    '<li>Ana: <strong>3.34</strong></li><li>Luis: <strong>3.33</strong></li><li>&lt;Eva&gt;: <strong>3.33</strong></li>');
  app.element('total').value = '20';
  app.element('total').oninput();
  assert.match(app.element('equalPreviewList').innerHTML, /Ana: <strong>6\.67/);
  app.element('peopleRows').onclick({ target: { dataset: { removePerson: '1' } } });
  assert.match(app.element('equalPreviewList').innerHTML, /Ana: <strong>10\.00/);
  app.element('btnAddPerson').onclick();
  app.element('peopleRows').oninput({ target: { dataset: { person: '2' }, value: 'Luis' } });
  app.mode.value = 'manual';
  app.modeInputs[1].onchange();
  assert.equal(isHidden(app, 'equalPreview'), true);
  app.mode.value = 'equal';
  app.modeInputs[0].onchange();
  assert.equal(isHidden(app, 'equalPreview'), false);
  app.element('total').value = '10';
  app.element('total').oninput();
  assert.equal(app.element('equalPreviewList').innerHTML,
    '<li>Ana: <strong>3.34</strong></li><li>&lt;Eva&gt;: <strong>3.33</strong></li><li>Luis: <strong>3.33</strong></li>');
  app.element('desc').value = 'Comida';
  app.element('btnAdd').onclick();
  await flush();
  const saved = XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Pendientes);
  assert.deepEqual(saved.map((row) => [row.Persona, row.Monto]), [['Ana', 3.34], ['<Eva>', 3.33], ['Luis', 3.33]]);
  app.element('btnAnotherExpense').onclick();
  assert.equal(app.element('equalPreviewList').innerHTML, '');
  assert.match(app.element('equalPreviewHint').textContent, /total válido/);
});

test('recupera borrador por cuenta y archivo, confirma salida y resume antes de guardar', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'Gastos');
  let bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  let account = '123';
  let fileId = 'file-a';
  let writes = 0;
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const fetch = async (url, opts = {}) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: account }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: fileId }] }) };
    if (opts.method === 'PATCH') { writes++; bytes = opts.body; return { ok: true }; }
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const first = setup({ ...activeSession, fileName: 'a.xlsx' }, fetch, { XLSX, Logic, localStorage });
  await flush();
  first.element('btnNewExpense').onclick();
  first.element('desc').value = 'Cena';
  first.element('desc').oninput();
  first.element('total').value = '10';
  first.element('total').oninput();
  first.element('fecha').value = '2026-03-15';
  first.element('fecha').oninput();
  first.element('peopleRows').oninput({ target: { dataset: { person: '0' }, value: 'Ana' } });
  first.element('btnAddPerson').onclick();
  first.element('peopleRows').oninput({ target: { dataset: { person: '1' }, value: 'Luis' } });
  first.mode.value = 'manual';
  first.modeInputs[1].onchange();
  first.element('manual').oninput({ target: { dataset: { i: '0' }, value: '4' } });
  first.element('manual').oninput({ target: { dataset: { i: '1' }, value: '6' } });
  first.element('cobrado').checked = true;
  first.element('cobrado').onchange();
  assert.ok(storage.has('pp_draft_123_file-a'));

  account = '456';
  const otherAccount = setup({ ...activeSession, fileName: 'a.xlsx' }, fetch, { XLSX, Logic, localStorage });
  await flush();
  otherAccount.element('btnNewExpense').onclick();
  assert.equal(otherAccount.element('desc').value, '');
  account = '123';
  fileId = 'file-b';
  const otherFile = setup({ ...activeSession, fileName: 'b.xlsx' }, fetch, { XLSX, Logic, localStorage });
  await flush();
  otherFile.element('btnNewExpense').onclick();
  assert.equal(otherFile.element('desc').value, '');

  fileId = 'file-a';
  const restored = setup({ ...activeSession, fileName: 'a.xlsx' }, fetch, { XLSX, Logic, localStorage });
  await flush();
  restored.element('btnNewExpense').onclick();
  assert.equal(restored.element('desc').value, 'Cena');
  assert.equal(restored.element('fecha').value, '2026-03-15');
  assert.equal(restored.element('cobrado').checked, true);
  assert.equal(restored.mode.value, 'manual');
  assert.match(restored.element('manual').innerHTML, /Ana.*value="4".*Luis.*value="6"/);
  let prompt = '';
  restored.window.confirm = (message) => { prompt = message; return false; };
  restored.element('btnExpenseBack').onclick();
  assert.match(prompt, /descartará el borrador/);
  assert.equal(isHidden(restored, 'newExpense'), false);
  assert.ok(storage.has('pp_draft_123_file-a'));
  restored.element('btnAdd').onclick();
  await flush();
  assert.match(prompt, /Descripción: Cena/);
  assert.match(prompt, /Fecha: 2026-03-15/);
  assert.match(prompt, /Total: 10\.00/);
  assert.match(prompt, /Estado: Cobrado/);
  assert.match(prompt, /División: Manual/);
  assert.match(prompt, /Ana: 4\.00\nLuis: 6\.00/);
  assert.equal(writes, 0);
  restored.window.confirm = () => true;
  restored.element('btnAdd').onclick();
  await flush();
  assert.equal(writes, 1);
  assert.equal(storage.has('pp_draft_123_file-a'), false);
  assert.deepEqual(XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Pendientes).map((p) => p.Monto), [4, 6]);
  restored.element('btnAnotherExpense').onclick();
  restored.element('desc').value = 'Cancelar';
  restored.element('desc').oninput();
  restored.element('btnExpenseBack').onclick();
  assert.equal(storage.has('pp_draft_123_file-a'), false);
  assert.equal(isHidden(restored, 'summary'), false);
});

test('un borrador recuperado tras respuesta perdida advierte del riesgo de duplicado', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'Gastos');
  let bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  let writes = 0;
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const fetch = async (url, opts = {}) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'id' }] }) };
    if (opts.method === 'PATCH') { writes++; bytes = opts.body; throw new Error('Tiempo agotado'); }
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const first = setup({ ...activeSession, fileName: 'a.xlsx' }, fetch, { XLSX, Logic, localStorage });
  await flush();
  first.element('btnNewExpense').onclick();
  first.element('desc').value = 'Cena';
  first.element('desc').oninput();
  first.element('total').value = '10';
  first.element('total').oninput();
  first.element('peopleRows').oninput({ target: { dataset: { person: '0' }, value: 'Ana' } });
  first.element('btnAdd').onclick();
  await flush();
  assert.equal(writes, 1);
  assert.equal(JSON.parse(storage.get('pp_draft_123_id')).uncertain, true);
  const restored = setup({ ...activeSession, fileName: 'a.xlsx' }, fetch, { XLSX, Logic, localStorage });
  await flush();
  restored.element('btnNewExpense').onclick();
  assert.match(restored.element('draftNotice').textContent, /pudo haberse completado/);
  let confirmations = 0;
  restored.window.confirm = () => ++confirmations === 1;
  restored.element('btnAdd').onclick();
  await flush();
  assert.equal(confirmations, 2);
  assert.equal(writes, 1);
});

test('avisa cuando el navegador no puede guardar o eliminar el borrador', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'Gastos');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const localStorage = {
    getItem: () => null,
    setItem() { throw new Error('Bloqueado'); },
    removeItem() { throw new Error('Bloqueado'); },
  };
  const fetch = async (url) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'id' }] }) };
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup({ ...activeSession, fileName: 'a.xlsx' }, fetch, { XLSX, Logic, localStorage });
  await flush();
  app.element('btnNewExpense').onclick();
  app.element('desc').value = 'Cena';
  app.element('desc').oninput();
  assert.match(app.element('draftNotice').textContent, /No se pudo guardar/);
  const prompts = [];
  app.window.confirm = (message) => { prompts.push(message); return prompts.length === 1; };
  app.element('btnExpenseBack').onclick();
  assert.equal(isHidden(app, 'newExpense'), false);
  assert.match(prompts[1], /podría reaparecer/i);
  app.window.confirm = () => true;
  app.element('btnExpenseBack').onclick();
  assert.equal(isHidden(app, 'summary'), false);
});

test('migra personas antiguas una sola vez y conserva la copia si Drive falla', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'Gastos');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Nombre: 'ANA' }]), 'Personas');
  let bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  let fail = true;
  const saved = new Map([['pp_people_123', '["ana","Luis","LUIS"]']]);
  const localStorage = {
    getItem: (key) => saved.get(key) || null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  };
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
  const app = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic, localStorage });
  await flush();
  assert.match(app.element('msg').textContent, /No se pudieron migrar/);
  assert.equal(saved.has('pp_people_123'), true);
  fail = false;
  app.element('configForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.equal(saved.has('pp_people_123'), false);
  assert.deepEqual(XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Personas).map((row) => row.Nombre), ['ANA', 'Luis']);
  assert.match(app.element('savedPeople').innerHTML, /Luis/);
  const otherBrowser = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic });
  await flush();
  assert.match(otherBrowser.element('savedPeople').innerHTML, /Luis/);
});

test('el total del resumen incluye solo pendientes y conserva los centavos', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'Gastos');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { ID: '1', Persona: 'Ana', Monto: 0.1, Estado: 'Pendiente' },
    { ID: '2', Persona: 'Luis', Monto: 0.2, Estado: 'Pendiente' },
    { ID: '3', Persona: 'Ana', Monto: 10, Estado: 'Cobrado' },
  ]), 'Pendientes');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const fetch = async (url) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'id' }] }) };
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic });
  await flush();
  assert.equal(app.element('pendingTotal').textContent, '0.30');
});

test('identifica personas guardadas y pendientes antiguos en resumen y detalle', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { ID: '1', Fecha: '2026-10-06', Descripcion: 'Un mes' },
    { ID: '2', Fecha: '2026-10-07', Descripcion: 'Reciente' },
    { ID: '3', Fecha: '2026-01-01', Descripcion: 'Cobrado' },
    { ID: '4', Fecha: '2026-02-30', Descripcion: 'Inválido' },
  ]), 'Gastos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { ID: '1', Persona: 'ANA', Monto: 5, Estado: 'Pendiente' },
    { ID: '2', Persona: 'ana', Monto: 2, Estado: 'Pendiente' },
    { ID: '2', Persona: 'Luis', Monto: 4, Estado: 'Pendiente' },
    { ID: '3', Persona: 'Luis', Monto: 2, Estado: 'Cobrado' },
    { ID: '4', Persona: 'Luis', Monto: 1, Estado: 'Pendiente' },
  ]), 'Pendientes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Nombre: 'Ana' }]), 'Personas');
  let bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const fetch = async (url, opts = {}) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'id' }] }) };
    if (opts.method === 'PATCH') { bytes = opts.body; return { ok: true }; }
    return { ok: true, arrayBuffer: async () => bytes };
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [2026, 10, 6])); }
  }
  const app = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic, Date: FixedDate });
  await flush();
  const summary = app.element('byPerson').innerHTML;
  assert.match(summary, /Ver pendientes de ANA\. Persona guardada\. Tiene pendientes de al menos un mes/);
  assert.match(summary, /person-indicator person-saved/);
  assert.match(summary, /Ver pendientes de Luis\. Persona no guardada/);
  assert.match(summary, /person-indicator person-unsaved/);
  assert.equal((summary.match(/badge-old/g) || []).length, 1);
  app.element('btnDetails').onclick();
  app.element('filterStatus').value = '';
  app.element('filterStatus').oninput();
  const details = app.element('detail').innerHTML;
  assert.equal((details.match(/class="old-payment"/g) || []).length, 1);
  assert.match(details, /class="old-payment"[^]*Un mes[^]*Al menos 1 mes pendiente/);
  assert.match(details, /<tr><td>2026-10-07<\/td><td>Reciente/);
  app.element('filterStatus').value = 'Pendiente';
  app.element('filterStatus').oninput();
  app.element('detail').onclick({ target: { dataset: { i: '0' } } });
  await flush();
  assert.doesNotMatch(app.element('byPerson').innerHTML, /badge-old/);
  assert.doesNotMatch(app.element('detail').innerHTML, /old-payment/);
  app.element('btnManagePeople').onclick();
  app.element('personList').onclick({ target: { dataset: { deletePerson: '0' } } });
  await flush();
  assert.match(app.element('byPerson').innerHTML, /Ver pendientes de ana\. Persona no guardada/);
  app.element('personName').value = 'LUIS';
  app.element('personForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.match(app.element('byPerson').innerHTML, /Ver pendientes de Luis\. Persona guardada/);
});

test('administra personas en Excel, evita duplicados y conserva pagos al eliminar', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ ID: '1', Fecha: '2026-01-01', Descripcion: 'Gasto', Total: 10 }]), 'Gastos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ ID: '1', Persona: 'aNa', Monto: 10, Estado: 'Pendiente' }]), 'Pendientes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Nombre: 'Ana' }]), 'Personas');
  let bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  let fail = false;
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
  app.element('btnManagePeople').onclick();
  assert.equal(isHidden(app, 'managePeople'), false);
  app.element('btnSettings').onclick();
  assert.equal(app.element('btnConfigBack').textContent, 'Volver a personas');
  app.element('btnConfigBack').onclick();
  assert.equal(isHidden(app, 'managePeople'), false);
  app.element('personName').value = 'Luis';
  app.element('personForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.match(app.element('personList').innerHTML, /Luis/);
  app.element('personName').value = ' ana ';
  app.element('personForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.match(app.element('msg').textContent, /ya está registrada/);
  app.element('personList').onclick({ target: { dataset: { editPerson: '0' } } });
  app.element('personName').value = 'luis';
  app.element('personForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.match(app.element('msg').textContent, /ya está registrada/);
  app.element('personName').value = 'María';
  fail = true;
  app.element('personForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.match(app.element('msg').textContent, /Sin conexión.*no se pudo confirmar/i);
  assert.match(app.element('personList').innerHTML, /Ana/);
  fail = false;
  app.element('btnSettings').onclick();
  app.element('configForm').onsubmit({ preventDefault() {} });
  await flush();
  app.element('btnManagePeople').onclick();
  app.element('personList').onclick({ target: { dataset: { editPerson: '0' } } });
  app.element('personName').value = 'María';
  app.element('personForm').onsubmit({ preventDefault() {} });
  await flush();
  let saved = XLSX.read(bytes);
  assert.equal(XLSX.utils.sheet_to_json(saved.Sheets.Personas)[0].Nombre, 'María');
  assert.equal(XLSX.utils.sheet_to_json(saved.Sheets.Pendientes)[0].Persona, 'María');
  app.element('personList').onclick({ target: { dataset: { deletePerson: '0' } } });
  await flush();
  saved = XLSX.read(bytes);
  assert.deepEqual(XLSX.utils.sheet_to_json(saved.Sheets.Personas).map((row) => row.Nombre), ['Luis']);
  assert.equal(XLSX.utils.sheet_to_json(saved.Sheets.Pendientes)[0].Persona, 'María');
  app.element('btnPeopleBack').onclick();
  assert.match(app.element('byPerson').innerHTML, /María/);
});

test('limpia solo cobros antiguos y conserva gastos con pagos y hojas adicionales', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { ID: '1', Descripcion: 'mixto' }, { ID: '2', Descripcion: 'antiguo' }, { ID: '3', Descripcion: 'reciente' },
  ]), 'Gastos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { ID: '1', Persona: 'Ana', Monto: 2, Estado: 'Cobrado', FechaCobro: '2026-01-01' },
    { ID: '1', Persona: 'Luis', Monto: 3, Estado: 'Pendiente' },
    { ID: '2', Persona: 'Ana', Monto: 4, Estado: 'Cobrado', FechaCobro: '2026-02-01' },
    { ID: '3', Persona: 'Ana', Monto: 5, Estado: 'Cobrado', FechaCobro: '2026-10-01' },
    { ID: '3', Persona: 'Luis', Monto: 6, Estado: 'Cobrado', FechaCobro: 'invalida' },
  ]), 'Pendientes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Datos'], ['conservar']]), 'Extra');
  let bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
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
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [2026, 10, 6])); }
  }
  const app = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic, Date: FixedDate });
  await flush();
  app.element('btnSettings').onclick();
  assert.equal(isHidden(app, 'btnCleanup'), false);
  let prompt = '';
  app.window.confirm = (message) => { prompt = message; return false; };
  app.element('btnCleanup').onclick();
  await flush();
  assert.match(prompt, /Archivo abierto: pagos\.xlsx/);
  assert.equal(XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Pendientes).length, 5);
  app.window.confirm = () => true;
  app.element('btnCleanup').onclick();
  await flush();
  assert.match(app.element('msg').textContent, /Sin conexión/);
  assert.equal(XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Pendientes).length, 5);
  fail = false;
  app.element('configForm').onsubmit({ preventDefault() {} });
  await flush();
  app.element('btnSettings').onclick();
  app.element('btnCleanup').onclick();
  await flush();
  const result = XLSX.read(bytes);
  assert.deepEqual(XLSX.utils.sheet_to_json(result.Sheets.Pendientes).map((row) => row.Persona), ['Luis', 'Ana', 'Luis']);
  assert.deepEqual(XLSX.utils.sheet_to_json(result.Sheets.Gastos).map((row) => row.ID), ['1', '3']);
  assert.equal(result.Sheets.Extra.A2.v, 'conservar');
  assert.match(app.element('msg').textContent, /2 cobros antiguos/);
});

test('reinicia únicamente los datos de la aplicación con confirmación y recupera errores', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ ID: '1', Fecha: '2026-01-01', Descripcion: 'Gasto', Total: 10 }]), 'Gastos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { ID: '1', Persona: 'Ana', Monto: 5, Estado: 'Pendiente' },
    { ID: '1', Persona: 'Luis', Monto: 5, Estado: 'Cobrado', FechaCobro: '2026-01-01' },
  ]), 'Pendientes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Nombre: 'Ana' }]), 'Personas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Datos'], ['conservar']]), 'Extra');
  let bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  let writes = 0;
  let fail = false;
  const fetch = async (url, opts = {}) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'id' }] }) };
    if (opts.method === 'PATCH') {
      writes++;
      if (fail) throw new Error('Sin conexión');
      bytes = opts.body;
      return { ok: true };
    }
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic });
  await flush();
  app.element('btnNewExpense').onclick();
  app.element('desc').value = 'Borrador';
  app.element('btnSettings').onclick();
  assert.equal(isHidden(app, 'btnResetWorkbook'), false);
  app.element('fileName').value = 'otro.xlsx';
  let prompt = '';
  app.window.confirm = (message) => { prompt = message; return false; };
  app.element('btnResetWorkbook').onclick();
  await flush();
  assert.match(prompt, /Archivo abierto: pagos\.xlsx/);
  assert.match(prompt, /pendientes y cobrados.*personas guardadas/i);
  assert.match(prompt, /respaldo manual/i);
  assert.equal(writes, 0);
  assert.equal(app.element('desc').value, 'Borrador');
  assert.equal(app.element('pendingTotal').textContent, '5.00');
  fail = true;
  app.window.confirm = () => true;
  app.element('btnResetWorkbook').onclick();
  await flush();
  assert.match(app.element('msg').textContent, /no se pudo confirmar/i);
  assert.equal(app.element('pendingTotal').textContent, '5.00');
  assert.match(app.element('savedPeople').innerHTML, /Ana/);
  assert.equal(app.element('desc').value, 'Borrador');
  assert.equal(XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Pendientes).length, 2);
  fail = false;
  app.element('fileName').value = 'pagos.xlsx';
  app.element('configForm').onsubmit({ preventDefault() {} });
  await flush();
  app.element('btnSettings').onclick();
  app.element('btnResetWorkbook').onclick();
  await flush();
  const result = XLSX.read(bytes);
  for (const name of ['Gastos', 'Pendientes', 'Personas']) {
    assert.deepEqual(XLSX.utils.sheet_to_json(result.Sheets[name]), []);
  }
  assert.equal(result.Sheets.Extra.A2.v, 'conservar');
  assert.equal(app.element('pendingTotal').textContent, '0.00');
  assert.equal(app.element('savedPeople').innerHTML, '');
  assert.equal(app.element('desc').value, '');
  assert.match(app.element('msg').textContent, /reiniciados/);
  const reopened = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic });
  await flush();
  assert.equal(reopened.element('pendingTotal').textContent, '0.00');
  assert.equal(reopened.element('savedPeople').innerHTML, '');
});

test('si falla el cobro no se registra en memoria ni en un guardado posterior', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ ID: '1', Fecha: '2026-01-01', Descripcion: 'Gasto' }]), 'Gastos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ ID: '1', Persona: 'Ana', Monto: 10, Estado: 'Pendiente' }]), 'Pendientes');
  let bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
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
  app.element('btnDetails').onclick();
  app.element('detail').onclick({ target: { dataset: { i: '0' } } });
  await flush();
  assert.match(app.element('msg').textContent, /Sin conexión/);
  assert.equal(app.element('pendingTotal').textContent, '10.00');
  fail = false;
  app.element('btnManagePeople').onclick();
  app.element('personName').value = 'Luis';
  app.element('personForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.match(app.element('msg').textContent, /resultado del guardado anterior es incierto/i);
  app.element('btnSettings').onclick();
  app.element('configForm').onsubmit({ preventDefault() {} });
  await flush();
  app.element('btnManagePeople').onclick();
  app.element('personName').value = 'Luis';
  app.element('personForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.equal(XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Pendientes)[0].Estado, 'Pendiente');
});

test('advierte desde 1000 pagos y pagina sin alterar el total filtrado', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ ID: '1', Fecha: '2026-01-01' }]), 'Gastos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Array.from({ length: 1000 }, (_, i) => ({
    ID: '1', Persona: `Persona ${i}`, Monto: 0.1, Estado: 'Pendiente',
  }))), 'Pendientes');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const fetch = async (url) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'id' }] }) };
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic });
  await flush();
  assert.equal(isHidden(app, 'largeDataWarning'), false);
  app.element('btnDetails').onclick();
  assert.equal(app.element('detailTotal').textContent, '100.00');
  assert.match(app.element('detailPageInfo').textContent, /Página 1 de 20/);
  assert.match(app.element('detail').innerHTML, /Persona 49/);
  assert.doesNotMatch(app.element('detail').innerHTML, /Persona 50/);
  app.element('btnDetailNext').onclick();
  assert.match(app.element('detailPageInfo').textContent, /Página 2 de 20/);
  assert.match(app.element('detail').innerHTML, /Persona 50/);
  assert.equal(app.element('detailTotal').textContent, '100.00');
  app.element('filterPerson').value = 'Persona 99';
  app.element('filterPerson').oninput();
  assert.match(app.element('detailPageInfo').textContent, /Página 1 de 1/);
  assert.equal(app.element('detailTotal').textContent, '1.10');
});

test('recuerda el orden, pagina resultados ordenados y cobra el registro correcto', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Array.from({ length: 55 }, (_, i) => ({
    ID: String(i), Fecha: i === 54 ? '2025-01-01' : '2026-01-01', Descripcion: `Gasto ${i}`,
  }))), 'Gastos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Array.from({ length: 55 }, (_, i) => ({
    ID: String(i), Persona: `Persona ${i}`, Monto: i + 1, Estado: 'Pendiente',
  }))), 'Pendientes');
  let bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const fetch = async (url, opts = {}) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'id' }] }) };
    if (opts.method === 'PATCH') { bytes = opts.body; return { ok: true }; }
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic, localStorage });
  await flush();
  app.element('btnDetails').onclick();
  assert.equal(app.element('sortPayments').value, 'date-asc');
  assert.ok(app.element('detail').innerHTML.indexOf('Gasto 54') < app.element('detail').innerHTML.indexOf('Gasto 0'));
  app.element('btnDetailNext').onclick();
  assert.match(app.element('detailPageInfo').textContent, /Página 2 de 2/);
  app.element('sortPayments').value = 'amount-desc';
  app.element('sortPayments').onchange();
  assert.equal(storage.get('pp_payment_sort'), 'amount-desc');
  assert.match(app.element('detailPageInfo').textContent, /Página 1 de 2/);
  assert.ok(app.element('detail').innerHTML.indexOf('Gasto 54') < app.element('detail').innerHTML.indexOf('Gasto 53'));
  assert.equal(app.element('detailTotal').textContent, '1540.00');
  app.element('detail').onclick({ target: { dataset: { i: '54' } } });
  await flush();
  const saved = XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Pendientes);
  assert.equal(saved[54].Estado, 'Cobrado');
  assert.equal(saved[0].Estado, 'Pendiente');
  const reopened = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic, localStorage });
  await flush();
  reopened.element('btnDetails').onclick();
  assert.equal(reopened.element('sortPayments').value, 'amount-desc');
  assert.match(reopened.element('detail').innerHTML, /Gasto 53/);
  assert.doesNotMatch(reopened.element('detail').innerHTML, /Gasto 54/);
  reopened.element('filterPerson').value = 'Persona 1';
  reopened.element('filterPerson').oninput();
  assert.equal(reopened.element('sortPayments').value, 'amount-desc');
  assert.ok(reopened.element('detail').innerHTML.indexOf('Gasto 19') < reopened.element('detail').innerHTML.indexOf('Gasto 18'));
});

test('avisa cuando no puede recordar el orden en el navegador', () => {
  const localStorage = {
    getItem() { return null; },
    setItem() { throw new Error('Bloqueado'); },
  };
  const app = setup(undefined, undefined, { localStorage });
  app.element('sortPayments').value = 'date-desc';
  app.element('sortPayments').onchange();
  assert.equal(app.element('sortPayments').value, 'date-desc');
  assert.match(app.element('msg').textContent, /No se pudo recordar el orden/);
});

test('impide sobrescribir un cobro aceptado por Drive cuando se pierde la respuesta', async () => {
  const XLSX = require('@e965/xlsx');
  const Logic = require('../logic');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ ID: '1', Fecha: '2026-01-01' }]), 'Gastos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ ID: '1', Persona: 'Ana', Monto: 10, Estado: 'Pendiente' }]), 'Pendientes');
  let bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  let writes = 0;
  const fetch = async (url, opts = {}) => {
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: '123' }) };
    if (url.includes('?q=')) return { ok: true, json: async () => ({ files: [{ id: 'id' }] }) };
    if (opts.method === 'PATCH') {
      writes++;
      bytes = opts.body;
      if (writes === 1) throw new Error('Tiempo agotado');
      return { ok: true };
    }
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const app = setup({ ...activeSession, fileName: 'pagos.xlsx' }, fetch, { XLSX, Logic });
  await flush();
  app.element('btnDetails').onclick();
  app.element('detail').onclick({ target: { dataset: { i: '0' } } });
  await flush();
  assert.match(app.element('msg').textContent, /no se pudo confirmar/i);
  app.element('btnManagePeople').onclick();
  app.element('personName').value = 'Luis';
  app.element('personForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.equal(writes, 1);
  app.element('btnSettings').onclick();
  app.element('configForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.equal(app.element('pendingTotal').textContent, '0.00');
  app.element('btnManagePeople').onclick();
  app.element('personName').value = 'Luis';
  app.element('personForm').onsubmit({ preventDefault() {} });
  await flush();
  assert.equal(writes, 2);
  assert.equal(XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Pendientes)[0].Estado, 'Cobrado');
});
