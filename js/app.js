/* ═══════════════════════════════════════════════════════════
   ImagineBC Bug Report — application logic
   Single-file vanilla JS app. No framework, no build step.
   Sections: Constants · State · Utils · GitHub API · Compression
             · PDF · Markdown · Views · Modals · Init
   ═══════════════════════════════════════════════════════════ */

/* ── Constants ─────────────────────────────────────────── */
const REPO_OWNER = 'ImagineBC';
const REPO_NAME = 'bug-report';
const SESSIONS_DIR = 'sessions';
const PASSWORD = 'Spurs!1111';

const STORAGE_KEYS = {
  sessions:      'ibc-bugreport.sessions',
  pat:           'ibc-bugreport.pat',
  defaultTester: 'ibc-bugreport.defaultTester',
  theme:         'ibc-bugreport.theme',
  unlocked:      'ibc-bugreport.unlocked',
};

const CATEGORIES = [
  'Visual glitch', 'Functional UI bug', 'Data issue',
  'Backend error', 'Mobile/responsive', 'Copy/translation', 'Performance'
];
const SEVERITIES = ['Blocker', 'Major', 'Minor', 'Cosmetic'];

/* ── State ─────────────────────────────────────────────── */
const state = {
  sessions: {},          // { [id]: Session } — local (drafts + closed copies)
  remoteSessions: {},    // { [id]: { meta only, fetched on dashboard } }
  remoteShas: {},        // { [id]: sha for conflict detection on overwrite }
  activeSessionId: null,
  filter: 'all',
  pat: null,
  defaultTester: '',
  view: 'dashboard',
};

/* ── Utils ─────────────────────────────────────────────── */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uuid() {
  // RFC4122-ish v4. Crypto.randomUUID is preferred but old browsers may lack it.
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function shortId(id) { return id.slice(0, 8); }

function nowISO() { return new Date().toISOString(); }

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function loadLocal(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.error('localStorage write failed', e); toast('Could not save locally — storage may be full.', 'error'); }
}
function clearLocal(key) { localStorage.removeItem(key); }

function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3500);
}

/* ── GitHub API ────────────────────────────────────────── */
const GH = {
  base: `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`,

  headers(authed = false) {
    const h = { 'Accept': 'application/vnd.github+json' };
    if (authed && state.pat) h['Authorization'] = `Bearer ${state.pat}`;
    return h;
  },

  async listSessions() {
    // Anonymous read works on public repos. 60 req/hr is plenty.
    const url = `${this.base}/contents/${SESSIONS_DIR}`;
    const res = await fetch(url, { headers: this.headers(!!state.pat) });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`GitHub list failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data.filter(f => f.type === 'file' && f.name.endsWith('.json'));
  },

  async getSession(filename) {
    const url = `${this.base}/contents/${SESSIONS_DIR}/${filename}`;
    const res = await fetch(url, { headers: this.headers(!!state.pat) });
    if (!res.ok) throw new Error(`GitHub get failed: ${res.status}`);
    const data = await res.json();
    // download_url is faster than base64-decoding 'content', and avoids the 1MB limit on Contents API.
    const fileRes = await fetch(data.download_url);
    if (!fileRes.ok) throw new Error(`GitHub download failed: ${fileRes.status}`);
    return { json: await fileRes.json(), sha: data.sha };
  },

  async putSession(filename, sessionObj, sha = null) {
    if (!state.pat) throw new Error('No PAT configured. Open Settings to add one.');
    const url = `${this.base}/contents/${SESSIONS_DIR}/${filename}`;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(sessionObj, null, 2))));
    const body = {
      message: `Bug report: ${sessionObj.testerName} — ${shortId(sessionObj.id)}`,
      content,
      branch: 'main',
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, { method: 'PUT', headers: { ...this.headers(true), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub PUT failed: ${res.status}`);
    }
    const data = await res.json();
    return { sha: data.content.sha };
  },

  async testAuth() {
    if (!state.pat) throw new Error('No PAT set');
    const res = await fetch(`${this.base}`, { headers: this.headers(true) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Auth check failed: ${res.status}`);
    }
    const data = await res.json();
    return { name: data.full_name, permissions: data.permissions };
  }
};

/* ── Image compression ─────────────────────────────────── */
async function compressImage(fileOrBlob, maxWidth = 1600, quality = 0.8) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(fileOrBlob);
  });
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Image decode failed'));
    im.src = dataUrl;
  });
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const compressed = canvas.toDataURL('image/jpeg', quality);
  return { dataUrl: compressed, width: w, height: h, bytes: Math.round((compressed.length - 22) * 3 / 4) };
}

/* ── PDF generation ────────────────────────────────────── */
async function generatePDF(session, opts = { saveAs: true }) {
  // html2pdf produces a zero-height canvas when the source element is
  // position:absolute (regardless of left/top). It needs the source in
  // NORMAL document flow to compute pagination correctly. The wrap
  // pattern: outer wrapper is position:fixed off-screen and invisible
  // (so it doesn't affect page layout), inner .pdf-render stays in
  // normal flow within the wrap.
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:fixed;top:0;left:-99999px;width:7.4in;visibility:hidden;pointer-events:none;z-index:-1;';
  const div = document.createElement('div');
  div.className = 'pdf-render';
  div.innerHTML = renderPDFHTML(session);
  wrap.appendChild(div);
  document.body.appendChild(wrap);

  // One frame + small delay so any embedded base64 screenshots layout.
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 80)));

  try {
    const filename = `bug-report_${session.testerName.replace(/\s+/g, '-')}_${formatDateShort(session.startedAt).replace(/[\s,]+/g, '-')}_${shortId(session.id)}.pdf`;
    const opt = {
      margin: [0.4, 0.4, 0.4, 0.4],
      filename,
      image: { type: 'jpeg', quality: 0.92 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };
    if (opts.saveAs) await html2pdf().set(opt).from(div).save();
    return { filename };
  } finally {
    wrap.remove();
  }
}

function renderPDFHTML(session) {
  const findings = session.findings || [];
  const findingsHTML = findings.length === 0
    ? `<p><em>No findings logged in this session.</em></p>`
    : findings.map((f, i) => `
      <div class="pdf-finding">
        <h3>${i + 1}. ${escapeHtml(f.where || '(no location)')}</h3>
        <div class="pdf-finding-tags">
          <span class="pdf-tag">${escapeHtml(f.category || '—')}</span>
          <span class="pdf-tag">${escapeHtml(f.severity || '—')}</span>
          ${f.authContext ? `<span class="pdf-tag">${escapeHtml(f.authContext)}</span>` : ''}
        </div>
        <div class="pdf-section-label">Steps to reproduce</div>
        <div>${escapeHtml(f.stepsToRepro || '').replace(/\n/g, '<br>')}</div>
        ${f.expected ? `<div class="pdf-section-label">Expected</div><div>${escapeHtml(f.expected).replace(/\n/g, '<br>')}</div>` : ''}
        ${f.actual ? `<div class="pdf-section-label">Actual</div><div>${escapeHtml(f.actual).replace(/\n/g, '<br>')}</div>` : ''}
        ${f.consoleErrors ? `<div class="pdf-section-label">Console errors</div><pre>${escapeHtml(f.consoleErrors)}</pre>` : ''}
        ${f.screenshot ? `<img src="${f.screenshot}" alt="Screenshot for finding ${i + 1}">` : ''}
      </div>
    `).join('');

  return `
    <h1>Bug Report — Testing Session</h1>
    <div class="pdf-meta">
      <dl>
        <dt>Tester</dt><dd>${escapeHtml(session.testerName)}</dd>
        <dt>Started</dt><dd>${formatDate(session.startedAt)}</dd>
        ${session.closedAt ? `<dt>Closed</dt><dd>${formatDate(session.closedAt)}</dd>` : ''}
        <dt>Status</dt><dd>${escapeHtml(session.status || 'open')}</dd>
        <dt>Findings</dt><dd>${findings.length}</dd>
        <dt>Session ID</dt><dd style="font-family: 'SF Mono', Consolas, monospace">${escapeHtml(session.id)}</dd>
      </dl>
    </div>
    ${session.notes ? `<h2>Session notes</h2><p>${escapeHtml(session.notes).replace(/\n/g, '<br>')}</p>` : ''}
    <h2>Findings (${findings.length})</h2>
    ${findingsHTML}
  `;
}

/* ── Session model helpers ─────────────────────────────── */
function newSession(testerName, notes = '') {
  return {
    id: uuid(),
    testerName,
    notes: notes || '',
    status: 'open',
    startedAt: nowISO(),
    closedAt: null,
    findings: [],
    schema: 1,
  };
}

function newFinding() {
  return {
    id: uuid(),
    category: '',
    severity: '',
    where: '',
    stepsToRepro: '',
    expected: '',
    actual: '',
    consoleErrors: '',
    authContext: '',
    screenshot: null,           // base64 data URL
    screenshotMeta: null,       // { width, height, bytes }
    createdAt: nowISO(),
  };
}

function persistSession(session) {
  state.sessions[session.id] = session;
  saveLocal(STORAGE_KEYS.sessions, state.sessions);
}

function removeLocalSession(id) {
  delete state.sessions[id];
  saveLocal(STORAGE_KEYS.sessions, state.sessions);
}

/* ── View rendering ────────────────────────────────────── */
function showView(name) {
  state.view = name;
  $$('.view').forEach(v => v.hidden = true);
  const target = $(`#view-${name}`);
  if (target) target.hidden = false;
}

async function renderDashboard() {
  showView('dashboard');
  const list = $('#sessions-list');
  $('#dashboard-empty').hidden = true;
  $('#dashboard-loading').hidden = false;
  list.innerHTML = '';

  // Fetch remote (best-effort)
  let remoteEntries = [];
  try {
    const files = await GH.listSessions();
    // Lazy-load full sessions in parallel; cap at 30 for snappiness.
    const fetched = await Promise.all(
      files.slice(0, 60).map(async f => {
        try {
          const { json, sha } = await GH.getSession(f.name);
          state.remoteShas[json.id] = sha;
          state.remoteSessions[json.id] = json;
          return json;
        } catch { return null; }
      })
    );
    remoteEntries = fetched.filter(Boolean);
  } catch (e) {
    console.warn('Remote fetch failed (anonymous rate limit or repo not yet public):', e.message);
  }

  // Merge: prefer LOCAL when both exist (you may be editing a reopened version).
  const merged = {};
  remoteEntries.forEach(s => { merged[s.id] = { ...s, _source: 'remote' }; });
  Object.values(state.sessions).forEach(s => { merged[s.id] = { ...s, _source: 'local' }; });

  let entries = Object.values(merged).sort((a, b) =>
    new Date(b.startedAt) - new Date(a.startedAt)
  );

  if (state.filter !== 'all') entries = entries.filter(s => s.status === state.filter);

  $('#dashboard-loading').hidden = true;
  if (entries.length === 0) {
    $('#dashboard-empty').hidden = false;
    return;
  }

  list.innerHTML = entries.map(s => {
    const findings = s.findings || [];
    const isLocalOnly = s._source === 'local' && !state.remoteSessions[s.id];
    const statusClass = s.status === 'open' ? 'status-open' : 'status-closed';
    const statusLabel = s.status === 'open' ? 'Open' : 'Closed';
    return `
      <article class="session-card" data-session-id="${s.id}">
        <span class="session-card-status ${statusClass}">${statusLabel}</span>
        <h3 class="session-card-title">${escapeHtml(s.testerName) || 'Untitled'}${isLocalOnly ? ' <span class="session-card-status status-local" style="position: static; display: inline-block; margin-left: 0.4rem;">Local draft</span>' : ''}</h3>
        <p class="session-card-meta">${formatDate(s.startedAt)}${s.closedAt ? ' → ' + formatDate(s.closedAt) : ''}</p>
        ${s.notes ? `<p class="session-card-meta" style="margin-top: 0.4rem; font-style: italic; color: var(--text-secondary);">${escapeHtml(s.notes)}</p>` : ''}
        <div class="session-card-stats">
          <span><strong>${findings.length}</strong> finding${findings.length === 1 ? '' : 's'}</span>
          <span class="mono" style="font-size: 0.75rem; color: var(--text-dim);">${shortId(s.id)}</span>
        </div>
      </article>
    `;
  }).join('');

  $$('.session-card').forEach(card => {
    card.addEventListener('click', () => openSession(card.dataset.sessionId));
  });
}

async function openSession(id) {
  let session = state.sessions[id];
  if (!session) {
    // Pull from remote
    if (state.remoteSessions[id]) {
      session = state.remoteSessions[id];
    } else {
      toast('Session not found.', 'error');
      return;
    }
  }
  state.activeSessionId = id;
  renderSessionView();
}

function renderSessionView() {
  const s = state.sessions[state.activeSessionId] || state.remoteSessions[state.activeSessionId];
  if (!s) { renderDashboard(); return; }

  showView('session');

  $('#session-status-label').textContent = s.status === 'open' ? 'Open Session' : 'Closed Session';
  $('#session-title').textContent = s.testerName ? `${s.testerName}'s Testing Session` : 'Testing Session';
  $('#session-tester').textContent = s.testerName || '—';
  $('#session-started').textContent = formatDate(s.startedAt);
  $('#session-closed').textContent = s.closedAt ? formatDate(s.closedAt) : '—';
  $('#session-id').textContent = s.id;
  $('#session-notes').value = s.notes || '';

  const isOpen = s.status === 'open';
  $('#add-finding-btn').hidden = !isOpen;
  $('#save-session-btn').hidden = !isOpen;
  $('#finalize-session-btn').hidden = !isOpen;
  $('#reopen-session-btn').hidden = isOpen;
  $('#delete-session-btn').hidden = !state.sessions[s.id]; // only local copies are deletable here

  // Findings list
  const findings = s.findings || [];
  $('#findings-count').textContent = findings.length;
  const list = $('#findings-list');
  $('#findings-empty').hidden = findings.length > 0;

  list.innerHTML = findings.map((f, i) => {
    const sevClass = f.severity ? `tag-severity-${f.severity.toLowerCase()}` : '';
    return `
      <article class="finding-card" data-finding-id="${f.id}">
        ${f.screenshot
          ? `<img class="finding-thumb" src="${f.screenshot}" alt="Screenshot ${i + 1}">`
          : `<div class="finding-thumb-placeholder">No image</div>`}
        <div class="finding-body">
          <div class="finding-tags">
            ${f.category ? `<span class="tag">${escapeHtml(f.category)}</span>` : ''}
            ${f.severity ? `<span class="tag ${sevClass}">${escapeHtml(f.severity)}</span>` : ''}
          </div>
          <h3 class="finding-title">${escapeHtml(f.where) || '(unspecified location)'}</h3>
          <p class="finding-where">${escapeHtml((f.stepsToRepro || '').slice(0, 140))}${(f.stepsToRepro || '').length > 140 ? '…' : ''}</p>
        </div>
        <div class="finding-index">#${i + 1}</div>
      </article>
    `;
  }).join('');

  $$('.finding-card').forEach(card => {
    card.addEventListener('click', () => openFinding(card.dataset.findingId));
  });
}

/* ── Modals ────────────────────────────────────────────── */
function openModal(id) {
  $(`#${id}`).hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  if (id) $(`#${id}`).hidden = true;
  else $$('.modal').forEach(m => m.hidden = true);
  document.body.style.overflow = '';
}

function confirmDialog(title, body, okLabel = 'Confirm', danger = false) {
  return new Promise(resolve => {
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    const okBtn = $('#confirm-ok');
    okBtn.textContent = okLabel;
    okBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    openModal('modal-confirm');
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      $('#confirm-cancel').removeEventListener('click', onCancel);
      $('#modal-confirm .modal-backdrop').removeEventListener('click', onCancel);
      closeModal('modal-confirm');
    }
    okBtn.addEventListener('click', onOk, { once: true });
    $('#confirm-cancel').addEventListener('click', onCancel, { once: true });
    $('#modal-confirm .modal-backdrop').addEventListener('click', onCancel, { once: true });
  });
}

/* ── Finding modal ─────────────────────────────────────── */
let pendingScreenshot = null; // { dataUrl, meta }

function openFinding(findingId) {
  const session = state.sessions[state.activeSessionId];
  if (!session || session.status !== 'open') {
    toast('Reopen the session to edit findings.');
    return;
  }
  const finding = (session.findings || []).find(f => f.id === findingId);
  if (!finding) return;
  setFindingFormValues(finding);
  $('#finding-modal-title').textContent = `Edit Finding — #${session.findings.indexOf(finding) + 1}`;
  $('#finding-delete-btn').hidden = false;
  openModal('modal-finding');
}

function openNewFinding() {
  const session = state.sessions[state.activeSessionId];
  if (!session || session.status !== 'open') {
    toast('Reopen the session to add findings.');
    return;
  }
  setFindingFormValues(newFinding());
  $('#finding-modal-title').textContent = `Add Finding`;
  $('#finding-delete-btn').hidden = true;
  openModal('modal-finding');
}

function setFindingFormValues(f) {
  $('#finding-id').value = f.id;
  $('#finding-category').value = f.category || '';
  $('#finding-severity').value = f.severity || '';
  $('#finding-where').value = f.where || '';
  $('#finding-steps').value = f.stepsToRepro || '';
  $('#finding-expected').value = f.expected || '';
  $('#finding-actual').value = f.actual || '';
  $('#finding-console').value = f.consoleErrors || '';
  $('#finding-auth').value = f.authContext || '';
  pendingScreenshot = f.screenshot ? { dataUrl: f.screenshot, meta: f.screenshotMeta } : null;
  renderScreenshotPreview();
  // open optional-fields if any are set
  $('.optional-fields').open = !!(f.consoleErrors || f.authContext);
}

function renderScreenshotPreview() {
  const preview = $('#screenshot-preview');
  const dropzone = $('#screenshot-dropzone');
  if (pendingScreenshot && pendingScreenshot.dataUrl) {
    $('#screenshot-preview-img').src = pendingScreenshot.dataUrl;
    const m = pendingScreenshot.meta || {};
    const kb = m.bytes ? Math.round(m.bytes / 1024) : null;
    $('#screenshot-info').textContent = m.width
      ? `${m.width}×${m.height} · ~${kb} KB (compressed)`
      : '(restored from save)';
    preview.hidden = false;
    dropzone.hidden = true;
  } else {
    preview.hidden = true;
    dropzone.hidden = false;
  }
}

async function saveFindingFromForm(e) {
  e.preventDefault();
  const session = state.sessions[state.activeSessionId];
  if (!session) return;
  const id = $('#finding-id').value;
  const finding = (session.findings.find(f => f.id === id)) || newFinding();
  finding.id = id;
  finding.category = $('#finding-category').value;
  finding.severity = $('#finding-severity').value;
  finding.where = $('#finding-where').value.trim();
  finding.stepsToRepro = $('#finding-steps').value.trim();
  finding.expected = $('#finding-expected').value.trim();
  finding.actual = $('#finding-actual').value.trim();
  finding.consoleErrors = $('#finding-console').value.trim();
  finding.authContext = $('#finding-auth').value.trim();
  if (pendingScreenshot) {
    finding.screenshot = pendingScreenshot.dataUrl;
    finding.screenshotMeta = pendingScreenshot.meta || null;
  } else {
    finding.screenshot = null;
    finding.screenshotMeta = null;
  }

  const idx = session.findings.findIndex(f => f.id === id);
  if (idx === -1) session.findings.push(finding);
  else session.findings[idx] = finding;

  persistSession(session);
  renderSessionView();
  closeModal('modal-finding');
  toast('Finding saved.', 'success');
}

async function deleteFinding() {
  const session = state.sessions[state.activeSessionId];
  if (!session) return;
  const id = $('#finding-id').value;
  const ok = await confirmDialog('Delete this finding?', 'This removes it from the session. You can\'t undo this.', 'Delete', true);
  if (!ok) return;
  session.findings = session.findings.filter(f => f.id !== id);
  persistSession(session);
  renderSessionView();
  closeModal('modal-finding');
  toast('Finding deleted.');
}

/* ── Session actions ───────────────────────────────────── */
async function startNewSession(e) {
  e.preventDefault();
  const tester = $('#new-session-tester').value.trim();
  const notes = $('#new-session-notes').value.trim();
  if (!tester) return;
  const s = newSession(tester, notes);
  if (state.defaultTester !== tester) {
    state.defaultTester = tester;
    saveLocal(STORAGE_KEYS.defaultTester, tester);
  }
  persistSession(s);
  state.activeSessionId = s.id;
  closeModal('modal-new-session');
  $('#new-session-form').reset();
  renderSessionView();
  toast('Session started.', 'success');
}

function saveSessionNow() {
  const s = state.sessions[state.activeSessionId];
  if (!s) return;
  s.notes = $('#session-notes').value;
  persistSession(s);
  flashSaveStatus('Saved locally', 'success');
}

const autoSaveNotes = debounce(() => {
  const s = state.sessions[state.activeSessionId];
  if (!s) return;
  s.notes = $('#session-notes').value;
  persistSession(s);
  flashSaveStatus('Auto-saved', 'info');
}, 600);

function flashSaveStatus(text, kind) {
  const el = $('#session-save-status');
  el.textContent = text;
  el.className = `save-status ${kind}`;
  el.hidden = false;
  clearTimeout(flashSaveStatus._t);
  flashSaveStatus._t = setTimeout(() => { el.hidden = true; }, 2200);
}

async function downloadCurrentPDF() {
  const s = state.sessions[state.activeSessionId] || state.remoteSessions[state.activeSessionId];
  if (!s) return;
  toast('Generating PDF…');
  try {
    await generatePDF(s);
    toast('PDF downloaded.', 'success');
  } catch (e) {
    console.error(e);
    toast('PDF export failed: ' + e.message, 'error');
  }
}

async function finalizeSession() {
  const s = state.sessions[state.activeSessionId];
  if (!s) return;

  if (!s.findings || s.findings.length === 0) {
    const ok = await confirmDialog('Finalize empty session?', 'This session has no findings. Finalize anyway?', 'Finalize');
    if (!ok) return;
  }

  if (!state.pat) {
    const goSettings = await confirmDialog(
      'No GitHub PAT configured',
      'Finalizing publishes the session to the shared dashboard, which needs a GitHub PAT. You can still keep this as a local draft and download the PDF. Open Settings to add a PAT?',
      'Open Settings'
    );
    if (goSettings) openModal('modal-settings');
    return;
  }

  const ok = await confirmDialog(
    'Finalize session?',
    'This closes the session, generates a PDF, and publishes the JSON to the shared dashboard. You can reopen it later to make changes.',
    'Finalize'
  );
  if (!ok) return;

  s.notes = $('#session-notes').value;
  s.status = 'closed';
  s.closedAt = nowISO();

  toast('Publishing to GitHub…');
  try {
    const filename = `${s.id}.json`;
    const sha = state.remoteShas[s.id] || null;
    const result = await GH.putSession(filename, s, sha);
    state.remoteShas[s.id] = result.sha;
    state.remoteSessions[s.id] = JSON.parse(JSON.stringify(s));
    persistSession(s);
  } catch (e) {
    console.error(e);
    s.status = 'open';
    s.closedAt = null;
    persistSession(s);
    toast('Publish failed: ' + e.message, 'error');
    renderSessionView();
    return;
  }

  // Generate PDF
  try { await generatePDF(s); }
  catch (e) { console.warn('PDF gen failed (session is published anyway):', e); }

  toast('Session finalized.', 'success');
  renderSessionView();
}

async function reopenSession() {
  const s = state.sessions[state.activeSessionId] || state.remoteSessions[state.activeSessionId];
  if (!s) return;

  const ok = await confirmDialog(
    'Reopen session?',
    'Reopening lets you edit. The session stays open until you finalize again, which will overwrite the published version.',
    'Reopen'
  );
  if (!ok) return;

  // Pull latest if from remote, to make sure we're editing fresh
  let working = state.sessions[s.id];
  if (!working) {
    try {
      const { json, sha } = await GH.getSession(`${s.id}.json`);
      working = json;
      state.remoteShas[s.id] = sha;
    } catch (e) {
      toast('Could not pull latest: ' + e.message, 'error');
      return;
    }
  }
  working.status = 'open';
  working.closedAt = null;
  persistSession(working);
  state.activeSessionId = working.id;
  renderSessionView();
  toast('Session reopened.', 'success');
}

async function deleteSessionLocal() {
  const s = state.sessions[state.activeSessionId];
  if (!s) return;
  const ok = await confirmDialog(
    'Delete local copy?',
    s.status === 'closed'
      ? 'This removes only your LOCAL copy. The published version on the shared dashboard stays. To remove from the dashboard, manually delete the file from the GitHub repo.'
      : 'This deletes the draft permanently. It hasn\'t been published, so this is the only copy.',
    'Delete', true
  );
  if (!ok) return;
  removeLocalSession(s.id);
  state.activeSessionId = null;
  toast('Local copy deleted.');
  renderDashboard();
}

/* ── Settings ──────────────────────────────────────────── */
function loadSettingsModal() {
  $('#pat-input').value = state.pat || '';
  $('#default-tester-input').value = state.defaultTester || '';
  $('#pat-status').hidden = true;
}

async function testPAT() {
  const val = $('#pat-input').value.trim();
  if (!val) { setPATStatus('Enter a token first.', 'error'); return; }
  state.pat = val; // temp; not yet saved
  try {
    const data = await GH.testAuth();
    setPATStatus(`Connected to ${data.name}. Push permission: ${data.permissions?.push ? 'yes' : 'no — token needs Contents:write scope'}.`, data.permissions?.push ? 'success' : 'error');
  } catch (e) {
    setPATStatus('Failed: ' + e.message, 'error');
  } finally {
    state.pat = loadLocal(STORAGE_KEYS.pat); // restore saved
  }
}

function savePAT() {
  const val = $('#pat-input').value.trim();
  if (!val) { setPATStatus('Empty token. Use Clear to remove an existing one.', 'error'); return; }
  state.pat = val;
  saveLocal(STORAGE_KEYS.pat, val);
  setPATStatus('Saved.', 'success');
}
function clearPAT() {
  state.pat = null;
  clearLocal(STORAGE_KEYS.pat);
  $('#pat-input').value = '';
  setPATStatus('Cleared.', 'info');
}
function setPATStatus(msg, kind) {
  const el = $('#pat-status');
  el.textContent = msg;
  el.className = `save-status ${kind}`;
  el.hidden = false;
}

function saveDefaultTester() {
  const v = $('#default-tester-input').value.trim();
  state.defaultTester = v;
  saveLocal(STORAGE_KEYS.defaultTester, v);
  toast('Default tester saved.', 'success');
}

/* ── Theme toggle ──────────────────────────────────────── */
function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  saveLocal(STORAGE_KEYS.theme, theme);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ── Init / wiring ─────────────────────────────────────── */
function unlock() {
  $('#lock-screen').hidden = true;
  $('#app').hidden = false;
  sessionStorage.setItem(STORAGE_KEYS.unlocked, '1');
  renderDashboard();
}

function init() {
  // Theme
  applyTheme(loadLocal(STORAGE_KEYS.theme, 'light'));

  // Hydrate state
  state.sessions = loadLocal(STORAGE_KEYS.sessions, {});
  state.pat = loadLocal(STORAGE_KEYS.pat, null);
  state.defaultTester = loadLocal(STORAGE_KEYS.defaultTester, '');

  // Auto-unlock if previously unlocked in this tab
  if (sessionStorage.getItem(STORAGE_KEYS.unlocked) === '1') {
    unlock();
  }

  // Lock form
  $('#lock-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#lock-input').value;
    if (v === PASSWORD) {
      $('#lock-error').hidden = true;
      unlock();
    } else {
      $('#lock-error').hidden = false;
      $('#lock-input').value = '';
      $('#lock-input').focus();
    }
  });

  // Theme toggle
  $$('.theme-toggle').forEach(b => b.addEventListener('click', toggleTheme));

  // Nav
  $$('[data-view]').forEach(b => b.addEventListener('click', (e) => {
    const v = e.currentTarget.dataset.view;
    if (v === 'dashboard') renderDashboard();
  }));

  // Dashboard
  $('#new-session-btn').addEventListener('click', () => {
    if (state.defaultTester) $('#new-session-tester').value = state.defaultTester;
    openModal('modal-new-session');
    setTimeout(() => $('#new-session-tester').focus(), 50);
  });
  $('#refresh-btn').addEventListener('click', renderDashboard);
  $$('.chip').forEach(c => c.addEventListener('click', () => {
    state.filter = c.dataset.filter;
    $$('.chip').forEach(x => x.classList.remove('chip-active'));
    c.classList.add('chip-active');
    renderDashboard();
  }));

  // New session form
  $('#new-session-form').addEventListener('submit', startNewSession);

  // Session view actions
  $('#add-finding-btn').addEventListener('click', openNewFinding);
  $('#save-session-btn').addEventListener('click', saveSessionNow);
  $('#download-pdf-btn').addEventListener('click', downloadCurrentPDF);
  $('#finalize-session-btn').addEventListener('click', finalizeSession);
  $('#reopen-session-btn').addEventListener('click', reopenSession);
  $('#delete-session-btn').addEventListener('click', deleteSessionLocal);
  $('#session-notes').addEventListener('input', autoSaveNotes);

  // Finding form
  $('#finding-form').addEventListener('submit', saveFindingFromForm);
  $('#finding-delete-btn').addEventListener('click', deleteFinding);
  $('#screenshot-remove').addEventListener('click', () => {
    pendingScreenshot = null;
    renderScreenshotPreview();
  });

  // Screenshot inputs
  $('#screenshot-file').addEventListener('change', async (e) => {
    if (e.target.files[0]) await ingestImage(e.target.files[0]);
    e.target.value = '';
  });

  // Drag & drop
  const dz = $('#screenshot-dropzone');
  ['dragenter', 'dragover'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); dz.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); dz.classList.remove('dragging');
  }));
  dz.addEventListener('drop', async (e) => {
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) await ingestImage(f);
  });

  // Paste anywhere within finding modal
  document.addEventListener('paste', async (e) => {
    if ($('#modal-finding').hidden) return;
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const blob = it.getAsFile();
        if (blob) {
          await ingestImage(blob);
          e.preventDefault();
          return;
        }
      }
    }
  });

  // Settings
  $('#settings-btn').addEventListener('click', () => {
    loadSettingsModal();
    openModal('modal-settings');
  });
  $('#pat-test-btn').addEventListener('click', testPAT);
  $('#pat-save-btn').addEventListener('click', savePAT);
  $('#pat-clear-btn').addEventListener('click', clearPAT);
  $('#default-tester-save-btn').addEventListener('click', saveDefaultTester);

  // Modal close handlers
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close-modal]');
    if (closeBtn) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Friendly: pre-fill new-session tester if default exists
  if (state.defaultTester) $('#new-session-tester').value = state.defaultTester;
}

async function ingestImage(fileOrBlob) {
  try {
    toast('Compressing…');
    const result = await compressImage(fileOrBlob);
    pendingScreenshot = { dataUrl: result.dataUrl, meta: { width: result.width, height: result.height, bytes: result.bytes } };
    renderScreenshotPreview();
    const kb = Math.round(result.bytes / 1024);
    toast(`Image attached: ${result.width}×${result.height} · ${kb} KB`, 'success');
  } catch (e) {
    console.error(e);
    toast('Image ingest failed: ' + e.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);
