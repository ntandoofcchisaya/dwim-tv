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
  loadStats();
  loadChurch();
  loadImages();
  loadAudit();
}

/* ---------- catalog ---------- */
async function loadCatalog() {
  const r = await fetch('/api/admin/videos');
  const j = await r.json();
  CHANNELS = j.channels || [];
  VIDEOS = j.videos || [];
  renderChannelOptions();
  renderTable();
}

function renderChannelOptions() {
  const opts = CHANNELS
    .filter(c => c.id !== 'ch-all')
    .map(c => `<option value="${esc(c.id)}">${esc(c.icon || '')} ${esc(c.name)}</option>`)
    .join('');
  document.getElementById('vidChannel').innerHTML = opts;
  const bulkSel = document.getElementById('bulkChannel');
  if (bulkSel) bulkSel.innerHTML = opts;
  const editSel = document.getElementById('editChannel');
  if (editSel) editSel.innerHTML = opts;
}

function renderTable() {
  const tb = document.getElementById('tbody');
  tb.innerHTML = VIDEOS.map((v, i) => {
    const ch = CHANNELS.find(c => c.id === v.channel);
    return `<tr draggable="true" data-id="${esc(v.id)}">
      <td><span class="drag-handle">&#8942;&#8942;</span><img src="${esc(v.thumb)}" alt="" onerror="this.style.opacity=0.2"></td>
      <td><b style="color:#fff">${esc(v.title)}</b></td>
      <td>${esc(ch ? ch.icon + ' ' + ch.name : v.channel)}</td>
      <td>${esc(v.duration || '—')}</td>
      <td><button class="btn-feature ${v.featured ? 'on' : ''}" onclick="toggleFeatured('${esc(v.id)}', ${!v.featured})">${v.featured ? '★ Featured' : '☆ Feature'}</button></td>
      <td class="mono">${esc(v.id)}</td>
      <td>
        <button class="btn-edit" onclick="openEdit('${esc(v.id)}')">Edit</button>
        <button class="btn-del" onclick="delVideo('${esc(v.id)}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
  document.getElementById('stats').textContent = `${VIDEOS.length} videos · ${CHANNELS.length} channels`;
  attachDragHandlers();
  renderChannelTable();
}

function renderChannelTable() {
  const tb = document.getElementById('chTbody');
  if (!tb) return;
  tb.innerHTML = CHANNELS.filter(c => c.id !== 'ch-all').map(c => {
    const count = VIDEOS.filter(v => v.channel === c.id).length;
    return `<tr>
      <td>${esc(c.icon || '📺')}</td>
      <td><input type="text" value="${esc(c.name)}" onchange="renameChannel('${esc(c.id)}', this.value)" style="background:#0d0d13;border:1px solid #2a2a33;border-radius:8px;color:#fff;padding:6px 8px;width:100%"></td>
      <td>${count}</td>
      <td class="mono">${esc(c.id)}</td>
      <td><button class="btn-del" onclick="delChannel('${esc(c.id)}', ${count})">Delete</button></td>
    </tr>`;
  }).join('');
}

async function renameChannel(id, name) {
  const r = await fetch('/api/admin/channels/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const j = await r.json();
  if (j.ok) { loadCatalog(); refreshPublicCatalog(); }
  else alert(j.error || 'Rename failed');
}

async function delChannel(id, count) {
  let force = false;
  if (count > 0) {
    if (!confirm(`${count} video(s) use this channel. Delete anyway? (they will keep their channel ID but it will no longer appear in the list)`)) return;
    force = true;
  } else if (!confirm('Delete this channel?')) return;
  const r = await fetch('/api/admin/channels/' + encodeURIComponent(id) + (force ? '?force=true' : ''), { method: 'DELETE' });
  const j = await r.json();
  if (j.ok) { loadCatalog(); refreshPublicCatalog(); }
  else alert(j.error || 'Delete failed');
}

async function toggleFeatured(id, featured) {
  const r = await fetch('/api/admin/videos/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ featured })
  });
  const j = await r.json();
  if (j.ok) { loadCatalog(); refreshPublicCatalog(); }
  else alert(j.error || 'Update failed');
}

/* ---------- drag-and-drop reorder ---------- */
function attachDragHandlers() {
  const tb = document.getElementById('tbody');
  let dragEl = null;
  tb.querySelectorAll('tr').forEach(row => {
    row.addEventListener('dragstart', () => { dragEl = row; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); saveOrder(); });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      const rows = [...tb.querySelectorAll('tr')];
      const after = rows.find(r => r !== dragEl && e.clientY < r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2);
      if (after) tb.insertBefore(dragEl, after);
      else tb.appendChild(dragEl);
    });
  });
}

async function saveOrder() {
  const order = [...document.getElementById('tbody').querySelectorAll('tr')].map(r => r.dataset.id);
  await fetch('/api/admin/videos/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order })
  });
  refreshPublicCatalog();
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

/* ---------- edit video modal ---------- */
function openEdit(id) {
  const v = VIDEOS.find(x => x.id === id);
  if (!v) return;
  document.getElementById('editId').value = v.id;
  document.getElementById('editTitle').value = v.title || '';
  document.getElementById('editDuration').value = v.duration || '';
  document.getElementById('editCategory').value = v.category || '';
  document.getElementById('editChannel').value = v.channel || '';
  document.getElementById('editDesc').value = v.desc || '';
  document.getElementById('editTags').value = (v.tags || []).join(', ');
  document.getElementById('editFeatured').checked = !!v.featured;
  document.getElementById('editMsg').textContent = '';
  document.getElementById('editModal').style.display = 'flex';
}

function closeEdit() {
  document.getElementById('editModal').style.display = 'none';
}

async function saveEdit(e) {
  e.preventDefault();
  const id = document.getElementById('editId').value;
  const msgEl = document.getElementById('editMsg');
  const body = {
    title: document.getElementById('editTitle').value.trim(),
    duration: document.getElementById('editDuration').value.trim(),
    category: document.getElementById('editCategory').value.trim(),
    channel: document.getElementById('editChannel').value,
    desc: document.getElementById('editDesc').value.trim(),
    tags: document.getElementById('editTags').value.trim(),
    featured: document.getElementById('editFeatured').checked
  };
  try {
    const r = await fetch('/api/admin/videos/' + encodeURIComponent(id), {
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
      msg(msgEl, j.error || 'Save failed', false);
    }
  } catch (err) {
    msg(msgEl, 'Save failed: ' + err.message, false);
  }
}

/* ---------- bulk import ---------- */
async function bulkImport(e) {
  e.preventDefault();
  const msgEl = document.getElementById('bulkMsg');
  const resultsEl = document.getElementById('bulkResults');
  const btn = document.getElementById('btnBulk');
  const urls = document.getElementById('bulkUrls').value;
  const channel = document.getElementById('bulkChannel').value;
  if (!urls.trim()) { msg(msgEl, 'Paste at least one YouTube URL or ID', false); return; }
  btn.disabled = true;
  btn.textContent = 'Importing…';
  resultsEl.innerHTML = '';
  try {
    const r = await fetch('/api/admin/videos/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, channel })
    });
    const j = await r.json();
    if (j.ok) {
      const okCount = j.results.filter(x => x.ok).length;
      msg(msgEl, `Imported ${okCount} of ${j.results.length}`, true);
      resultsEl.innerHTML = j.results.map(x =>
        `<div class="${x.ok ? 'row-ok' : 'row-err'}">${x.ok ? '✓' : '✗'} ${esc(x.input)} ${x.ok ? '— ' + esc(x.video.title) : '— ' + esc(x.error)}</div>`
      ).join('');
      document.getElementById('bulkUrls').value = '';
      loadCatalog();
      refreshPublicCatalog();
    } else {
      msg(msgEl, j.error || 'Bulk import failed', false);
    }
  } catch (err) {
    msg(msgEl, 'Bulk import failed: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '➕ Import All';
  }
}

/* ---------- stats ---------- */
async function loadStats() {
  const bar = document.getElementById('statsBar');
  try {
    const r = await fetch('/api/admin/stats');
    const j = await r.json();
    if (!j.ok) { bar.textContent = 'Could not load stats'; return; }
    bar.innerHTML = `
      <div class="stat-box"><span class="num">${j.totalVideos}</span><span class="lbl">Videos</span></div>
      <div class="stat-box"><span class="num">${j.totalChannels}</span><span class="lbl">Channels</span></div>
      <div class="stat-box"><span class="num">${j.featuredCount}</span><span class="lbl">Featured</span></div>
      <div class="stat-box ${j.liveActive ? 'live-on' : ''}"><span class="num">${j.liveActive ? 'ON AIR' : 'Offline'}</span><span class="lbl">Live Stream</span></div>
    `;
  } catch (e) {
    bar.textContent = 'Could not load stats';
  }
}

/* ---------- church info ---------- */
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
    renderServices(c.services || []);
  } catch (e) { /* ignore */ }
}

function renderServices(services) {
  const wrap = document.getElementById('chServices');
  wrap.innerHTML = services.map((s, i) => `
    <div class="service-row" data-i="${i}">
      <input type="text" placeholder="Service name" value="${esc(s.name)}" class="svc-name">
      <input type="text" placeholder="Time / description" value="${esc(s.time)}" class="svc-time">
      <button type="button" class="btn-icon-del" onclick="this.closest('.service-row').remove()">&times;</button>
    </div>`).join('');
}

document.getElementById('btnAddService').addEventListener('click', () => {
  const wrap = document.getElementById('chServices');
  const div = document.createElement('div');
  div.className = 'service-row';
  div.innerHTML = `
    <input type="text" placeholder="Service name" class="svc-name">
    <input type="text" placeholder="Time / description" class="svc-time">
    <button type="button" class="btn-icon-del" onclick="this.closest('.service-row').remove()">&times;</button>`;
  wrap.appendChild(div);
});

async function saveChurch(e) {
  e.preventDefault();
  const msgEl = document.getElementById('churchMsg');
  const services = [...document.querySelectorAll('#chServices .service-row')].map(row => ({
    name: row.querySelector('.svc-name').value.trim(),
    time: row.querySelector('.svc-time').value.trim()
  })).filter(s => s.name || s.time);

  const body = {
    name: document.getElementById('chName').value.trim(),
    short: document.getElementById('chShort').value.trim(),
    tagline: document.getElementById('chTagline').value.trim(),
    theme: document.getElementById('chTheme').value.trim(),
    themeNote: document.getElementById('chThemeNote').value.trim(),
    themeVerse: document.getElementById('chThemeVerse').value.trim(),
    location: document.getElementById('chLocation').value.trim(),
    mapUrl: document.getElementById('chMapUrl').value.trim(),
    services,
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
      let extra = j.github && j.github.ok ? ' · Synced to GitHub ✓' : '';
      msg(msgEl, 'Church info saved.' + extra, true);
      refreshPublicCatalog();
    } else {
      msg(msgEl, j.error || 'Save failed', false);
    }
  } catch (err) {
    msg(msgEl, 'Save failed: ' + err.message, false);
  }
}

/* ---------- site images ---------- */
async function loadImages() {
  const grid = document.getElementById('imgGrid');
  try {
    const r = await fetch('/api/admin/images');
    const j = await r.json();
    if (!j.ok) { grid.textContent = 'Could not load images'; return; }
    grid.innerHTML = j.slots.map(s => `
      <div class="img-card">
        <img id="img-${esc(s.slot)}" src="${esc(s.url)}?v=${Date.now()}" alt="${esc(s.slot)}" onerror="this.style.opacity=0.2">
        <span class="lbl">${esc(s.slot)}</span>
        <label class="btn-upload" for="file-${esc(s.slot)}">&#128247; Replace Image</label>
        <input type="file" id="file-${esc(s.slot)}" accept="image/jpeg,image/png,image/webp,image/gif" onchange="uploadImage('${esc(s.slot)}', this)">
        <div class="img-status" id="status-${esc(s.slot)}"></div>
      </div>`).join('');
  } catch (e) {
    grid.textContent = 'Could not load images';
  }
}

async function uploadImage(slot, input) {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('status-' + slot);
  statusEl.textContent = 'Uploading…';
  statusEl.style.color = '#9a9aa8';
  const fd = new FormData();
  fd.append('image', file);
  try {
    const r = await fetch('/api/admin/images/' + encodeURIComponent(slot), { method: 'POST', body: fd });
    const j = await r.json();
    if (j.ok) {
      let extra = j.github && j.github.ok ? ' · synced to GitHub ✓' : (j.github && j.github.reason ? ' · ' + j.github.reason : '');
      statusEl.textContent = 'Updated' + extra;
      statusEl.style.color = '#7dd87d';
      document.getElementById('img-' + slot).src = j.url;
    } else {
      statusEl.textContent = j.error || 'Upload failed';
      statusEl.style.color = '#ff7d7d';
    }
  } catch (err) {
    statusEl.textContent = 'Upload failed: ' + err.message;
    statusEl.style.color = '#ff7d7d';
  } finally {
    input.value = '';
  }
}

/* ---------- audit log ---------- */
async function loadAudit() {
  const tb = document.getElementById('auditTbody');
  try {
    const r = await fetch('/api/admin/audit?limit=50');
    const j = await r.json();
    if (!j.ok) return;
    tb.innerHTML = j.entries.map(e => `
      <tr>
        <td>${esc(new Date(e.time).toLocaleString())}</td>
        <td class="audit-action">${esc(e.action)}</td>
        <td>${esc(e.title || e.id || e.filename || e.slot || '—')}</td>
        <td>${esc(e.user || '—')}</td>
      </tr>`).join('');
  } catch (e) { /* ignore */ }
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

/* ---------- boot ---------- */
document.getElementById('loginForm').addEventListener('submit', login);
document.getElementById('addForm').addEventListener('submit', addVideo);
document.getElementById('btnVerify').addEventListener('click', verify);
document.getElementById('liveForm').addEventListener('submit', saveLive);
document.getElementById('bulkForm').addEventListener('submit', bulkImport);
document.getElementById('churchForm').addEventListener('submit', saveChurch);
document.getElementById('editForm').addEventListener('submit', saveEdit);
document.getElementById('btnEditCancel').addEventListener('click', closeEdit);
document.getElementById('editModal').addEventListener('click', (e) => {
  if (e.target.id === 'editModal') closeEdit();
});

(async () => {
  if (await checkSession()) showDash();
})();
