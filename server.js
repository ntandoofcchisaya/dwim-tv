const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// DWIM TV — Destiny Word International Ministries
console.log('⏳ DWIM TV (Destiny Word International Ministries) starting…');

app.set('trust proxy', 1); // Render sits behind a proxy; needed for correct rate-limit IPs

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ---- API: the catalog (this is our "storage") ----
const CATALOG_PATH = path.join(__dirname, 'data', 'videos.json');
const BACKUP_DIR = path.join(__dirname, 'data', 'backups');
const AUDIT_LOG_PATH = path.join(__dirname, 'data', 'audit.log');
const MAX_BACKUPS = 20;

function readCatalog() {
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read videos.json:', err.message);
    return { channels: [], videos: [] };
  }
}

// ---- Write queue: serializes all catalog writes so two admin actions
//      (or an admin action racing a GitHub sync) can never interleave
//      and corrupt the JSON file. Every writeCatalog() call is queued
//      and runs strictly after the previous one has finished. ----
let writeQueue = Promise.resolve();

function backupCatalog() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    if (!fs.existsSync(CATALOG_PATH)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(CATALOG_PATH, path.join(BACKUP_DIR, `videos-${stamp}.json`));
    // prune old backups, keep the most recent MAX_BACKUPS
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('videos-') && f.endsWith('.json'))
      .sort();
    while (files.length > MAX_BACKUPS) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
  } catch (e) {
    console.error('Backup failed (continuing anyway):', e.message);
  }
}

function writeCatalogSync(cat) {
  backupCatalog();
  // write to a temp file then rename — atomic on the same filesystem,
  // so a crash mid-write never leaves videos.json half-written
  const tmpPath = CATALOG_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(cat, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, CATALOG_PATH);
}

// Queued write — always await this instead of calling writeCatalogSync directly
function writeCatalog(cat) {
  const task = writeQueue.then(() => writeCatalogSync(cat));
  // keep the queue alive even if this particular write throws
  writeQueue = task.catch(() => {});
  return task;
}

function auditLog(entry) {
  try {
    const line = JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(AUDIT_LOG_PATH, line, 'utf8');
  } catch (e) {
    console.error('Audit log write failed:', e.message);
  }
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

// Rate-limit login attempts: 10 tries per 15 minutes per IP, blocks brute-forcing
// the admin password (there was no protection here before).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many login attempts. Try again in a few minutes.' }
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    res.setHeader('Set-Cookie',
      `dwim_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`);
    auditLog({ action: 'login', user: username });
    res.json({ ok: true });
  } else {
    auditLog({ action: 'login_failed', user: username, ip: req.ip });
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
      String(body.tags || '').split(',').map(s => s.trim()).filter(Boolean),
    featured: !!body.featured,
    addedAt: new Date().toISOString()
  };

  cat.videos.push(video);
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  auditLog({ action: 'video_add', id: video.id, title: video.title, user: ADMIN_USER });

  res.json({ ok: true, video, github: gh, channels: cat.channels });
});

// Bulk-add videos: accepts a list of YouTube URLs/IDs, verifies and adds
// each one, skipping duplicates and failures without aborting the batch.
app.post('/api/admin/videos/bulk', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const rawList = Array.isArray(body.urls) ? body.urls : String(body.urls || '').split('\n');
  const channelId = body.channel;
  const results = [];
  const cat = readCatalog();
  const channelObj = cat.channels.find(c => c.id === channelId);
  if (!channelObj) return res.status(400).json({ ok: false, error: 'Unknown channel' });

  for (const rawLine of rawList) {
    const raw = String(rawLine || '').trim();
    if (!raw) continue;
    let id = null;
    if (/^[\w-]{11}$/.test(raw)) id = raw;
    else {
      const m = raw.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
      if (m) id = m[1];
    }
    if (!id) { results.push({ input: raw, ok: false, error: 'No valid YouTube ID found' }); continue; }
    if ((cat.videos || []).some(v => (v.source || '').includes('v=' + id))) {
      results.push({ input: raw, ok: false, error: 'Already in catalog' }); continue;
    }
    try {
      const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
      if (!r.ok) { results.push({ input: raw, ok: false, error: 'Not found on YouTube' }); continue; }
      const meta = await r.json();
      const video = {
        id: nextVideoId(cat),
        title: meta.title || 'Untitled',
        channel: channelObj.id,
        category: channelObj.name,
        type: 'youtube',
        source: 'https://www.youtube.com/watch?v=' + id,
        duration: '—',
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        desc: `Added via DWIM TV bulk import. From YouTube channel: ${meta.author_name}.`,
        tags: [],
        featured: false,
        addedAt: new Date().toISOString()
      };
      cat.videos.push(video);
      results.push({ input: raw, ok: true, video });
    } catch (e) {
      results.push({ input: raw, ok: false, error: e.message });
    }
  }

  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  auditLog({ action: 'video_bulk_add', count: results.filter(r => r.ok).length, user: ADMIN_USER });

  res.json({ ok: true, results, github: gh });
});

// Edit an existing video's metadata (title, description, duration, tags,
// channel, category, featured flag). There was previously no way to fix
// a typo without deleting and re-adding the video, which lost its ID.
app.put('/api/admin/videos/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const video = (cat.videos || []).find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ ok: false, error: 'Video not found' });

  const body = req.body || {};
  const before = { ...video };

  if (body.title !== undefined) video.title = String(body.title).trim();
  if (body.desc !== undefined) video.desc = String(body.desc).trim();
  if (body.duration !== undefined) video.duration = String(body.duration).trim();
  if (body.category !== undefined) video.category = String(body.category).trim();
  if (body.featured !== undefined) video.featured = !!body.featured;
  if (body.tags !== undefined) {
    video.tags = Array.isArray(body.tags) ? body.tags.map(String) :
      String(body.tags || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  if (body.channel !== undefined) {
    const channelObj = cat.channels.find(c => c.id === body.channel);
    if (!channelObj) return res.status(400).json({ ok: false, error: 'Unknown channel' });
    video.channel = channelObj.id;
  }

  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  auditLog({ action: 'video_edit', id: video.id, before, after: video, user: ADMIN_USER });

  res.json({ ok: true, video, github: gh });
});

// Reorder videos — accepts an ordered array of video IDs and re-sorts
// the catalog to match. Used for drag-and-drop ordering in the admin UI.
app.post('/api/admin/videos/reorder', requireAdmin, async (req, res) => {
  const order = Array.isArray((req.body || {}).order) ? req.body.order.map(String) : null;
  if (!order) return res.status(400).json({ ok: false, error: 'Missing order array of video IDs' });

  const cat = readCatalog();
  const byId = new Map((cat.videos || []).map(v => [v.id, v]));
  const reordered = order.map(id => byId.get(id)).filter(Boolean);
  // append any videos not mentioned in `order` (defensive, keeps them from vanishing)
  for (const v of cat.videos) if (!order.includes(v.id)) reordered.push(v);

  cat.videos = reordered;
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  auditLog({ action: 'video_reorder', user: ADMIN_USER });

  res.json({ ok: true, github: gh });
});

// Delete a video
app.delete('/api/admin/videos/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const idx = (cat.videos || []).findIndex(v => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Video not found' });
  const removed = cat.videos.splice(idx, 1)[0];
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  auditLog({ action: 'video_delete', id: removed.id, title: removed.title, user: ADMIN_USER });
  res.json({ ok: true, removed, github: gh });
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
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  auditLog({ action: 'live_set', live: cat.live, user: ADMIN_USER });
  res.json({ ok: true, live: cat.live, github: gh });
});

/* ---- Church info: service times, contact details, giving info.
        Previously only editable by hand-editing the raw JSON file. ---- */
app.get('/api/admin/church', requireAdmin, (req, res) => {
  res.json({ ok: true, church: readCatalog().church || {} });
});

app.put('/api/admin/church', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const cat = readCatalog();
  const church = cat.church || {};

  // shallow-merge top-level string fields, deep-merge known nested objects
  const stringFields = ['name', 'short', 'tagline', 'theme', 'themeNote', 'themeVerse', 'location', 'mapUrl'];
  for (const f of stringFields) if (body[f] !== undefined) church[f] = String(body[f]);

  if (body.services !== undefined) {
    if (!Array.isArray(body.services)) return res.status(400).json({ ok: false, error: 'services must be an array' });
    church.services = body.services.map(s => ({ name: String(s.name || ''), time: String(s.time || '') }));
  }
  if (body.contact !== undefined) {
    church.contact = { ...(church.contact || {}), ...body.contact };
  }
  if (body.giving !== undefined) {
    church.giving = { ...(church.giving || {}), ...body.giving };
  }

  cat.church = church;
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  auditLog({ action: 'church_update', user: ADMIN_USER });
  res.json({ ok: true, church, github: gh });
});

/* ---- Channel management: rename, re-icon, delete, reorder.
        Previously channels could only be created inline while adding
        a video, with no way to edit or remove one afterward. ---- */
app.put('/api/admin/channels/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const ch = (cat.channels || []).find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ ok: false, error: 'Channel not found' });
  const body = req.body || {};
  if (body.name !== undefined) ch.name = String(body.name).trim();
  if (body.icon !== undefined) ch.icon = String(body.icon).trim() || '📺';
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  auditLog({ action: 'channel_edit', id: ch.id, user: ADMIN_USER });
  res.json({ ok: true, channel: ch, github: gh });
});

app.delete('/api/admin/channels/:id', requireAdmin, async (req, res) => {
  const cat = readCatalog();
  const idx = (cat.channels || []).findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Channel not found' });
  const inUse = (cat.videos || []).some(v => v.channel === cat.channels[idx].id);
  if (inUse && req.query.force !== 'true') {
    return res.status(409).json({ ok: false, error: 'Channel still has videos assigned. Reassign or pass force=true to delete anyway.' });
  }
  const removed = cat.channels.splice(idx, 1)[0];
  await writeCatalog(cat);
  const gh = await syncCatalogToGitHub();
  auditLog({ action: 'channel_delete', id: removed.id, user: ADMIN_USER });
  res.json({ ok: true, removed, github: gh });
});

/* ---- Image uploads: lets the admin replace a video thumbnail or a
        site image (hero, banners, logo, apostle portraits) straight
        from the dashboard. Render's free tier wipes disk on redeploy,
        so — same trick as the video catalog — every uploaded image is
        also committed back to the GitHub repo under public/img/. The
        file is resized/optimized with sharp before saving so a phone
        photo doesn't ship a multi-megabyte PNG to the site. ---- */
const IMG_DIR = path.join(__dirname, 'public', 'img');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB raw upload cap
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WEBP or GIF images are allowed'));
  }
});

// Named "slots" the admin can target — keeps filenames predictable and
// stops arbitrary path traversal via a user-supplied filename.
const IMAGE_SLOTS = {
  'hero': 'hero-worship.jpg',
  'banner-giving': 'banner-giving.jpg',
  'banner-prayer': 'banner-prayer.jpg',
  'logo': 'logo.png',
  'apostle-godfrey': 'apostle-godfrey.jpg',
  'apostle-tecla': 'apostle-tecla.jpg'
};

app.get('/api/admin/images', requireAdmin, (req, res) => {
  const slots = Object.entries(IMAGE_SLOTS).map(([slot, file]) => ({
    slot, file, url: '/img/' + file,
    exists: fs.existsSync(path.join(IMG_DIR, file))
  }));
  res.json({ ok: true, slots });
});

// Replace one of the named site images (hero/banners/logo/portraits).
app.post('/api/admin/images/:slot', requireAdmin, upload.single('image'), async (req, res) => {
  const slot = req.params.slot;
  const filename = IMAGE_SLOTS[slot];
  if (!filename) return res.status(400).json({ ok: false, error: 'Unknown image slot: ' + slot });
  if (!req.file) return res.status(400).json({ ok: false, error: 'No image file uploaded' });

  try {
    const ext = path.extname(filename).toLowerCase();
    let pipeline = sharp(req.file.buffer).rotate().resize({ width: 1600, withoutEnlargement: true });
    let outBuffer;
    if (ext === '.png') outBuffer = await pipeline.png({ quality: 85 }).toBuffer();
    else outBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();

    if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
    const destPath = path.join(IMG_DIR, filename);
    fs.writeFileSync(destPath, outBuffer);

    const gh = await syncFileToGitHub('public/img/' + filename, outBuffer, `Admin panel: update ${slot} image`);
    auditLog({ action: 'image_update', slot, filename, user: ADMIN_USER });

    res.json({ ok: true, slot, url: '/img/' + filename + '?v=' + Date.now(), github: gh });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Image processing failed: ' + e.message });
  }
});

// Replace a video's thumbnail with a custom uploaded image instead of
// the default YouTube-hosted one. Stored under public/img/thumbs/ and
// also pushed to GitHub so it survives a redeploy.
app.post('/api/admin/videos/:id/thumb', requireAdmin, upload.single('image'), async (req, res) => {
  const cat = readCatalog();
  const video = (cat.videos || []).find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ ok: false, error: 'Video not found' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'No image file uploaded' });

  try {
    const outBuffer = await sharp(req.file.buffer).rotate()
      .resize({ width: 640, height: 360, fit: 'cover' })
      .jpeg({ quality: 82 })
      .toBuffer();

    const thumbDir = path.join(IMG_DIR, 'thumbs');
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
    const filename = `${video.id}.jpg`;
    fs.writeFileSync(path.join(thumbDir, filename), outBuffer);

    const gh = await syncFileToGitHub(`public/img/thumbs/${filename}`, outBuffer, `Admin panel: custom thumbnail for ${video.id}`);

    video.thumb = `/img/thumbs/${filename}?v=${Date.now()}`;
    await writeCatalog(cat);
    const ghCatalog = await syncCatalogToGitHub();
    auditLog({ action: 'thumb_update', id: video.id, user: ADMIN_USER });

    res.json({ ok: true, video, github: gh, githubCatalog: ghCatalog });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Image processing failed: ' + e.message });
  }
});

// Multer error handler (file too large / wrong type) so it returns
// clean JSON instead of an HTML stack trace.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || /Only JPEG, PNG, WEBP or GIF/.test(err.message || '')) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  next(err);
});

/* ---- Basic analytics: quick counts for the admin dashboard.
        Previously the admin had no visibility into catalog size at all. ---- */
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const cat = readCatalog();
  const videos = cat.videos || [];
  const byChannel = {};
  for (const v of videos) byChannel[v.channel] = (byChannel[v.channel] || 0) + 1;
  const recent = [...videos]
    .sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0))
    .slice(0, 5)
    .map(v => ({ id: v.id, title: v.title, addedAt: v.addedAt || null }));
  res.json({
    ok: true,
    totalVideos: videos.length,
    totalChannels: (cat.channels || []).length,
    featuredCount: videos.filter(v => v.featured).length,
    byChannel,
    recentlyAdded: recent,
    liveActive: !!(cat.live && cat.live.source)
  });
});

/* ---- Audit log: who did what, and when. Previously there was no
        record of admin actions at all. ---- */
app.get('/api/admin/audit', requireAdmin, (req, res) => {
  try {
    const raw = fs.existsSync(AUDIT_LOG_PATH) ? fs.readFileSync(AUDIT_LOG_PATH, 'utf8') : '';
    const lines = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    res.json({ ok: true, entries: lines.slice(-limit).reverse() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---- GitHub sync: commits a file so changes survive Render free-tier
        restarts (Render auto-redeploys from repo). Generalized so both
        the JSON catalog and uploaded images can be pushed the same way. ---- */
async function syncFileToGitHub(repoPath, buffer, message) {
  if (!GITHUB_TOKEN) return { ok: false, skipped: true, reason: 'GITHUB_TOKEN not set — saved to disk only' };
  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${repoPath}`;
    const headers = {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'User-Agent': 'dwim-tv-admin',
      'Accept': 'application/vnd.github+json'
    };
    // current file sha (needed to update an existing file; omitted for new files)
    let sha;
    const cur = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
    if (cur.ok) sha = (await cur.json()).sha;

    const payload = {
      message,
      content: buffer.toString('base64'),
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

async function syncCatalogToGitHub() {
  return syncFileToGitHub(
    'data/videos.json',
    fs.readFileSync(CATALOG_PATH),
    'Admin panel: update video catalog'
  );
}

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✝️ DWIM TV — Destiny Word International Ministries is live on port ${PORT}`);
  console.log('   Raising a people of destiny through the Word.');
});
