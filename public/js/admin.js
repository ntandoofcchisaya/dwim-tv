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
    return `<tr>
      <td><img src="${esc(v.thumb)}" alt="" onerror="this.style.opacity=0.2"></td>
      <td><b style="color:#fff">${esc(v.title)}</b></td>
      <td>${esc(ch ? ch.icon + ' ' + ch.name : v.channel)}</td>
      <td>${esc(v.duration || '—')}</td>
      <td class="mono">${esc(v.id)}</td>
      <td><button class="btn-del" onclick="delVideo('${esc(v.id)}')">Delete</button></td>
    </tr>`;
  }).join('');
  document.getElementById('stats').textContent = `${VIDEOS.length} videos · ${CHANNELS.length} channels`;
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

/* ---------- boot ---------- */
document.getElementById('loginForm').addEventListener('submit', login);
document.getElementById('addForm').addEventListener('submit', addVideo);
document.getElementById('btnVerify').addEventListener('click', verify);
document.getElementById('liveForm').addEventListener('submit', saveLive);

(async () => {
  if (await checkSession()) showDash();
})();
