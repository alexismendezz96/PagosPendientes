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
  const DRAFT_KEY_PREFIX = 'pp_draft_';
  const THEME_KEY = 'pp_theme';
  const TOAST_MS = 4000;
  const MAX_FILE_NAME = 100;
  const REQUEST_TIMEOUT_MS = 20000;
  const LARGE_RECORD_COUNT = 1000;
  const DETAIL_PAGE_SIZE = 50;

  const $ = (id) => document.getElementById(id);
  const today = () => {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  };

  let session = loadSession();
  let gastos = [];
  let pendientes = [];
  let workbookLoaded = false;
  let workbook = null;
  let saveUncertain = false;
  let toastTimer = null;
  let exactPerson = null;
  let detailPage = 0;
  let savedPeople = [];
  let personRows = [''];
  let personAmounts = [''];
  let currentView = 'summary';
  let editingPerson = null;
  let busy = false;
  let draftUncertain = false;

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
    workbook = null;
    saveUncertain = false;
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
    show('btnCleanup', config && workbookLoaded);
    show('btnResetWorkbook', config && workbookLoaded);
    show('cleanupInfo', config && workbookLoaded);
  }
  function showAppView(view) {
    currentView = view;
    for (const id of ['summary', 'newExpense', 'details', 'managePeople']) show(id, id === view);
    showScreen({ app: true });
    if (view === 'summary') render();
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
  function workbookForSave() {
    requireXlsx();
    const source = workbook || XLSX.utils.book_new();
    const wb = { ...source, SheetNames: [...source.SheetNames], Sheets: { ...source.Sheets } };
    const replace = (name, data, header) => {
      wb.Sheets[name] = XLSX.utils.json_to_sheet(data, { header });
      if (!wb.SheetNames.includes(name)) wb.SheetNames.push(name);
    };
    replace('Gastos', gastos, ['ID', 'Fecha', 'Descripcion', 'Total']);
    replace('Pendientes', pendientes, ['ID', 'Persona', 'Monto', 'Estado', 'FechaCobro']);
    replace('Personas', savedPeople.map((name) => ({ Nombre: name })), ['Nombre']);
    return wb;
  }
  async function saveFile() {
    if (saveUncertain) throw new Error('El resultado del guardado anterior es incierto. Revisa el archivo en Drive y vuelve a abrirlo desde Configuración antes de guardar.');
    const wb = workbookForSave();
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    try {
      await api(`${DRIVE_UPLOAD}/${session.fileId}?uploadType=media`, {
        method: 'PATCH', headers: { 'Content-Type': XLSX_MIME }, body: bytes,
      });
    } catch (e) {
      if (!session.token) throw e;
      saveUncertain = true;
      throw new Error(`${e.message}. No se pudo confirmar si Drive guardó el cambio; revisa el archivo y vuelve a abrirlo desde Configuración.`);
    }
    workbook = wb;
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
    workbook = wb;
    saveUncertain = false;
  }

  // Abre (o crea si no existe) el archivo configurado y muestra la app.
  async function openWorkbook(fileName) {
    requireXlsx();
    const previous = { fileName: session.fileName, fileId: session.fileId, gastos, pendientes, savedPeople, workbook, saveUncertain };
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
        workbook = null;
        saveUncertain = false;
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
        workbook = previous.workbook;
        saveUncertain = saveUncertain || previous.saveUncertain;
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
  const expensePeople = () => people().map((name) => savedPeople.find((saved) => personKey(saved) === personKey(name)) || name);
  const draftKey = () => session.googleSub && session.fileId
    ? DRAFT_KEY_PREFIX + session.googleSub + '_' + session.fileId : null;
  function draftNotice(message) {
    $('draftNotice').textContent = message;
    show('draftNotice', !!message);
  }
  function expenseDraft() {
    return {
      description: $('desc').value, total: $('total').value, date: $('fecha').value,
      collected: !!$('cobrado').checked, mode: isManual() ? 'manual' : 'equal',
      people: [...personRows], amounts: [...personAmounts], uncertain: draftUncertain,
    };
  }
  function hasDraft(draft) {
    return !!(draft.description || draft.total || draft.date !== today() || draft.collected ||
      draft.mode !== 'equal' || draft.people.length !== 1 || draft.people.some((name) => name) ||
      draft.amounts.some((amount) => amount));
  }
  function saveDraft() {
    const key = draftKey();
    if (!key) {
      draftNotice('No se puede guardar el borrador en este navegador sin identificar la cuenta y el archivo.');
      return false;
    }
    try {
      const draft = expenseDraft();
      if (hasDraft(draft)) localStorage.setItem(key, JSON.stringify(draft));
      else localStorage.removeItem(key);
      draftNotice(draftUncertain ? 'El último guardado pudo haberse completado. Revisa el Excel antes de volver a guardar este borrador.' : hasDraft(draft) ? 'Borrador guardado solo en este navegador.' : '');
      return true;
    } catch (e) {
      draftNotice('No se pudo guardar o borrar el borrador en este navegador; podría no recuperarse correctamente.');
      return false;
    }
  }
  function removeDraft() {
    const key = draftKey();
    if (!key) return true;
    try { localStorage.removeItem(key); return true; }
    catch (e) {
      draftNotice('No se pudo borrar el borrador de este navegador.');
      return false;
    }
  }
  function restoreDraft() {
    resetExpense();
    const key = draftKey();
    if (!key) {
      draftNotice('No se puede recuperar el borrador sin identificar la cuenta y el archivo.');
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft.description !== 'string' || typeof draft.total !== 'string' ||
          typeof draft.date !== 'string' || typeof draft.collected !== 'boolean' ||
          !['equal', 'manual'].includes(draft.mode) || !Array.isArray(draft.people) ||
          !draft.people.length || draft.people.some((name) => typeof name !== 'string') ||
          !Array.isArray(draft.amounts) || draft.amounts.length !== draft.people.length ||
          draft.amounts.some((amount) => typeof amount !== 'string') || typeof draft.uncertain !== 'boolean') {
        throw new Error('Borrador inválido');
      }
      $('desc').value = draft.description;
      $('total').value = draft.total;
      $('fecha').value = draft.date;
      $('cobrado').checked = draft.collected;
      document.querySelector(`input[name=mode][value=${draft.mode}]`).checked = true;
      personRows = draft.people;
      personAmounts = draft.amounts;
      draftUncertain = draft.uncertain;
      renderPeople();
      renderManual();
      show('manual', isManual());
      renderEqualPreview();
      draftNotice(draftUncertain
        ? 'El último guardado pudo haberse completado. Revisa el Excel antes de volver a guardar este borrador.'
        : 'Borrador recuperado de este navegador.');
    } catch (e) {
      draftNotice('No se pudo recuperar el borrador de este navegador.');
    }
  }
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
      `<input id="person-${i}" type="text" maxlength="120" list="savedPeople" autocomplete="off" value="${esc(name)}" placeholder="Nombre de la persona" data-person="${i}">` +
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
    render();
    toast('Persona eliminada de la lista guardada.', true);
  }
  function resetExpense() {
    draftUncertain = false;
    draftNotice('');
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
    renderEqualPreview();
    show('expenseForm', true);
    show('expenseSaved', false);
    show('expenseActions', true);
    show('savedActions', false);
  }
  function renderManual() {
    $('manual').innerHTML = personRows.map((p, i) => p.trim() ?
      `<label>${esc(p.trim())} <input type="number" step="0.01" min="0" autocomplete="off" data-i="${i}" value="${esc(personAmounts[i])}"></label>` : '').join('');
  }
  function renderEqualPreview() {
    const manual = isManual();
    show('equalPreview', !manual);
    if (manual) return;
    const total = Number($('total').value);
    const names = people();
    if (!Number.isFinite(total) || total <= 0 || !names.length || names.length !== personRows.length) {
      $('equalPreviewHint').textContent = 'Ingresa un total válido y completa todas las personas para ver el reparto.';
      $('equalPreviewList').innerHTML = '';
      return;
    }
    if (new Set(names.map(personKey)).size !== names.length) {
      $('equalPreviewHint').textContent = 'No repitas la misma persona para ver el reparto.';
      $('equalPreviewList').innerHTML = '';
      return;
    }
    $('equalPreviewHint').textContent = 'Importe estimado por persona:';
    $('equalPreviewList').innerHTML = Logic.splitEqual(total, expensePeople())
      .map(({ persona, monto }) => `<li>${esc(persona)}: <strong>${monto.toFixed(2)}</strong></li>`).join('');
  }
  function badge(estado) {
    return `<span class="badge ${estado === 'Pendiente' ? 'badge-pending' : 'badge-done'}">${esc(estado)}</span>`;
  }
  function render() {
    const by = Logic.pendingByPerson(pendientes);
    const gastoById = Object.fromEntries(gastos.map((g) => [g.ID, g]));
    const cutoff = Logic.monthsBefore(new Date(), 1);
    const saved = new Set(savedPeople.map(personKey));
    const oldPeople = new Set(pendientes.filter((p) => Logic.oldPending(p, gastoById[p.ID] || {}, cutoff)).map((p) => personKey(p.Persona)));
    $('pendingTotal').textContent = Object.values(by).reduce((sum, amount) => Logic.round2(sum + amount), 0).toFixed(2);
    show('largeDataWarning', pendientes.length >= LARGE_RECORD_COUNT);
    $('byPerson').innerHTML = '<thead><tr><th>Persona</th><th>Pendiente</th></tr></thead><tbody>' +
      (Object.entries(by).map(([p, m], i) => {
        const registered = saved.has(personKey(p));
        const old = oldPeople.has(personKey(p));
        const status = registered ? 'Persona guardada' : 'Persona no guardada';
        const icon = registered ? '✓' : '!';
        return `<tr class="person-row-link" role="link" tabindex="0" data-person-index="${i}" aria-label="Ver pendientes de ${esc(p)}. ${status}${old ? '. Tiene pendientes de al menos un mes' : ''}"><td>` +
          `<span class="person-indicator ${registered ? 'person-saved' : 'person-unsaved'}" title="${status}" aria-hidden="true">${icon}</span> ${esc(p)}` +
          `${old ? ' <span class="badge badge-old">Pendiente de al menos 1 mes</span>' : ''}</td><td>${m.toFixed(2)}</td></tr>`;
      }).join('') ||
        '<tr><td colspan="2">Sin pendientes 🎉</td></tr>') + '</tbody>';
    renderDetails();
  }
  function renderDetails() {
    const gastoById = Object.fromEntries(gastos.map((g) => [g.ID, g]));
    const cutoff = Logic.monthsBefore(new Date(), 1);
    const filters = { status: $('filterStatus').value, from: $('filterFrom').value, to: $('filterTo').value,
      collectedFrom: $('filterCollectedFrom').value, collectedTo: $('filterCollectedTo').value,
      person: $('filterPerson').value, exactPerson };
    const rows = pendientes.map((p, i) => ({ p, i, gasto: gastoById[p.ID] || {} }))
      .filter(({ p, gasto }) => Logic.matchesPayment(p, gasto, filters));
    $('detailTotal').textContent = rows.reduce((sum, { p }) => Logic.round2(sum + Number(p.Monto)), 0).toFixed(2);
    const pageCount = Math.max(1, Math.ceil(rows.length / DETAIL_PAGE_SIZE));
    detailPage = Math.min(detailPage, pageCount - 1);
    const pageRows = rows.slice(detailPage * DETAIL_PAGE_SIZE, (detailPage + 1) * DETAIL_PAGE_SIZE);
    $('detailPageInfo').textContent = `Página ${detailPage + 1} de ${pageCount} · ${rows.length} pagos`;
    $('btnDetailPrevious').disabled = detailPage === 0;
    $('btnDetailNext').disabled = detailPage >= pageCount - 1;
    $('detail').innerHTML = '<thead><tr><th>Fecha</th><th>Gasto</th><th>Persona</th><th>Monto</th><th>Estado</th><th>Fecha de cobro</th><th></th></tr></thead><tbody>' +
      (pageRows.map(({ p, i, gasto: g }) => {
        const action = p.Estado === 'Pendiente'
          ? `<button class="btn btn-secondary btn-small" data-i="${i}" type="button">Marcar cobrado</button>`
          : p.Estado === 'Cobrado' ? `<button class="btn btn-secondary btn-small" data-undo="${i}" type="button">Revertir cobro</button>` : '';
        const old = Logic.oldPending(p, g, cutoff);
        return `<tr${old ? ' class="old-payment"' : ''}><td>${esc(g.Fecha || '')}</td><td>${esc(g.Descripcion || '')}</td><td>${esc(p.Persona)}</td>` +
          `<td>${Number(p.Monto).toFixed(2)}</td><td>${badge(p.Estado)}${old ? ' <span class="badge badge-old">Al menos 1 mes pendiente</span>' : ''}</td><td>${esc(p.FechaCobro || '')}</td><td>${action}</td></tr>`;
      }).join('') || '<tr><td colspan="7">No hay pagos que coincidan con los filtros.</td></tr>') + '</tbody>';
  }
  function openDetails(person = null) {
    detailPage = 0;
    $('filterStatus').value = 'Pendiente';
    $('filterFrom').value = '';
    $('filterTo').value = '';
    $('filterCollectedFrom').value = '';
    $('filterCollectedTo').value = '';
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
    const names = expensePeople();
    const descripcion = $('desc').value.trim();
    if (!descripcion || !(total > 0)) throw new Error('Descripción y total válido son obligatorios.');
    if (!names.length || personRows.some((name) => !name.trim())) throw new Error('Completa el nombre de cada persona.');
    if (new Set(names.map(personKey)).size !== names.length) throw new Error('No repitas la misma persona en el gasto.');
    const parts = isManual()
      ? Logic.manualSplit(total, names.map((p, i) => ({ persona: p, monto: Number(personAmounts[i] || 0) })))
      : Logic.splitEqual(total, names);
    const fecha = $('fecha').value || today();
    const cobrado = $('cobrado').checked;
    const summary = parts.map(({ persona, monto }) => `${persona}: ${monto.toFixed(2)}`).join('\n');
    if (!window.confirm(`¿Guardar este gasto?\n\nDescripción: ${descripcion}\nFecha: ${fecha}\nTotal: ${Logic.round2(total).toFixed(2)}\nEstado: ${cobrado ? 'Cobrado' : 'Pendiente'}\nDivisión: ${isManual() ? 'Manual' : 'Uniforme'}\n\n${summary}`)) return;
    if (draftUncertain && !window.confirm('El guardado anterior pudo haberse completado. Revisa el Excel para evitar un duplicado. ¿Confirmas que quieres guardar de nuevo?')) return;
    const e = Logic.buildExpense({ descripcion, total, fecha, cobrado, parts });
    const wasUncertain = draftUncertain;
    draftUncertain = true;
    if (!saveDraft() && !window.confirm('No se pudo actualizar el borrador en este navegador. Si existe una copia anterior podría reaparecer; verifica el Excel antes de volver a guardarla. ¿Continuar?')) {
      draftUncertain = wasUncertain;
      return;
    }
    gastos.push(e.gasto);
    pendientes.push(...e.pendientes);
    try { await saveFile(); }
    catch (error) {
      gastos.pop();
      pendientes.splice(pendientes.length - e.pendientes.length, e.pendientes.length);
      throw error;
    }
    render();
    const draftRemoved = removeDraft();
    resetExpense();
    show('expenseForm', false);
    show('expenseSaved', true);
    show('expenseActions', false);
    show('savedActions', true);
    toast(draftRemoved ? 'Gasto guardado en Drive.' : 'Gasto guardado en Drive, pero no se pudo borrar el borrador del navegador. Revisa antes de volver a guardarlo.', draftRemoved);
  }
  async function collect(index) {
    const p = pendientes[index];
    const previous = pendientes;
    pendientes = pendientes.map((payment) => ({ ...payment }));
    Logic.markCollected(pendientes, p.ID, p.Persona, today());
    try { await saveFile(); }
    catch (e) { pendientes = previous; throw e; }
    render();
  }
  async function undoCollection(index) {
    if (!window.confirm('¿Revertir este cobro y volver a marcarlo como pendiente?')) return;
    const previous = pendientes;
    pendientes = pendientes.map((payment, i) => i === index ? { ...payment, Estado: 'Pendiente', FechaCobro: '' } : payment);
    try { await saveFile(); }
    catch (e) { pendientes = previous; throw e; }
    render();
    toast('Cobro revertido.', true);
  }
  async function cleanupCollected() {
    if (!workbookLoaded) throw new Error('Primero abre un archivo de Excel.');
    const cutoff = Logic.threeMonthsBefore(new Date());
    const removed = pendientes.filter((payment) => Logic.oldCollected(payment, cutoff));
    if (!removed.length) return toast('No hay cobros con más de tres meses para eliminar.');
    if (!window.confirm(`Archivo abierto: ${session.fileName}. Se eliminarán ${removed.length} cobros anteriores al ${cutoff} y los gastos que queden sin pagos. Esta acción no se puede deshacer desde la aplicación. Haz primero un respaldo manual del Excel en Drive. ¿Continuar?`)) return;
    const previousPayments = pendientes;
    const previousExpenses = gastos;
    const removedIds = new Set(removed.map((payment) => payment.ID));
    pendientes = pendientes.filter((payment) => !Logic.oldCollected(payment, cutoff));
    const remainingIds = new Set(pendientes.map((payment) => payment.ID));
    gastos = gastos.filter((expense) => !removedIds.has(expense.ID) || remainingIds.has(expense.ID));
    try { await saveFile(); }
    catch (e) { pendientes = previousPayments; gastos = previousExpenses; throw e; }
    render();
    toast(`Se eliminaron ${removed.length} cobros antiguos.`, true);
  }
  async function resetWorkbook() {
    if (!workbookLoaded) throw new Error('Primero abre un archivo de Excel.');
    if (!window.confirm(`Archivo abierto: ${session.fileName}. Se eliminarán todos los gastos, pagos pendientes y cobrados, y personas guardadas. Se descartarán los datos sin guardar del formulario de pago. Las hojas adicionales se conservarán en la medida en que la biblioteca de Excel lo permita. Esta acción no se puede deshacer desde la aplicación. Haz primero un respaldo manual del Excel en Drive. ¿Continuar?`)) return;
    const previousExpenses = gastos;
    const previousPayments = pendientes;
    const previousPeople = savedPeople;
    gastos = [];
    pendientes = [];
    savedPeople = [];
    try { await saveFile(); }
    catch (e) { gastos = previousExpenses; pendientes = previousPayments; savedPeople = previousPeople; throw e; }
    exactPerson = null;
    detailPage = 0;
    $('filterPerson').value = '';
    const draftRemoved = removeDraft();
    resetExpense();
    resetPersonEditor();
    renderSavedPeople();
    renderPersonManager();
    render();
    toast(draftRemoved ? 'Datos de la aplicación reiniciados en el Excel.' : 'Excel reiniciado, pero no se pudo borrar el borrador del navegador.', draftRemoved);
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
  $('btnCleanup').onclick = () => withBusy($('btnCleanup'), cleanupCollected);
  $('btnResetWorkbook').onclick = () => withBusy($('btnResetWorkbook'), resetWorkbook);
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
  ['filterStatus', 'filterFrom', 'filterTo', 'filterCollectedFrom', 'filterCollectedTo', 'filterPerson'].forEach((id) => {
    $(id).oninput = () => {
      if (id === 'filterPerson') exactPerson = null;
      detailPage = 0;
      renderDetails();
    };
  });
  $('btnDetailPrevious').onclick = () => { if (detailPage > 0) { detailPage--; renderDetails(); } };
  $('btnDetailNext').onclick = () => { detailPage++; renderDetails(); };
  $('btnTheme').onclick = () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); }
    catch (e) { toast('No se pudo recordar el tema en este navegador.'); }
  };
  $('btnNewExpense').onclick = () => { restoreDraft(); showAppView('newExpense'); };
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
  $('btnExpenseBack').onclick = () => {
    if (busy) return toast('Espera a que termine la operación en curso.');
    if (hasDraft(expenseDraft()) && !window.confirm('Hay un pago sin guardar. Si sales, se descartará el borrador. ¿Volver al resumen?')) return;
    if (!removeDraft() && !window.confirm('No se pudo borrar el borrador del navegador. Podría reaparecer más adelante. ¿Salir de todos modos?')) return;
    resetExpense();
    showAppView('summary');
  };
  $('configForm').onsubmit = (ev) => {
    ev.preventDefault();
    withBusy($('btnSave'), async () => openWorkbook(normalizeFileName($('fileName').value)));
  };
  $('btnAdd').onclick = () => withBusy($('btnAdd'), addExpense);
  $('btnAnotherExpense').onclick = resetExpense;
  $('btnSavedBack').onclick = () => showAppView('summary');
  $('desc').oninput = saveDraft;
  $('fecha').oninput = saveDraft;
  $('cobrado').onchange = saveDraft;
  $('total').oninput = () => { renderEqualPreview(); saveDraft(); };
  $('btnAddPerson').onclick = () => { personRows.push(''); personAmounts.push(''); renderPeople(); renderEqualPreview(); saveDraft(); };
  $('peopleRows').oninput = (ev) => {
    if (ev.target.dataset.person == null) return;
    const index = Number(ev.target.dataset.person);
    personRows[index] = ev.target.value;
    show('save-person-' + index, canSavePerson(ev.target.value));
    renderManual();
    renderEqualPreview();
    saveDraft();
  };
  $('peopleRows').onclick = (ev) => {
    const { savePerson: saveIndex, removePerson } = ev.target.dataset;
    if (removePerson != null) {
      personRows.splice(Number(removePerson), 1);
      personAmounts.splice(Number(removePerson), 1);
      renderPeople();
      renderManual();
      renderEqualPreview();
      saveDraft();
    } else if (saveIndex != null) {
      withBusy(ev.target, async () => { await savePerson(personRows[Number(saveIndex)]); renderPeople(); renderEqualPreview(); });
    }
  };
  $('manual').oninput = (ev) => {
    if (ev.target.dataset.i != null) { personAmounts[Number(ev.target.dataset.i)] = ev.target.value; saveDraft(); }
  };
  document.querySelectorAll('input[name=mode]').forEach((r) => {
    r.onchange = () => { show('manual', isManual()); renderManual(); renderEqualPreview(); saveDraft(); };
  });
  $('detail').onclick = (ev) => {
    const i = ev.target.dataset.i;
    if (i != null) withBusy(ev.target, () => collect(Number(i)));
    else if (ev.target.dataset.undo != null) withBusy(ev.target, () => undoCollection(Number(ev.target.dataset.undo)));
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
