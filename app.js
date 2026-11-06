const SCOPES = 'https://www.googleapis.com/auth/drive openid email profile';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const $ = (id) => document.getElementById(id);
const cfg = JSON.parse(localStorage.getItem('pp_cfg') || '{}');
let token = null, tokenClient = null, gastos = [], pendientes = [];

function msg(t, ok) { $('msg').textContent = t || ''; $('msg').className = ok ? 'ok' : ''; }
function fileIdFrom(ref) {
  const m = /\/d\/([\w-]+)/.exec(ref) || /[?&]id=([\w-]+)/.exec(ref);
  return m ? m[1] : ref.trim();
}
async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error('Google API ' + r.status + ': ' + (await r.text()));
  return r;
}

// --- Excel en Drive ---
async function loadFile() {
  const r = await api(`https://www.googleapis.com/drive/v3/files/${cfg.fileId}?alt=media`);
  const wb = XLSX.read(await r.arrayBuffer());
  gastos = wb.Sheets.Gastos ? XLSX.utils.sheet_to_json(wb.Sheets.Gastos, { raw: false }) : [];
  pendientes = wb.Sheets.Pendientes ? XLSX.utils.sheet_to_json(wb.Sheets.Pendientes, { raw: false }) : [];
  pendientes.forEach((p) => { p.Monto = Number(p.Monto); });
}
function workbookBytes() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gastos, { header: ['ID', 'Fecha', 'Descripcion', 'Total'] }), 'Gastos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendientes, { header: ['ID', 'Persona', 'Monto', 'Estado', 'FechaCobro'] }), 'Pendientes');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
async function saveFile() {
  await api(`https://www.googleapis.com/upload/drive/v3/files/${cfg.fileId}?uploadType=media`, {
    method: 'PATCH', headers: { 'Content-Type': XLSX_MIME }, body: workbookBytes(),
  });
}
async function createFile() {
  gastos = []; pendientes = [];
  const meta = await api('https://www.googleapis.com/drive/v3/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'PagosPendientes.xlsx', mimeType: XLSX_MIME }),
  });
  cfg.fileId = (await meta.json()).id;
  await saveFile();
  $('fileRef').value = cfg.fileId;
  persist();
}
function persist() { localStorage.setItem('pp_cfg', JSON.stringify(cfg)); }

// --- Login ---
function initAuth() {
  if (!cfg.clientId || !window.google) return false;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: cfg.clientId, scope: SCOPES,
    callback: async (resp) => {
      if (resp.error) return msg('Error de inicio de sesión: ' + resp.error);
      token = resp.access_token;
      try {
        const u = await (await api('https://www.googleapis.com/oauth2/v3/userinfo')).json();
        $('user').textContent = ' ' + (u.email || '');
        $('config').classList.remove('hidden');
        if (cfg.fileId) await openApp();
        else msg('Asocia un archivo de Drive en Configuración.');
      } catch (e) { msg(e.message); }
    },
  });
  return true;
}
async function openApp() {
  await loadFile();
  $('app').classList.remove('hidden');
  render();
  msg('Archivo cargado desde Drive.', true);
}

// --- UI ---
const people = () => $('people').value.split(',').map((s) => s.trim()).filter(Boolean);
function renderManual() {
  $('manual').innerHTML = people().map((p, i) =>
    `<label>${p.replace(/[<&]/g, '')} <input type="number" step="0.01" min="0" data-i="${i}"></label>`).join('');
}
function render() {
  const by = Logic.pendingByPerson(pendientes);
  $('byPerson').innerHTML = '<tr><th>Persona</th><th>Pendiente</th></tr>' +
    Object.entries(by).map(([p, m]) => `<tr><td>${esc(p)}</td><td>${m.toFixed(2)}</td></tr>`).join('');
  const desc = Object.fromEntries(gastos.map((g) => [g.ID, g]));
  $('detail').innerHTML = '<tr><th>Fecha</th><th>Gasto</th><th>Persona</th><th>Monto</th><th>Estado</th><th></th></tr>' +
    pendientes.map((p, i) => { const g = desc[p.ID] || {};
      return `<tr><td>${esc(g.Fecha || '')}</td><td>${esc(g.Descripcion || '')}</td><td>${esc(p.Persona)}</td><td>${Number(p.Monto).toFixed(2)}</td><td>${esc(p.Estado)}</td>` +
        `<td>${p.Estado === 'Pendiente' ? `<button data-i="${i}">Marcar cobrado</button>` : ''}</td></tr>`; }).join('');
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const today = () => new Date().toISOString().slice(0, 10);

$('btnLogin').onclick = () => {
  cfg.clientId = $('clientId').value.trim() || cfg.clientId;
  if (!cfg.clientId) { $('config').classList.remove('hidden'); return msg('Ingresa primero el Client ID en Configuración.'); }
  persist();
  if (initAuth()) tokenClient.requestAccessToken({ prompt: 'consent' });
};
$('btnSave').onclick = async () => {
  try {
    cfg.clientId = $('clientId').value.trim(); cfg.fileId = fileIdFrom($('fileRef').value);
    if (!cfg.fileId) return msg('Indica el archivo de Drive.');
    persist(); await openApp();
  } catch (e) { msg(e.message); }
};
$('btnCreate').onclick = async () => { try { await createFile(); await openApp(); } catch (e) { msg(e.message); } };
$('people').oninput = renderManual;
document.querySelectorAll('input[name=mode]').forEach((r) => r.onchange = () => {
  const manual = document.querySelector('input[name=mode]:checked').value === 'manual';
  $('manual').classList.toggle('hidden', !manual); renderManual();
});
$('btnAdd').onclick = async () => {
  try {
    const total = Number($('total').value), names = people(), descr = $('desc').value.trim();
    if (!descr || !(total > 0)) return msg('Descripción y total válido son obligatorios.');
    const manual = document.querySelector('input[name=mode]:checked').value === 'manual';
    const parts = manual
      ? Logic.manualSplit(total, names.map((p, i) => ({ persona: p, monto: Number($('manual').querySelector(`[data-i="${i}"]`).value || 0) })))
      : Logic.splitEqual(total, names);
    const e = Logic.buildExpense({ descripcion: descr, total, fecha: $('fecha').value || today(), cobrado: $('cobrado').checked, parts });
    gastos.push(e.gasto); pendientes.push(...e.pendientes);
    await saveFile(); render(); msg('Gasto guardado en Drive.', true);
  } catch (err) { msg(err.message); }
};
$('detail').onclick = async (ev) => {
  const i = ev.target.dataset.i; if (i == null) return;
  const p = pendientes[i];
  Logic.markCollected(pendientes, p.ID, p.Persona, today());
  try { await saveFile(); render(); } catch (e) { msg(e.message); }
};

$('clientId').value = cfg.clientId || ''; $('fileRef').value = cfg.fileId || ''; $('fecha').value = today();
if (cfg.clientId) $('config').classList.remove('hidden');
