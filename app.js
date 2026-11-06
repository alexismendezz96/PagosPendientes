(function () {
  'use strict';

  const { DEFAULT_FILE_NAME } = window.APP_CONFIG;
  // drive.file: acceso únicamente a los archivos creados por esta app.
  const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
  const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const SESSION_KEY = 'pp_session';
  const TOAST_MS = 4000;
  const MAX_FILE_NAME = 100;

  const $ = (id) => document.getElementById(id);
  const today = () => new Date().toISOString().slice(0, 10);

  let session = loadSession();
  let gastos = [];
  let pendientes = [];
  let toastTimer = null;

  // ---------- Sesión (sessionStorage: se borra al cerrar la pestaña) ----------
  function loadSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (!s || typeof s !== 'object') return {};
      if (s.token && s.expiresAt > Date.now()) return s;
      return typeof s.clientId === 'string' ? { clientId: s.clientId } : {};
    } catch (e) {
      return {};
    }
  }
  function saveSession() { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  function clearSession() { session = {}; sessionStorage.removeItem(SESSION_KEY); }
  function expireSession() {
    session = session.clientId ? { clientId: session.clientId } : {};
    saveSession();
  }

  // ---------- Utilidades UI ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(text, ok) {
    const el = $('msg');
    clearTimeout(toastTimer);
    el.textContent = text;
    el.className = 'toast' + (ok ? ' ok' : '');
    toastTimer = setTimeout(() => el.classList.add('hidden'), TOAST_MS);
  }
  function show(id, visible) { $(id).classList.toggle('hidden', !visible); }
  function showScreen({ login = false, config = false, app = false }) {
    show('login', login);
    show('config', config);
    show('app', app);
    show('userBox', !login);
  }
  async function withBusy(button, task) {
    button.disabled = true;
    try { await task(); } catch (e) { toast(e.message); } finally { button.disabled = false; }
  }

  // ---------- Google Drive ----------
  async function api(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + session.token, ...(opts.headers || {}) } });
    if (r.status === 401) {
      expireSession();
      showScreen({ login: true });
      throw new Error('La sesión expiró. Inicia sesión nuevamente.');
    }
    if (!r.ok) throw new Error('Error de Google Drive (' + r.status + ')');
    return r;
  }

  function normalizeFileName(raw) {
    const name = raw.trim().replace(/[\u0000-\u001f\\/]/g, '');
    if (!name) throw new Error('Indica el nombre del archivo.');
    if (name.length > MAX_FILE_NAME) throw new Error('El nombre es demasiado largo.');
    return /\.xlsx$/i.test(name) ? name : name + '.xlsx';
  }
  const escapeDriveQuery = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function findFileId(name) {
    const q = `name='${escapeDriveQuery(name)}' and trashed=false`;
    const r = await api(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
    const { files } = await r.json();
    return files.length ? files[0].id : null;
  }
  async function createFile(name) {
    const r = await api(DRIVE_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: XLSX_MIME }),
    });
    return (await r.json()).id;
  }
  function workbookBytes() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gastos, { header: ['ID', 'Fecha', 'Descripcion', 'Total'] }), 'Gastos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendientes, { header: ['ID', 'Persona', 'Monto', 'Estado', 'FechaCobro'] }), 'Pendientes');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }
  async function saveFile() {
    await api(`${DRIVE_UPLOAD}/${session.fileId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': XLSX_MIME }, body: workbookBytes(),
    });
  }
  async function loadFile() {
    const r = await api(`${DRIVE_API}/${session.fileId}?alt=media`);
    const wb = XLSX.read(await r.arrayBuffer());
    const rows = (name) => (wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { raw: false }) : []);
    gastos = rows('Gastos');
    pendientes = rows('Pendientes');
    pendientes.forEach((p) => { p.Monto = Number(p.Monto); });
  }

  // Abre (o crea si no existe) el archivo configurado y muestra la app.
  async function openWorkbook(fileName) {
    session.fileName = fileName;
    session.fileId = await findFileId(fileName);
    if (session.fileId) {
      await loadFile();
    } else {
      gastos = [];
      pendientes = [];
      session.fileId = await createFile(fileName);
      await saveFile();
    }
    saveSession();
    showScreen({ app: true, config: true });
    render();
    toast('Archivo listo en Drive.', true);
  }

  // ---------- Autenticación (Google Identity Services) ----------
  function onTokenResponse(resp) {
    if (resp.error) return toast('No se pudo iniciar sesión con Google.');
    if (!(resp.scope || '').includes('drive.file')) return toast('Se requiere el permiso de Drive para continuar.');
    session = { clientId: session.clientId, token: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) - 30) * 1000 };
    return enterAfterLogin();
  }
  async function enterAfterLogin() {
    try {
      const u = await (await api('https://www.googleapis.com/oauth2/v3/userinfo')).json();
      session.email = u.email || '';
      saveSession();
      $('userEmail').textContent = session.email;
      $('fileName').value = session.fileName || DEFAULT_FILE_NAME;
      showScreen({ config: true });
      if (session.fileName) await openWorkbook(session.fileName);
    } catch (e) { toast(e.message); }
  }
  function login() {
    const clientId = $('clientId').value.trim();
    if (!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      $('clientId').focus();
      return toast('Introduce un ID de cliente OAuth válido, no el secreto de cliente.');
    }
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      return toast('No se pudo cargar Google. Comprueba tu conexión e inténtalo de nuevo.');
    }
    session = { clientId };
    saveSession();
    try {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPES, callback: onTokenResponse,
        error_callback: () => toast('No se pudo abrir la ventana de Google o fue cerrada. Inténtalo de nuevo.'),
      });
      tokenClient.requestAccessToken();
    } catch (e) {
      toast('No se pudo iniciar sesión con Google. Comprueba el ID de cliente.');
    }
  }
  function logout() {
    if (session.token && window.google) google.accounts.oauth2.revoke(session.token);
    clearSession();
    $('clientId').value = '';
    gastos = [];
    pendientes = [];
    showScreen({ login: true });
  }

  // ---------- Render ----------
  const people = () => $('people').value.split(',').map((s) => s.trim()).filter(Boolean);
  const isManual = () => document.querySelector('input[name=mode]:checked').value === 'manual';

  function renderManual() {
    $('manual').innerHTML = people().map((p, i) =>
      `<label>${esc(p)} <input type="number" step="0.01" min="0" data-i="${i}"></label>`).join('');
  }
  function badge(estado) {
    return `<span class="badge ${estado === 'Pendiente' ? 'badge-pending' : 'badge-done'}">${esc(estado)}</span>`;
  }
  function render() {
    const by = Logic.pendingByPerson(pendientes);
    $('byPerson').innerHTML = '<thead><tr><th>Persona</th><th>Pendiente</th></tr></thead><tbody>' +
      (Object.entries(by).map(([p, m]) => `<tr><td>${esc(p)}</td><td>${m.toFixed(2)}</td></tr>`).join('') ||
        '<tr><td colspan="2">Sin pendientes 🎉</td></tr>') + '</tbody>';
    const gastoById = Object.fromEntries(gastos.map((g) => [g.ID, g]));
    $('detail').innerHTML = '<thead><tr><th>Fecha</th><th>Gasto</th><th>Persona</th><th>Monto</th><th>Estado</th><th></th></tr></thead><tbody>' +
      pendientes.map((p, i) => {
        const g = gastoById[p.ID] || {};
        const action = p.Estado === 'Pendiente'
          ? `<button class="btn btn-secondary btn-small" data-i="${i}" type="button">Marcar cobrado</button>` : '';
        return `<tr><td>${esc(g.Fecha || '')}</td><td>${esc(g.Descripcion || '')}</td><td>${esc(p.Persona)}</td>` +
          `<td>${Number(p.Monto).toFixed(2)}</td><td>${badge(p.Estado)}</td><td>${action}</td></tr>`;
      }).join('') + '</tbody>';
  }

  // ---------- Acciones ----------
  async function addExpense() {
    const total = Number($('total').value);
    const names = people();
    const descripcion = $('desc').value.trim();
    if (!descripcion || !(total > 0)) throw new Error('Descripción y total válido son obligatorios.');
    const parts = isManual()
      ? Logic.manualSplit(total, names.map((p, i) => ({ persona: p, monto: Number($('manual').querySelector(`[data-i="${i}"]`).value || 0) })))
      : Logic.splitEqual(total, names);
    const e = Logic.buildExpense({ descripcion, total, fecha: $('fecha').value || today(), cobrado: $('cobrado').checked, parts });
    gastos.push(e.gasto);
    pendientes.push(...e.pendientes);
    await saveFile();
    render();
    toast('Gasto guardado en Drive.', true);
  }
  async function collect(index) {
    const p = pendientes[index];
    Logic.markCollected(pendientes, p.ID, p.Persona, today());
    await saveFile();
    render();
  }

  // ---------- Eventos ----------
  $('loginForm').onsubmit = (ev) => { ev.preventDefault(); login(); };
  $('btnLogout').onclick = logout;
  $('configForm').onsubmit = (ev) => {
    ev.preventDefault();
    withBusy($('btnSave'), async () => openWorkbook(normalizeFileName($('fileName').value)));
  };
  $('btnAdd').onclick = () => withBusy($('btnAdd'), addExpense);
  $('people').oninput = renderManual;
  document.querySelectorAll('input[name=mode]').forEach((r) => {
    r.onchange = () => { show('manual', isManual()); renderManual(); };
  });
  $('detail').onclick = (ev) => {
    const i = ev.target.dataset.i;
    if (i != null) withBusy(ev.target, () => collect(Number(i)));
  };

  // ---------- Inicio ----------
  $('fecha').value = today();
  $('clientId').value = session.clientId || '';
  $('originHint').textContent = window.location.origin;
  if (session.token) enterAfterLogin();
  else showScreen({ login: true });
})();
