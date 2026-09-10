/* ============ DWIM TV — Admin Panel logic (Destiny Word International Ministries) ============ */

let CHANNELS = [];
let VIDEOS = [];
let session = null;

/* ---------- helpers ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function msg(el, text, ok) {
  el.textContent = text;
  el.className = 'form-msg ' + (ok ? 'ok' : 'err');
}

/* ---------- session ---------- */
async function checkSession() {
  try {
    const r = await fetch('/api/admin/session');
    const j = await r.json();
    if (j.ok) { session = j.user; return true; }
  } catch (e) { /* offline */ }
  return false;
}

async function login(e) {
  e.preventDefault();
  const msgEl = document.getElementById('loginMsg');
  msgEl.textContent = 'Signing in…';
  msgEl.className = 'form-msg';
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('loginUser').value.trim(),
        password: document.getElementById('loginPass').value
      })
    });
    const j = await r.json();
    if (j.ok) {
      session = 'dwim';
      showDash();
    } else {
      msg(msgEl, j.error || 'Login failed', false);
    }
  } catch (err) {
    msg(msgEl, 'Could not reach server: ' + err.message, false);
  }
}

function logout() {
  fetch('/api/admin/logout', { method: 'POST' });
  location.reload();
}

function showDash() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dash').style.display = 'block';
  document.getElementById('whoami').textContent = session || 'admin';
  loadCatalog();
  loadChurch();
}

/* ---------- catalog ---------- */
async function loadCatalog() {
  const r = await fetch('/api/admin/videos');
  const j = await r.json();
  CHANNELS = j.channels || [];
  VIDEOS = j.videos || [];
  renderChannelOptions();
  renderTable();
  renderChannelTable();
}

function renderChannelOptions() {
  const sel = document.getElementById('vidChannel');
  sel.innerHTML = CHANNELS
    .filter(c => c.id !== 'ch-all')
    .map(c => `<option value="${esc(c.id)}">${esc(c.icon || '')} ${esc(c.name)}</option>`)
    .join('');
}

function renderTable() {
  const tb = document.getElementById('tbody');
  tb.innerHTML = VIDEOS.map(v => {
    const ch = CHANNELS.find(c => c.id === v.channel);
    return `<tr draggable="true" data-id="${esc(v.id)}">
      <td class="drag-handle">&#9776;</td>
      <td><img src="${esc(v.thumb)}" alt="" onerror="this.style.opacity=0.2"></td>
      <td><b style="color:#fff">${esc(v.title)}</b>${v.featured ? ' <span class="stat-pill" style="margin-left:6px">Pinned</span>' : ''}</td>
      <td>${esc(ch ? ch.icon + ' ' + ch.name : v.channel)}</td>
      <td>${esc(v.duration || '—')}</td>
      <td class="mono">${esc(v.id)}</td>
      <td>
        <button class="btn-pin ${v.featured ? 'is-pinned' : ''}" onclick="toggleFeature('${esc(v.id)}')" title="Pin to top of channel">${v.featured ? '★ Pinned' : '☆ Pin'}</button>
        <button class="btn-edit" onclick="openEdit('${esc(v.id)}')">Edit</button>
        <button class="btn-del" onclick="delVideo('${esc(v.id)}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
  document.getElementById('stats').textContent = `${VIDEOS.length} videos · ${CHANNELS.length} channels`;
  wireVideoDrag();
}

/* ---------- pin / feature ---------- */
async function toggleFeature(id) {
  try {
    const r = await fetch(`/api/admin/videos/${encodeURIComponent(id)}/feature`, { method: 'POST' });
    const j = await r.json();
    if (j.ok) { loadCatalog(); refreshPublicCatalog(); }
    else alert(j.error || 'Failed to pin/unpin');
  } catch (err) { alert('Failed: ' + err.message); }
}

/* ---------- edit video modal ---------- */
function openEdit(id) {
  const v = VIDEOS.find(x => x.id === id);
  if (!v) return;
  document.getElementById('editId').value = v.id;
  document.getElementById('editTitle').value = v.title || '';
  document.getElementById('editCategory').value = v.category || '';
  document.getElementById('editDur').value = v.duration || '';
  document.getElementById('editDesc').value = v.desc || '';
  document.getElementById('editTags').value = (v.tags || []).join(', ');
  document.getElementById('editThumb').value = '';
  document.getElementById('editThumb').placeholder = v.thumb || 'Leave empty to use the YouTube auto-thumbnail';

  const sel = document.getElementById('editChannel');
  sel.innerHTML = CHANNELS
    .filter(c => c.id !== 'ch-all')
    .map(c => `<option value="${esc(c.id)}" ${c.id === v.channel ? 'selected' : ''}>${esc(c.icon || '')} ${esc(c.name)}</option>`)
    .join('');

  document.getElementById('editMsg').textContent = '';
  document.getElementById('editMsg').className = 'form-msg';
  document.getElementById('editOverlay').style.display = 'flex';
}

function closeEdit() {
  document.getElementById('editOverlay').style.display = 'none';
}

async function saveEdit(e) {
  e.preventDefault();
  const id = document.getElementById('editId').value;
  const msgEl = document.getElementById('editMsg');
  const body = {
    title: document.getElementById('editTitle').value.trim(),
    channel: document.getElementById('editChannel').value,
    category: document.getElementById('editCategory').value.trim(),
    duration: document.getElementById('editDur').value.trim(),
    desc: document.getElementById('editDesc').value.trim(),
    tags: document.getElementById('editTags').value.trim(),
    thumb: document.getElementById('editThumb').value.trim()
  };
  try {
    const r = await fetch(`/api/admin/videos/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json();
    if (j.ok) {
      closeEdit();
      loadCatalog();
      refreshPublicCatalog();
    } else {
      msg(msgEl, j.error || 'Failed to save', false);
    }
  } catch (err) {
    msg(msgEl, 'Save failed: ' + err.message, false);
  }
}

/* ---------- drag-to-reorder videos ---------- */
function wireVideoDrag() {
  const tb = document.getElementById('tbody');
  let dragEl = null;
  tb.querySelectorAll('tr').forEach(row => {
    row.addEventListener('dragstart', () => { dragEl = row; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); dragEl = null; saveVideoOrder(); });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragEl || dragEl === row) return;
      const rows = [...tb.querySelectorAll('tr')];
      const dragIdx = rows.indexOf(dragEl), overIdx = rows.indexOf(row);
      if (dragIdx < overIdx) row.after(dragEl); else row.before(dragEl);
    });
  });
}

async function saveVideoOrder() {
  const order = [...document.querySelectorAll('#tbody tr')].map(r => r.dataset.id);
  try {
    await fetch('/api/admin/videos-order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order })
    });
    refreshPublicCatalog();
  } catch (e) { /* non-fatal */ }
}

/* ---------- verify ---------- */
async function verify() {
  const url = document.getElementById('vidUrl').value.trim();
  const box = document.getElementById('verifyBox');
  const msgEl = document.getElementById('addMsg');
  if (!url) { box.style.display = 'none'; return; }

  msgEl.textContent = 'Checking with YouTube…';
  msgEl.className = 'form-msg';
  try {
    const r = await fetch(`/api/admin/verify?url=${encodeURIComponent(url)}`);
    const j = await r.json();
    if (!j.ok) {
      box.style.display = 'none';
      msg(msgEl, j.error || 'Verification failed', false);
      return;
    }
    box.style.display = 'flex';
    document.getElementById('vThumb').src = j.thumb;
    document.getElementById('vTitle').textContent = j.title;
    document.getElementById('vAuthor').textContent = 'by ' + j.author;
    document.getElementById('vId').textContent = j.id;
    msgEl.textContent = '';
    msgEl.className = 'form-msg';
    // prefill nothing in title so YouTube title is used if left empty
  } catch (err) {
    msg(msgEl, 'Check failed: ' + err.message, false);
  }
}

/* ---------- add ---------- */
function toggleNewCh() {
  const on = document.getElementById('newChToggle').checked;
  document.getElementById('newChBox').style.display = on ? 'grid' : 'none';
  document.getElementById('vidChannel').disabled = on;
}

async function addVideo(e) {
  e.preventDefault();
  const msgEl = document.getElementById('addMsg');
  const btn = document.getElementById('btnAdd');
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    const newCh = document.getElementById('newChToggle').checked;
    const body = {
      url: document.getElementById('vidUrl').value.trim(),
      title: document.getElementById('vidTitle').value.trim(),
      duration: document.getElementById('vidDur').value.trim(),
      desc: document.getElementById('vidDesc').value.trim(),
      tags: document.getElementById('vidTags').value.trim(),
      channel: document.getElementById('vidChannel').value,
      newChannelName: newCh ? document.getElementById('newChName').value.trim() : '',
      newChannelIcon: newCh ? document.getElementById('newChIcon').value.trim() : ''
    };
    const r = await fetch('/api/admin/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json();
    if (j.ok) {
      let extra = j.github && j.github.ok ? ' · Synced to GitHub ✓' : (j.github && j.github.reason ? ' · ' + j.github.reason : '');
      msg(msgEl, 'Added: ' + j.video.title + extra, true);
      document.getElementById('addForm').reset();
      document.getElementById('verifyBox').style.display = 'none';
      document.getElementById('newChBox').style.display = 'none';
      document.getElementById('vidChannel').disabled = false;
      if (j.channels) CHANNELS = j.channels;
      loadCatalog();
      refreshPublicCatalog();
    } else {
      msg(msgEl, j.error || 'Failed to add', false);
    }
  } catch (err) {
    msg(msgEl, 'Add failed: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '➕ Add Video to DWIM TV';
  }
}

/* ---------- delete ---------- */
async function delVideo(id) {
  if (!confirm('Delete this video from DWIM TV?')) return;
  try {
    const r = await fetch('/api/admin/videos/' + encodeURIComponent(id), { method: 'DELETE' });
    const j = await r.json();
    if (j.ok) {
      loadCatalog();
      refreshPublicCatalog();
    } else {
      alert(j.error || 'Delete failed');
    }
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

/* keep the public page in another tab fresh (harmless if closed) */
function refreshPublicCatalog() {
  try {
    if (broadcastChannelSupported()) bc.postMessage({ t: 'catalog-changed' });
  } catch (e) { }
}
let bc = null;
function broadcastChannelSupported() {
  if (!bc && 'BroadcastChannel' in window) bc = new BroadcastChannel('dwim-tv');
  return !!bc;
}

/* ---------- live stream control ---------- */
async function saveLive(e) {
  e.preventDefault();
  const msgEl = document.getElementById('liveMsg');
  const btn = document.getElementById('btnLive');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const r = await fetch('/api/admin/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: document.getElementById('liveUrl').value.trim() })
    });
    const j = await r.json();
    if (j.ok) {
      const on = j.live && j.live.source;
      let extra = j.github && j.github.ok ? ' · Synced to GitHub ✓' : '';
      msg(msgEl, on ? 'Live stream set — the site is ON AIR!' + extra : 'Live stream cleared.' + extra, true);
      document.getElementById('liveUrl').value = '';
      refreshPublicCatalog();
    } else {
      msg(msgEl, j.error || 'Failed to set live stream', false);
    }
  } catch (err) {
    msg(msgEl, 'Failed: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Set / Clear';
  }
}

/* ============================================================
   CHANNEL MANAGEMENT — rename, delete, reorder
   ============================================================ */
function renderChannelTable() {
  const tb = document.getElementById('chBody');
  tb.innerHTML = CHANNELS.map(c => {
    const count = VIDEOS.filter(v => v.channel === c.id).length;
    const isAll = c.id === 'ch-all';
    return `<tr draggable="${!isAll}" data-id="${esc(c.id)}">
      <td class="drag-handle">${isAll ? '' : '&#9776;'}</td>
      <td>${esc(c.icon || '📺')}</td>
      <td><b style="color:#fff">${esc(c.name)}</b> <span class="mono" style="opacity:.6">${esc(c.id)}</span></td>
      <td>${count}</td>
      <td>
        ${isAll ? '' : `
          <button class="btn-rename" onclick="renameChannel('${esc(c.id)}')">Rename</button>
          <button class="btn-del" onclick="deleteChannel('${esc(c.id)}', ${count})">Delete</button>
        `}
      </td>
    </tr>`;
  }).join('');
  wireChannelDrag();
}

async function renameChannel(id) {
  const ch = CHANNELS.find(c => c.id === id);
  if (!ch) return;
  const newName = prompt('Channel name:', ch.name);
  if (newName === null) return;
  const newIcon = prompt('Icon (emoji, optional):', ch.icon || '');
  if (newIcon === null) return;
  try {
    const r = await fetch(`/api/admin/channels/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), icon: newIcon.trim() })
    });
    const j = await r.json();
    if (j.ok) { loadCatalog(); refreshPublicCatalog(); }
    else alert(j.error || 'Rename failed');
  } catch (err) { alert('Rename failed: ' + err.message); }
}

async function deleteChannel(id, count) {
  const warn = count > 0
    ? `This channel has ${count} video(s). They will be moved to "Ministry Archive" (or another channel). Continue?`
    : 'Delete this empty channel?';
  if (!confirm(warn)) return;
  try {
    const r = await fetch(`/api/admin/channels/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const j = await r.json();
    if (j.ok) { loadCatalog(); refreshPublicCatalog(); }
    else alert(j.error || 'Delete failed');
  } catch (err) { alert('Delete failed: ' + err.message); }
}

function wireChannelDrag() {
  const tb = document.getElementById('chBody');
  let dragEl = null;
  tb.querySelectorAll('tr[draggable="true"]').forEach(row => {
    row.addEventListener('dragstart', () => { dragEl = row; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); dragEl = null; saveChannelOrder(); });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragEl || dragEl === row) return;
      const rows = [...tb.querySelectorAll('tr')];
      const dragIdx = rows.indexOf(dragEl), overIdx = rows.indexOf(row);
      if (dragIdx < overIdx) row.after(dragEl); else row.before(dragEl);
    });
  });
}

async function saveChannelOrder() {
  const order = [...document.querySelectorAll('#chBody tr')].map(r => r.dataset.id);
  try {
    await fetch('/api/admin/channels-order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order })
    });
    refreshPublicCatalog();
  } catch (e) { /* non-fatal */ }
}

/* ============================================================
   CHURCH INFO — service times, theme banner, contact, giving
   ============================================================ */
let SERVICES = [];

async function loadChurch() {
  try {
    const r = await fetch('/api/admin/church');
    const j = await r.json();
    if (!j.ok) return;
    const c = j.church || {};
    document.getElementById('chName').value = c.name || '';
    document.getElementById('chShort').value = c.short || '';
    document.getElementById('chTagline').value = c.tagline || '';
    document.getElementById('chTheme').value = c.theme || '';
    document.getElementById('chThemeNote').value = c.themeNote || '';
    document.getElementById('chThemeVerse').value = c.themeVerse || '';
    document.getElementById('chLocation').value = c.location || '';
    document.getElementById('chMapUrl').value = c.mapUrl || '';

    const contact = c.contact || {};
    document.getElementById('chFacebook').value = contact.facebook || '';
    document.getElementById('chWhatsapp').value = contact.whatsapp || '';
    document.getElementById('chPhone').value = contact.phone || '';
    document.getElementById('chEmail').value = contact.email || '';

    const giving = c.giving || {};
    document.getElementById('chBankName').value = giving.bankName || '';
    document.getElementById('chAccountName').value = giving.accountName || '';
    document.getElementById('chAccountNumber').value = giving.accountNumber || '';
    document.getElementById('chGivingNote').value = giving.note || '';

    SERVICES = Array.isArray(c.services) ? c.services.map(s => ({ ...s })) : [];
    renderServices();
  } catch (e) { /* offline */ }
}

function renderServices() {
  const wrap = document.getElementById('servicesList');
  wrap.innerHTML = SERVICES.map((s, i) => `
    <div class="service-row" data-i="${i}">
      <label>Name <input value="${esc(s.name || '')}" oninput="SERVICES[${i}].name = this.value"></label>
      <label>Time / description <input value="${esc(s.time || '')}" oninput="SERVICES[${i}].time = this.value"></label>
      <button type="button" class="btn-remove-row" onclick="removeService(${i})">Remove</button>
    </div>`).join('');
}

function removeService(i) {
  SERVICES.splice(i, 1);
  renderServices();
}

async function saveChurch(e) {
  e.preventDefault();
  const msgEl = document.getElementById('churchMsg');
  const body = {
    name: document.getElementById('chName').value.trim(),
    short: document.getElementById('chShort').value.trim(),
    tagline: document.getElementById('chTagline').value.trim(),
    theme: document.getElementById('chTheme').value.trim(),
    themeNote: document.getElementById('chThemeNote').value.trim(),
    themeVerse: document.getElementById('chThemeVerse').value.trim(),
    location: document.getElementById('chLocation').value.trim(),
    mapUrl: document.getElementById('chMapUrl').value.trim(),
    services: SERVICES.filter(s => (s.name || '').trim() || (s.time || '').trim()),
    contact: {
      facebook: document.getElementById('chFacebook').value.trim(),
      whatsapp: document.getElementById('chWhatsapp').value.trim(),
      phone: document.getElementById('chPhone').value.trim(),
      email: document.getElementById('chEmail').value.trim()
    },
    giving: {
      bankName: document.getElementById('chBankName').value.trim(),
      accountName: document.getElementById('chAccountName').value.trim(),
      accountNumber: document.getElementById('chAccountNumber').value.trim(),
      note: document.getElementById('chGivingNote').value.trim()
    }
  };
  try {
    const r = await fetch('/api/admin/church', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json();
    if (j.ok) {
      let extra = j.github && j.github.ok ? ' · Synced to GitHub ✓' : (j.github && j.github.reason ? ' · ' + j.github.reason : '');
      msg(msgEl, 'Church info saved.' + extra, true);
      refreshPublicCatalog();
    } else {
      msg(msgEl, j.error || 'Failed to save', false);
    }
  } catch (err) {
    msg(msgEl, 'Save failed: ' + err.message, false);
  }
}

/* ---------- boot ---------- */
document.getElementById('loginForm').addEventListener('submit', login);
document.getElementById('addForm').addEventListener('submit', addVideo);
document.getElementById('btnVerify').addEventListener('click', verify);
document.getElementById('liveForm').addEventListener('submit', saveLive);
document.getElementById('editForm').addEventListener('submit', saveEdit);
document.getElementById('churchForm').addEventListener('submit', saveChurch);
document.getElementById('btnAddService').addEventListener('click', () => { SERVICES.push({ name: '', time: '' }); renderServices(); });

(async () => {
  if (await checkSession()) showDash();
})();
