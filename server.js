const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// DWIM TV — Destiny Word International Ministries
console.log('⏳ DWIM TV (Destiny Word International Ministries) starting…');

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ---- API: the catalog (this is our "storage") ----
const CATALOG_PATH = path.join(__dirname, 'data', 'videos.json');

function readCatalog() {
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read videos.json:', err.message);
    return { channels: [], videos: [] };
  }
}

function writeCatalog(cat) {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(cat, null, 2) + '\n', 'utf8');
}

// Full catalog (channels + videos)
app.get('/api/catalog', (req, res) => {
  res.json(readCatalog());
});

// Just the videos
app.get('/api/videos', (req, res) => {
  res.json(readCatalog().videos || []);
});

// Just the channels
app.get('/api/channels', (req, res) => {
  res.json(readCatalog().channels || []);
});

// Health check (Render uses this to know the app is alive)
app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

/* =========================================================
   ADMIN PANEL — login: ntando / ntando (env-overridable)
   ========================================================= */
const ADMIN_USER = process.env.ADMIN_USER || 'ntando';
const ADMIN_PASS = process.env.ADMIN_PASS || 'ntando';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'mrnt4ndo/dwim-tv';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const SESSION_TTL = 1000 * 60 * 60 * 6; // 6 hours
const sessions = new Map(); // token -> expiry

function parseSessionCookie(req) {
  const m = String(req.headers.cookie || '').match(/dwim_session=([a-f0-9]+)/);
  return m ? m[1] : null;
}

function authed(req) {
  const t = parseSessionCookie(req);
  if (!t) return false;
  const exp = sessions.get(t);
  if (!exp || exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}

function requireAdmin(req, res, next) {
  if (!authed(req)) return res.status(401).json({ ok: false, error: 'Not logged in' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    res.setHeader('Set-Cookie',
      `dwim_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`);
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: 'Invalid username or password' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  const t = parseSessionCookie(req);
  if (t) sessions.delete(t);
  res.setHeader('Set-Cookie', 'dwim_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ ok: authed(req), user: authed(req) ? ADMIN_USER : null });
});

// List full catalog (admin view)
app.get('/api/admin/videos', requireAdmin, (req, res) => {
  res.json(readCatalog());
});

// Verify a YouTube URL/ID via oEmbed — returns title, author, thumbnail
app.get('/api/admin/verify', requireAdmin, async (req, res) => {
  const raw = String(req.query.url || '').trim();
  if (!raw) return res.status(400).json({ ok: false, error: 'Missing url' });
  let id = null;
  if (/^[\w-]{11}$/.test(raw)) id = raw;
  else {
    const m = raw.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
    if (m) id = m[1];
  }
  if (!id) return res.status(400).json({ ok: false, error: 'Could not find a YouTube video ID in that input' });
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    if (!r.ok) return res.status(404).json({ ok: false, error: 'Video not found on YouTube (private, deleted or wrong ID)' });
    const meta = await r.json();
    res.json({ ok: true, id, title: meta.title, author: meta.author_name, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'YouTube check failed: ' + e.message });
  }
});

/* =========================================================
   CHURCH INFO — service times, theme banner, contact, giving
   ========================================================= */
app.get('/api/admin/church', requireAdmin, (req, res) => {
  const cat = readCatalog();
  res.json({ ok: true, church: cat.church || {} });
});

app.put('/api/admin/church', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const cat = readCatalog();
  const prev = cat.church || {};

  // Whitelisted, shallow-merged fields — keeps unknown/extra keys out of the catalog
  const church = {
    ...prev,
    name: body.name !== undefined ? String(body.name).trim() : prev.name,
    short: body.short !== undefined ? String(body.short).trim() : prev.short,
    tagline: body.tagline !== undefined ? String(body.tagline).trim() : prev.tagline,
    theme: body.theme !== undefined ? String(body.theme).trim() : prev.theme,
    themeNote: body.themeNote !== undefined ? String(body.themeNote).trim() : prev.themeNote,
    themeVerse: body.themeVerse !== undefined ? String(body.themeVerse).trim() : prev.themeVerse,
    location: body.location !== undefined ? String(body.location).trim() : prev.location,
    mapUrl: body.mapUrl !== undefined ? String(body.mapUrl).trim() : prev.mapUrl,
    services: Array.isArray(body.services)
      ? body.services
          .map(s => ({ name: String((s || {}).name || '').trim(), time: String((s || {}).time || '').trim() }))
          .filter(s => s.name || s.time)
      : prev.services,
    contact: {
      ...(prev.contact || {}),
      ...(body.contact ? {
        facebook: body.contact.facebook !== undefined ? String(body.contact.facebook).trim() : (prev.contact || {}).facebook,
        whatsapp: body.contact.whatsapp !== undefined ? String(body.contact.whatsapp).trim() : (prev.contact || {}).whatsapp,
        phone: body.contact.phone !== undefined ? String(body.contact.phone).trim() : (prev.contact || {}).phone,
        email: body.contact.email !== undefined ? String(body.contact.email).trim() : (prev.contact || {}).email
      } : {})
    },
    giving: {
      ...(prev.giving || {}),
      ...(body.giving ? {
        bankName: body.giving.bankName !== undefined ? String(body.giving.bankName).trim() : (prev.giving || {}).bankName,
        accountName: body.giving.accountName !== undefined ? String(body.giving.accountName).trim() : (prev.giving || {}).accountName,
        accountNumber: body.giving.accountNumber !== undefined ? String(body.giving.accountNumber).trim() : (prev.giving || {}).accountNumber,
        note: body.giving.note !== undefined ? String(body.giving.note).trim() : (prev.giving || {}).note
      } : {})
    }
  };

  cat.church = church;
  writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, church, github: gh });
});

/* =========================================================
   CHANNEL MANAGEMENT — rename, delete, reorder
   ========================================================= */

// Rename a channel and/or change its icon
app.put('/api/admin/channels/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const ch = (cat.channels || []).find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ ok: false, error: 'Channel not found' });
  if (ch.id === 'ch-all') return res.status(400).json({ ok: false, error: '"All Videos" is a built-in channel and cannot be renamed' });

  const body = req.body || {};
  const newName = body.name !== undefined ? String(body.name).trim() : ch.name;
  if (!newName) return res.status(400).json({ ok: false, error: 'Channel name cannot be empty' });
  const dupe = cat.channels.some(c => c.id !== ch.id && c.name.toLowerCase() === newName.toLowerCase());
  if (dupe) return res.status(409).json({ ok: false, error: 'Another channel already has that name' });

  ch.name = newName;
  if (body.icon !== undefined) ch.icon = String(body.icon).trim() || ch.icon;
  // keep the video "category" label in sync when it mirrors the old channel name
  writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, channel: ch, github: gh });
});

// Delete a channel. Videos in it are moved to a target channel (default: ch-archive, fallback: first remaining channel)
app.delete('/api/admin/channels/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const idx = (cat.channels || []).findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Channel not found' });
  const ch = cat.channels[idx];
  if (ch.id === 'ch-all') return res.status(400).json({ ok: false, error: '"All Videos" is a built-in channel and cannot be deleted' });

  const moveTo = String(req.query.moveTo || req.body?.moveTo || '').trim();
  const videosInChannel = (cat.videos || []).filter(v => v.channel === ch.id);

  if (videosInChannel.length > 0) {
    let target = cat.channels.find(c => c.id === moveTo && c.id !== ch.id);
    if (!target) target = cat.channels.find(c => c.id === 'ch-archive' && c.id !== ch.id);
    if (!target) target = cat.channels.find(c => c.id !== ch.id && c.id !== 'ch-all');
    if (!target) return res.status(400).json({ ok: false, error: 'Cannot delete the only remaining channel while it still has videos' });
    for (const v of videosInChannel) v.channel = target.id;
  }

  cat.channels.splice(idx, 1);
  writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, removed: ch, movedVideos: videosInChannel.length, github: gh });
});

// Reorder channels — body: { order: ["ch-all", "ch-services", ...] } (full list of channel ids in desired order)
app.put('/api/admin/channels-order', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const order = Array.isArray(body.order) ? body.order.map(String) : null;
  if (!order || !order.length) return res.status(400).json({ ok: false, error: 'Missing order array' });

  const cat = readCatalog();
  const byId = new Map(cat.channels.map(c => [c.id, c]));
  const missing = order.filter(id => !byId.has(id));
  if (missing.length) return res.status(400).json({ ok: false, error: 'Unknown channel id(s): ' + missing.join(', ') });

  const reordered = order.map(id => byId.get(id));
  // append any channel not mentioned (defensive — keeps data safe if the client sent a partial list)
  for (const c of cat.channels) if (!order.includes(c.id)) reordered.push(c);

  cat.channels = reordered;
  writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, channels: cat.channels, github: gh });
});

function nextVideoId(cat) {
  let max = 0;
  for (const v of cat.videos) {
    const m = String(v.id).match(/^v(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'v' + (max + 1);
}

// Add a video (by YouTube URL or ID)
app.post('/api/admin/videos', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const raw = String(body.url || '').trim();
  if (!raw) return res.status(400).json({ ok: false, error: 'Missing YouTube URL or ID' });

  let id = null;
  if (/^[\w-]{11}$/.test(raw)) id = raw;
  else {
    const m = raw.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
    if (m) id = m[1];
  }
  if (!id) return res.status(400).json({ ok: false, error: 'Could not find a YouTube video ID in that input' });

  // Verify against YouTube
  let meta = null;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    if (!r.ok) return res.status(404).json({ ok: false, error: 'Video not found on YouTube — cannot add' });
    meta = await r.json();
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'YouTube check failed: ' + e.message });
  }

  const cat = readCatalog();

  // no duplicates
  if ((cat.videos || []).some(v => (v.source || '').includes('v=' + id))) {
    return res.status(409).json({ ok: false, error: 'That video is already in the catalog' });
  }

  // figure out channel
  let channelId = body.channel;
  if (body.newChannelName) {
    const name = String(body.newChannelName).trim();
    if (!name) return res.status(400).json({ ok: false, error: 'New channel name is empty' });
    const exists = cat.channels.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (!exists) {
      const chId = 'ch-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      cat.channels.push({ id: chId, name, icon: String(body.newChannelIcon || '📺').trim() || '📺' });
      channelId = chId;
    } else {
      channelId = cat.channels.find(c => c.name.toLowerCase() === name.toLowerCase()).id;
    }
  }
  const channelObj = cat.channels.find(c => c.id === channelId);
  if (!channelObj) return res.status(400).json({ ok: false, error: 'Unknown channel' });

  const video = {
    id: nextVideoId(cat),
    title: String(body.title || meta.title || 'Untitled').trim(),
    channel: channelObj.id,
    category: String(body.category || channelObj.name).trim(),
    type: 'youtube',
    source: 'https://www.youtube.com/watch?v=' + id,
    duration: String(body.duration || '—').trim(),
    thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    desc: String(body.desc || `Added via DWIM TV admin panel. From YouTube channel: ${meta.author_name}.`).trim(),
    tags: Array.isArray(body.tags) ? body.tags.map(String) :
      String(body.tags || '').split(',').map(s => s.trim()).filter(Boolean)
  };

  cat.videos.push(video);
  writeCatalog(cat);
  const gh = await syncCatalogToGitHub();

  res.json({ ok: true, video, github: gh, channels: cat.channels });
});

// Delete a video
app.delete('/api/admin/videos/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const idx = (cat.videos || []).findIndex(v => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Video not found' });
  const removed = cat.videos.splice(idx, 1)[0];
  writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, removed, github: gh });
});

/* =========================================================
   EDIT a video — title, channel, category, duration, desc,
   tags, and thumbnail override (paste an image URL)
   ========================================================= */
app.put('/api/admin/videos/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const video = (cat.videos || []).find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ ok: false, error: 'Video not found' });

  const body = req.body || {};

  if (body.channel !== undefined && body.channel !== '') {
    const chObj = cat.channels.find(c => c.id === body.channel);
    if (!chObj) return res.status(400).json({ ok: false, error: 'Unknown channel' });
    video.channel = chObj.id;
    // keep category text in step with the new channel unless caller also set category explicitly
    if (body.category === undefined) video.category = chObj.name;
  }
  if (body.title !== undefined) video.title = String(body.title).trim() || video.title;
  if (body.category !== undefined) video.category = String(body.category).trim() || video.category;
  if (body.duration !== undefined) video.duration = String(body.duration).trim() || video.duration;
  if (body.desc !== undefined) video.desc = String(body.desc).trim();
  if (body.tags !== undefined) {
    video.tags = Array.isArray(body.tags)
      ? body.tags.map(String)
      : String(body.tags || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  // Thumbnail override — paste any direct image URL (jpg/png/webp). Empty string resets to the YouTube auto-thumb.
  if (body.thumb !== undefined) {
    const t = String(body.thumb).trim();
    if (t) {
      if (!/^https?:\/\/.+\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(t) && !/^https:\/\/i\.ytimg\.com\//i.test(t)) {
        return res.status(400).json({ ok: false, error: 'Thumbnail must be a direct image URL (.jpg, .png, .webp, .gif)' });
      }
      video.thumb = t;
    } else {
      const m = (video.source || '').match(/v=([\w-]{11})/);
      video.thumb = m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : video.thumb;
    }
  }

  writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, video, github: gh });
});

/* =========================================================
   FEATURE / PIN a video to the top of its channel + reorder
   ========================================================= */

// Toggle "featured" (pinned) flag
app.post('/api/admin/videos/:id/feature', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const video = (cat.videos || []).find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ ok: false, error: 'Video not found' });
  const body = req.body || {};
  video.featured = body.featured !== undefined ? !!body.featured : !video.featured;
  writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, video, github: gh });
});

// Reorder videos — body: { order: ["v12", "v3", ...] } (full list of video ids in desired display order)
app.put('/api/admin/videos-order', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const order = Array.isArray(body.order) ? body.order.map(String) : null;
  if (!order || !order.length) return res.status(400).json({ ok: false, error: 'Missing order array' });

  const cat = readCatalog();
  const byId = new Map(cat.videos.map(v => [v.id, v]));
  const missing = order.filter(id => !byId.has(id));
  if (missing.length) return res.status(400).json({ ok: false, error: 'Unknown video id(s): ' + missing.join(', ') });

  const reordered = order.map(id => byId.get(id));
  for (const v of cat.videos) if (!order.includes(v.id)) reordered.push(v); // keep anything not mentioned, defensively

  cat.videos = reordered;
  writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, videos: cat.videos, github: gh });
});

/* ---- Live stream: set/clear the YouTube live URL for services ---- */
app.post('/api/admin/live', requireAdmin, async (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  const cat = readCatalog();
  if (!url) {
    cat.live = { title: 'DWIM TV Live — Sunday Service', type: 'youtube', source: '' };
  } else {
    const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
    const id = /^[\w-]{11}$/.test(url) ? url : (m ? m[1] : null);
    if (!id) return res.status(400).json({ ok: false, error: 'Please paste a valid YouTube live URL or 11-character ID' });
    cat.live = {
      title: String((req.body || {}).title || 'DWIM TV Live — Sunday Service'),
      type: 'youtube',
      source: 'https://www.youtube.com/watch?v=' + id
    };
  }
  writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  res.json({ ok: true, live: cat.live, github: gh });
});

/* ---- GitHub sync: commits data/videos.json so changes survive
        Render free-tier restarts (Render auto-redeploys from repo) ---- */
async function syncCatalogToGitHub() {
  if (!GITHUB_TOKEN) return { ok: false, skipped: true, reason: 'GITHUB_TOKEN not set — saved to disk only' };
  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/data/videos.json`;
    const headers = {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'User-Agent': 'dwim-tv-admin',
      'Accept': 'application/vnd.github+json'
    };
    // current file sha (needed to update)
    let sha;
    const cur = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
    if (cur.ok) sha = (await cur.json()).sha;

    const content = fs.readFileSync(CATALOG_PATH).toString('base64');
    const payload = {
      message: 'Admin panel: update video catalog',
      content,
      branch: GITHUB_BRANCH
    };
    if (sha) payload.sha = sha;

    const put = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!put.ok) {
      const err = await put.text();
      return { ok: false, status: put.status, error: err.slice(0, 300) };
    }
    return { ok: true, pushed: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✝️ DWIM TV — Destiny Word International Ministries is live on port ${PORT}`);
  console.log('   Raising a people of destiny through the Word.');
});
