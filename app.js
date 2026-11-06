(function () {
  'use strict';

  const { GOOGLE_CLIENT_ID, DEFAULT_FILE_NAME } = window.APP_CONFIG;
  // drive.file: acceso únicamente a los archivos creados por esta app.
  const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
  const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const SESSION_KEY = 'pp_session';
  const FILE_KEY_PREFIX = 'pp_file_';
  const PEOPLE_KEY_PREFIX = 'pp_people_';
  const THEME_KEY = 'pp_theme';
  const TOAST_MS = 4000;
  const MAX_FILE_NAME = 100;
  const REQUEST_TIMEOUT_MS = 20000;

  const $ = (id) => document.getElementById(id);
  const today = () => {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  };

  let session = loadSession();
  let gastos = [];
  let pendientes = [];
  let workbookLoaded = false;
  let toastTimer = null;
  let exactPerson = null;
  let savedPeople = [];
  let personRows = [''];
  let personAmounts = [''];
  let currentView = 'summary';
  let editingPerson = null;
  let busy = false;

  // ---------- Sesión (sessionStorage: se borra al cerrar la pestaña) ----------
  function loadSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (!s || typeof s !== 'object') return {};
      if (s.token && s.expiresAt > Date.now()) return s;
      return {};
    } catch (e) {
      return {};
    }
  }
  function saveSession() { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  function filePreferenceKey() {
    return session.googleSub ? FILE_KEY_PREFIX + session.googleSub : null;
  }
  function readFilePreference() {
    const key = filePreferenceKey();
    if (!key) return '';
    try {
      return localStorage.getItem(key) || '';
    } catch (e) {
      toast('No se pudo recuperar el archivo guardado en este navegador.');
      return '';
    }
  }
  function saveFilePreference(fileName) {
    const key = filePreferenceKey();
    if (!key) return false;
    try {
      localStorage.setItem(key, fileName);
      return true;
    } catch (e) {
      return false;
    }
  }
  function clearSession() {
    session = {};
    workbookLoaded = false;
    sessionStorage.removeItem(SESSION_KEY);
    savedPeople = [];
    renderSavedPeople();
    resetExpense();
    $('userName').textContent = '';
    $('userEmail').textContent = '';
    $('userPhoto').removeAttribute('src');
    show('userPhoto', false);
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
    updateTopbarHeight();
    toastTimer = setTimeout(() => { el.classList.add('hidden'); updateTopbarHeight(); }, TOAST_MS);
  }
  function show(id, visible) { $(id).classList.toggle('hidden', !visible); }
  function showScreen({ login = false, config = false, app = false, loading = false }) {
    show('loading', loading);
    show('login', login);
    show('config', config);
    show('app', app);
    show('userBox', !login && !loading);
    show('btnSettings', !login && !loading);
    show('btnLogout', !login && !loading);
    show('btnConfigBack', config && workbookLoaded);
  }
  function showAppView(view) {
    currentView = view;
    for (const id of ['summary', 'newExpense', 'details', 'managePeople']) show(id, id === view);
    showScreen({ app: true });
  }
  function showUserPhoto(picture) {
    const photo = $('userPhoto');
    photo.removeAttribute('src');
    show('userPhoto', false);
    if (typeof picture !== 'string') return;
    try {
      const url = new URL(picture);
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !url.hostname.endsWith('.googleusercontent.com')) return;
      photo.src = url.href;
      show('userPhoto', true);
    } catch (e) {
      return;
    }
  }
  async function withBusy(button, task) {
    if (busy) return toast('Espera a que termine la operación en curso.');
    busy = true;
    button.disabled = true;
    try { await task(); } catch (e) { toast(e.message); } finally { button.disabled = false; busy = false; }
  }

  // ---------- Google Drive ----------
  async function api(url, opts = {}) {
    const r = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...opts, headers: { Authorization: 'Bearer ' + session.token, ...(opts.headers || {}) } });
    if (r.status === 401) {
      clearSession();
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
  function requireXlsx() {
    if (typeof XLSX === 'undefined') {
      throw new Error('No se pudo cargar la librería de Excel (SheetJS). Desactiva el bloqueador de anuncios o rastreadores para este sitio y recarga la página.');
    }
  }
  function workbookBytes() {
    requireXlsx();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gastos, { header: ['ID', 'Fecha', 'Descripcion', 'Total'] }), 'Gastos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendientes, { header: ['ID', 'Persona', 'Monto', 'Estado', 'FechaCobro'] }), 'Pendientes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(savedPeople.map((name) => ({ Nombre: name })), { header: ['Nombre'] }), 'Personas');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }
  async function saveFile() {
    await api(`${DRIVE_UPLOAD}/${session.fileId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': XLSX_MIME }, body: workbookBytes(),
    });
  }
  async function loadFile() {
    requireXlsx();
    const r = await api(`${DRIVE_API}/${session.fileId}?alt=media`);
    const wb = XLSX.read(await r.arrayBuffer());
    const rows = (name) => (wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { raw: false }) : []);
    gastos = rows('Gastos');
    pendientes = rows('Pendientes');
    pendientes.forEach((p) => { p.Monto = Number(p.Monto); });
    savedPeople = rows('Personas').map((row) => String(row.Nombre || '').trim()).filter(Boolean);
  }

  // Abre (o crea si no existe) el archivo configurado y muestra la app.
  async function openWorkbook(fileName) {
    requireXlsx();
    const previous = { fileName: session.fileName, fileId: session.fileId, gastos, pendientes, savedPeople };
    let migrationWarning = '';
    try {
      session.fileName = fileName;
      session.fileId = await findFileId(fileName);
      if (session.fileId) {
        await loadFile();
      } else {
        gastos = [];
        pendientes = [];
        savedPeople = [];
        session.fileId = await createFile(fileName);
        await saveFile();
      }
      migrationWarning = await migratePeople();
      saveSession();
    } catch (e) {
      if (session.token) {
        session.fileName = previous.fileName;
        session.fileId = previous.fileId;
        gastos = previous.gastos;
        pendientes = previous.pendientes;
        savedPeople = previous.savedPeople;
      }
      throw e;
    }
    workbookLoaded = true;
    renderSavedPeople();
    render();
    showAppView('summary');
    if (migrationWarning) toast(migrationWarning);
    else if (saveFilePreference(fileName)) toast('Archivo listo en Drive.', true);
    else toast('Archivo listo en Drive, pero no se pudo recordar en este navegador.');
    if (migrationWarning) saveFilePreference(fileName);
  }

  // ---------- Autenticación (Google Identity Services) ----------
  function onTokenResponse(resp) {
    if (resp.error) return toast('No se pudo iniciar sesión con Google.');
    if (!(resp.scope || '').includes('drive.file')) return toast('Se requiere el permiso de Drive para continuar.');
    session = { token: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) - 30) * 1000 };
    return enterAfterLogin();
  }
  async function enterAfterLogin() {
    let accountLoaded = false;
    showScreen({ loading: true });
    try {
      const u = await (await api('https://www.googleapis.com/oauth2/v3/userinfo')).json();
      session.email = u.email || '';
      session.name = typeof u.name === 'string' ? u.name : '';
      session.googleSub = typeof u.sub === 'string' && /^\d+$/.test(u.sub) ? u.sub : '';
      session.fileName = session.fileName || readFilePreference();
      saveSession();
      $('userEmail').textContent = session.email;
      $('userName').textContent = session.name;
      showUserPhoto(u.picture);
      $('fileName').value = session.fileName || DEFAULT_FILE_NAME;
      accountLoaded = true;
      if (session.fileName) await openWorkbook(session.fileName);
      else showScreen({ config: true });
    } catch (e) {
      showScreen(session.token && accountLoaded ? { config: true } : { login: true });
      toast(e.message);
    }
  }
  function onPopupError(error) {
    if (error && error.type === 'popup_failed_to_open') {
      return toast('El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para este sitio e inténtalo de nuevo.');
    }
    toast('La ventana de Google se cerró antes de completar el inicio de sesión.');
  }
  function login() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      return toast('No se pudo cargar Google. Revisa tu conexión y desactiva bloqueadores de anuncios o rastreadores para este sitio.');
    }
    try {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID, scope: SCOPES, callback: onTokenResponse,
        error_callback: onPopupError,
      });
      tokenClient.requestAccessToken();
    } catch (e) {
      toast('No se pudo iniciar sesión con Google.');
    }
  }
  function logout() {
    if (session.token && window.google) google.accounts.oauth2.revoke(session.token);
    clearSession();
    gastos = [];
    pendientes = [];
    showScreen({ login: true });
  }

  // ---------- Render ----------
  const people = () => personRows.map((s) => s.trim()).filter(Boolean);
  const isManual = () => document.querySelector('input[name=mode]:checked').value === 'manual';

  const personKey = (name) => Logic.personKey(name);
  async function migratePeople() {
    if (!session.googleSub) return '';
    const key = PEOPLE_KEY_PREFIX + session.googleSub;
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch (e) { return 'No se pudo acceder a las personas guardadas anteriormente en el navegador.'; }
    if (!raw) return '';
    let legacy;
    try { legacy = JSON.parse(raw); }
    catch (e) { return 'No se pudo leer la lista anterior de personas; permanece en el navegador.'; }
    if (!Array.isArray(legacy) || legacy.some((name) => typeof name !== 'string' || !name.trim())) {
      return 'La lista anterior de personas no es válida; permanece en el navegador.';
    }
    const known = new Set(savedPeople.map(personKey));
    const additions = legacy.map((name) => name.trim()).filter((name) => {
      const keyName = personKey(name);
      if (known.has(keyName)) return false;
      known.add(keyName);
      return true;
    });
    if (additions.length) {
      savedPeople = [...savedPeople, ...additions];
      try { await saveFile(); }
      catch (e) { throw new Error('No se pudieron migrar las personas al Excel: ' + e.message); }
    }
    try { localStorage.removeItem(key); }
    catch (e) { return 'Las personas se guardaron en el Excel, pero no se pudo borrar la copia del navegador.'; }
    return '';
  }
  function renderSavedPeople() {
    $('savedPeople').innerHTML = savedPeople.map((name) => `<option value="${esc(name)}"></option>`).join('');
  }
  function renderPeople() {
    $('peopleRows').innerHTML = personRows.map((name, i) =>
      `<div class="person-row"><label class="sr-only" for="person-${i}">Persona ${i + 1}</label>` +
      `<input id="person-${i}" type="text" maxlength="120" list="savedPeople" value="${esc(name)}" placeholder="Nombre de la persona" data-person="${i}">` +
      `<button id="save-person-${i}" class="btn btn-secondary${canSavePerson(name) ? '' : ' hidden'}" type="button" data-save-person="${i}">Guardar persona</button>` +
      (personRows.length > 1 ? `<button class="btn btn-secondary btn-icon" type="button" data-remove-person="${i}" title="Eliminar persona" aria-label="Eliminar persona">×</button>` : '') +
      '</div>').join('');
  }
  function canSavePerson(name) {
    return !!name.trim() && !savedPeople.some((saved) => personKey(saved) === personKey(name));
  }
  function renderPersonManager() {
    $('personList').innerHTML = '<thead><tr><th>Persona</th><th>Acciones</th></tr></thead><tbody>' +
      (savedPeople.map((name, i) => `<tr><td>${esc(name)}</td><td><div class="person-actions"><button type="button" class="btn btn-secondary btn-small" data-edit-person="${i}">Modificar</button><button type="button" class="btn btn-secondary btn-small" data-delete-person="${i}">Eliminar</button></div></td></tr>`).join('') ||
      '<tr><td colspan="2">No hay personas guardadas.</td></tr>') + '</tbody>';
  }
  function resetPersonEditor() {
    editingPerson = null;
    $('personName').value = '';
    $('btnPersonSave').textContent = 'Agregar persona';
    show('btnPersonCancel', false);
  }
  async function savePerson(name, index = null) {
    name = name.trim();
    if (!name) throw new Error('Escribe el nombre de la persona.');
    if (name.length > 120) throw new Error('El nombre es demasiado largo.');
    if (savedPeople.some((p, i) => i !== index && personKey(p) === personKey(name))) throw new Error('La persona ya está registrada.');
    const previousPeople = savedPeople;
    const previousPayments = pendientes;
    if (index === null) savedPeople = [...savedPeople, name];
    else {
      const original = savedPeople[index];
      savedPeople = savedPeople.map((p, i) => i === index ? name : p);
      pendientes = pendientes.map((p) => personKey(String(p.Persona || '')) === personKey(original) ? { ...p, Persona: name } : p);
    }
    try { await saveFile(); }
    catch (e) { savedPeople = previousPeople; pendientes = previousPayments; throw e; }
    if (index !== null && exactPerson !== null && personKey(exactPerson) === personKey(previousPeople[index])) {
      exactPerson = name;
      $('filterPerson').value = name;
    }
    renderSavedPeople();
    renderPersonManager();
    render();
    toast('Persona guardada en el Excel.', true);
  }
  async function deletePerson(index) {
    const name = savedPeople[index];
    if (!window.confirm(`¿Eliminar a ${name} de las personas guardadas? Sus pagos no se eliminarán.`)) return;
    const previous = savedPeople;
    savedPeople = savedPeople.filter((_, i) => i !== index);
    try { await saveFile(); }
    catch (e) { savedPeople = previous; throw e; }
    resetPersonEditor();
    renderSavedPeople();
    renderPersonManager();
    toast('Persona eliminada de la lista guardada.', true);
  }
  function resetExpense() {
    $('desc').value = '';
    $('total').value = '';
    $('fecha').value = today();
    $('cobrado').checked = false;
    document.querySelector('input[name=mode][value=equal]').checked = true;
    personRows = [''];
    personAmounts = [''];
    renderPeople();
    $('manual').innerHTML = '';
    show('manual', false);
    show('expenseForm', true);
    show('expenseSaved', false);
    show('expenseActions', true);
    show('savedActions', false);
  }
  function renderManual() {
    $('manual').innerHTML = personRows.map((p, i) => p.trim() ?
      `<label>${esc(p.trim())} <input type="number" step="0.01" min="0" data-i="${i}" value="${esc(personAmounts[i])}"></label>` : '').join('');
  }
  function badge(estado) {
    return `<span class="badge ${estado === 'Pendiente' ? 'badge-pending' : 'badge-done'}">${esc(estado)}</span>`;
  }
  function render() {
    const by = Logic.pendingByPerson(pendientes);
    $('byPerson').innerHTML = '<thead><tr><th>Persona</th><th>Pendiente</th></tr></thead><tbody>' +
      (Object.entries(by).map(([p, m], i) => `<tr class="person-row-link" role="link" tabindex="0" data-person-index="${i}" aria-label="Ver pendientes de ${esc(p)}"><td>${esc(p)}</td><td>${m.toFixed(2)}</td></tr>`).join('') ||
        '<tr><td colspan="2">Sin pendientes 🎉</td></tr>') + '</tbody>';
    renderDetails();
  }
  function renderDetails() {
    const gastoById = Object.fromEntries(gastos.map((g) => [g.ID, g]));
    const filters = { status: $('filterStatus').value, from: $('filterFrom').value, to: $('filterTo').value,
      person: $('filterPerson').value, exactPerson };
    const rows = pendientes.map((p, i) => ({ p, i, gasto: gastoById[p.ID] || {} }))
      .filter(({ p, gasto }) => Logic.matchesPayment(p, gasto, filters));
    $('detail').innerHTML = '<thead><tr><th>Fecha</th><th>Gasto</th><th>Persona</th><th>Monto</th><th>Estado</th><th></th></tr></thead><tbody>' +
      (rows.map(({ p, i, gasto: g }) => {
        const action = p.Estado === 'Pendiente'
          ? `<button class="btn btn-secondary btn-small" data-i="${i}" type="button">Marcar cobrado</button>` : '';
        return `<tr><td>${esc(g.Fecha || '')}</td><td>${esc(g.Descripcion || '')}</td><td>${esc(p.Persona)}</td>` +
          `<td>${Number(p.Monto).toFixed(2)}</td><td>${badge(p.Estado)}</td><td>${action}</td></tr>`;
      }).join('') || '<tr><td colspan="6">No hay pagos que coincidan con los filtros.</td></tr>') + '</tbody>';
  }
  function openDetails(person = null) {
    $('filterStatus').value = 'Pendiente';
    $('filterFrom').value = '';
    $('filterTo').value = '';
    $('filterPerson').value = person || '';
    exactPerson = person;
    renderDetails();
    showAppView('details');
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const label = theme === 'dark' ? 'Activar tema claro' : 'Activar tema oscuro';
    $('btnTheme').title = label;
    $('btnTheme').setAttribute('aria-label', label);
    $('btnTheme').firstElementChild.textContent = theme === 'dark' ? '☀' : '☾';
  }

  // ---------- Acciones ----------
  async function addExpense() {
    const total = Number($('total').value);
    const names = people().map((name) => savedPeople.find((saved) => personKey(saved) === personKey(name)) || name);
    const descripcion = $('desc').value.trim();
    if (!descripcion || !(total > 0)) throw new Error('Descripción y total válido son obligatorios.');
    if (!names.length || personRows.some((name) => !name.trim())) throw new Error('Completa el nombre de cada persona.');
    if (new Set(names.map(personKey)).size !== names.length) throw new Error('No repitas la misma persona en el gasto.');
    const parts = isManual()
      ? Logic.manualSplit(total, names.map((p, i) => ({ persona: p, monto: Number(personAmounts[i] || 0) })))
      : Logic.splitEqual(total, names);
    const e = Logic.buildExpense({ descripcion, total, fecha: $('fecha').value || today(), cobrado: $('cobrado').checked, parts });
    gastos.push(e.gasto);
    pendientes.push(...e.pendientes);
    try { await saveFile(); }
    catch (error) {
      gastos.pop();
      pendientes.splice(pendientes.length - e.pendientes.length, e.pendientes.length);
      throw error;
    }
    render();
    resetExpense();
    show('expenseForm', false);
    show('expenseSaved', true);
    show('expenseActions', false);
    show('savedActions', true);
    toast('Gasto guardado en Drive.', true);
  }
  async function collect(index) {
    const p = pendientes[index];
    Logic.markCollected(pendientes, p.ID, p.Persona, today());
    await saveFile();
    render();
  }

  // ---------- Eventos ----------
  $('btnLogin').onclick = login;
  $('btnLogout').onclick = logout;
  $('userPhoto').onerror = () => {
    $('userPhoto').removeAttribute('src');
    show('userPhoto', false);
  };
  $('btnSettings').onclick = () => {
    $('fileName').value = session.fileName || DEFAULT_FILE_NAME;
    $('btnConfigBack').textContent = {
      summary: 'Volver al resumen',
      newExpense: 'Volver al nuevo pago',
      details: 'Volver a pendientes',
      managePeople: 'Volver a personas',
    }[currentView];
    showScreen({ config: true });
  };
  $('btnConfigBack').onclick = () => { if (workbookLoaded) showAppView(currentView); };
  $('btnDetails').onclick = () => openDetails();
  function openPersonDetails(target) {
    const row = target.closest('[data-person-index]');
    if (!row) return;
    const person = Object.keys(Logic.pendingByPerson(pendientes))[Number(row.dataset.personIndex)];
    if (person !== undefined) openDetails(person);
  }
  $('byPerson').onclick = (ev) => openPersonDetails(ev.target);
  $('byPerson').onkeydown = (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const row = ev.target.closest('[data-person-index]');
    if (!row) return;
    ev.preventDefault();
    openPersonDetails(row);
  };
  ['filterStatus', 'filterFrom', 'filterTo', 'filterPerson'].forEach((id) => {
    $(id).oninput = () => {
      if (id === 'filterPerson') exactPerson = null;
      renderDetails();
    };
  });
  $('btnTheme').onclick = () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); }
    catch (e) { toast('No se pudo recordar el tema en este navegador.'); }
  };
  $('btnNewExpense').onclick = () => { resetExpense(); showAppView('newExpense'); };
  $('btnManagePeople').onclick = () => { resetPersonEditor(); renderPersonManager(); showAppView('managePeople'); };
  $('btnPeopleBack').onclick = () => showAppView('summary');
  $('btnPersonCancel').onclick = resetPersonEditor;
  $('personForm').onsubmit = (ev) => {
    ev.preventDefault();
    withBusy($('btnPersonSave'), async () => { await savePerson($('personName').value, editingPerson); resetPersonEditor(); });
  };
  $('personList').onclick = (ev) => {
    const { editPerson, deletePerson: removePerson } = ev.target.dataset;
    if (editPerson != null) {
      editingPerson = Number(editPerson);
      $('personName').value = savedPeople[editingPerson];
      $('btnPersonSave').textContent = 'Guardar cambios';
      show('btnPersonCancel', true);
      $('personName').focus();
    } else if (removePerson != null) withBusy(ev.target, () => deletePerson(Number(removePerson)));
  };
  $('btnDetailsBack').onclick = () => showAppView('summary');
  $('btnExpenseBack').onclick = () => showAppView('summary');
  $('configForm').onsubmit = (ev) => {
    ev.preventDefault();
    withBusy($('btnSave'), async () => openWorkbook(normalizeFileName($('fileName').value)));
  };
  $('btnAdd').onclick = () => withBusy($('btnAdd'), addExpense);
  $('btnAnotherExpense').onclick = resetExpense;
  $('btnSavedBack').onclick = () => showAppView('summary');
  $('btnAddPerson').onclick = () => { personRows.push(''); personAmounts.push(''); renderPeople(); };
  $('peopleRows').oninput = (ev) => {
    if (ev.target.dataset.person == null) return;
    const index = Number(ev.target.dataset.person);
    personRows[index] = ev.target.value;
    show('save-person-' + index, canSavePerson(ev.target.value));
    renderManual();
  };
  $('peopleRows').onclick = (ev) => {
    const { savePerson: saveIndex, removePerson } = ev.target.dataset;
    if (removePerson != null) {
      personRows.splice(Number(removePerson), 1);
      personAmounts.splice(Number(removePerson), 1);
      renderPeople();
      renderManual();
    } else if (saveIndex != null) {
      withBusy(ev.target, async () => { await savePerson(personRows[Number(saveIndex)]); renderPeople(); });
    }
  };
  $('manual').oninput = (ev) => {
    if (ev.target.dataset.i != null) personAmounts[Number(ev.target.dataset.i)] = ev.target.value;
  };
  document.querySelectorAll('input[name=mode]').forEach((r) => {
    r.onchange = () => { show('manual', isManual()); renderManual(); };
  });
  $('detail').onclick = (ev) => {
    const i = ev.target.dataset.i;
    if (i != null) withBusy(ev.target, () => collect(Number(i)));
  };

  // ---------- Inicio ----------
  const topbar = $('topbar');
  const updateTopbarHeight = () => document.documentElement.style.setProperty('--topbar-height', Math.ceil(topbar.getBoundingClientRect().height) + 'px');
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updateTopbarHeight).observe(topbar);
  window.addEventListener('resize', updateTopbarHeight);
  updateTopbarHeight();
  let theme;
  try { theme = localStorage.getItem(THEME_KEY); }
  catch (e) { toast('No se pudo recuperar el tema guardado en este navegador.'); }
  setTheme(theme === 'dark' || theme === 'light' ? theme :
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('filterStatus').value = 'Pendiente';
  resetExpense();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('No se pudo registrar la aplicación instalable:', e));
  }
  if (session.token) enterAfterLogin();
  else showScreen({ login: true });
  window.appReady = true;
})();
