/* ==========================================================
   DWIM TV — Destiny Word International Ministries app logic
   ========================================================== */

let CATALOG = { channels: [], videos: [], church: null, live: null, testimonies: [] };
let activeChannel = 'ch-all';
let searchQuery = '';

/* ---------- Helpers ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function ytId(url) {
  const m = String(url).match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/* ---------- Video source builders ---------- */
function directSrc(video) {
  return `
    <video controls autoplay playsinline>
      <source src="${esc(video.source)}" type="video/mp4">
      Your browser does not support the video tag.
    </video>`;
}

function youtubeSrc(video) {
  const id = ytId(video.source);
  if (!id) return `<div style="display:grid;place-items:center;height:100%;color:#9aa3c0;font-weight:700;">&#9888;&#65039; Invalid YouTube link</div>`;
  const t = video.t ? `&start=${Math.floor(video.t)}` : '';
  // origin must be the exact scheme+host (no path) of the page embedding the player —
  // YouTube uses this to validate the embed request. A missing/incorrect origin is one
  // of the most common causes of the "Sign in to confirm you're not a bot" wall.
  const origin = encodeURIComponent(window.location.origin);
  const params = [
    'autoplay=1',
    'rel=0',
    'playsinline=1',
    'modestbranding=1',
    'enablejsapi=1',
    `origin=${origin}`
  ].join('&');
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  return `
    <iframe
      src="https://www.youtube-nocookie.com/embed/${id}?${params}${t}"
      title="${esc(video.title)}"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
      loading="lazy"
      referrerpolicy="strict-origin-when-cross-origin"></iframe>
    <div class="yt-fallback">
      Video not loading? <a href="${watchUrl}" target="_blank" rel="noopener">Watch it directly on YouTube &#8599;</a>
    </div>`;
}

function embedSrc(video) {
  return `
    <iframe
      src="${esc(video.source)}"
      title="${esc(video.title)}"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowfullscreen></iframe>`;
}

/* ---------- Load catalog ---------- */
async function loadCatalog() {
  try {
    const res = await fetch('/api/catalog');
    CATALOG = await res.json();
    if (!CATALOG.videos) CATALOG.videos = [];
    if (!CATALOG.channels) CATALOG.channels = [];
    applyChurchConfig();
    render();
  } catch (err) {
    // static-preview fallback (no server): try local data file
    try {
      const res = await fetch('data/videos.json');
      CATALOG = await res.json();
      if (!CATALOG.videos) CATALOG.videos = [];
      if (!CATALOG.channels) CATALOG.channels = [];
      applyChurchConfig();
      render();
      return;
    } catch (e2) { /* ignore */ }
    document.getElementById('main').innerHTML =
      `<div class="empty">&#9888;&#65039; Couldn't load the channel catalog.<br>Check that <b>data/videos.json</b> is valid.</div>`;
  }
}

/* ---------- Church config (from data/videos.json "church" + "live") ---------- */
function applyChurchConfig() {
  const ch = CATALOG.church;
  if (ch) {
    if (ch.themeVerse) document.getElementById('themeVerse').textContent = ch.themeVerse;
    if (ch.location) document.getElementById('visitLoc').textContent = ch.location;
    if (ch.mapUrl) document.getElementById('mapLink').href = ch.mapUrl;
    if (ch.giving && ch.giving.note) document.getElementById('givingNote').textContent = ch.giving.note;
    if (ch.contact) {
      const fb = document.getElementById('fbLink');
      if (ch.contact.facebook) {
        fb.href = ch.contact.facebook;
        fb.style.display = '';
      } else {
        fb.style.display = 'none';
      }
    }
    document.title = `DWIM TV — ${ch.name || 'Destiny Word International Ministries'}`;
  }

  applyLiveUI();
  const wa = document.getElementById('shareWa');
  if (wa) wa.href = 'https://wa.me/?text=' + encodeURIComponent('Join Destiny Word International Ministries LIVE on DWIM TV - Sundays 11:00 AM (CAT). ' + location.origin);
}

/* Live refresh (admin tab changes -> update this tab) */
if ('BroadcastChannel' in window) {
  const bc = new BroadcastChannel('dwim-tv');
  bc.onmessage = (e) => { if (e.data && e.data.t === 'catalog-changed') loadCatalog(); };
}

/* ---------- Render ---------- */
function render() {
  renderChannels();
  renderMain();
}

function renderChannels() {
  const wrap = document.getElementById('channels');
  const chips = CATALOG.channels.map(ch => `
    <button class="chip ${ch.id === activeChannel ? 'active' : ''}" onclick="setChannel('${esc(ch.id)}')">
      <span>${esc(ch.icon || '&#128250;')}</span> ${esc(ch.name)}
    </button>`).join('');
  wrap.innerHTML = chips;
}

function filtered() {
  let list = CATALOG.videos;
  if (activeChannel !== 'ch-all') list = list.filter(v => v.channel === activeChannel);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(v =>
      (v.title || '').toLowerCase().includes(q) ||
      (v.desc || '').toLowerCase().includes(q) ||
      (v.category || '').toLowerCase().includes(q) ||
      (v.tags || []).some(t => String(t).toLowerCase().includes(q))
    );
  }
  // Pinned/featured videos float to the top, otherwise the catalog's own order is kept
  return list.slice().sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
}

function renderMain() {
  const main = document.getElementById('main');
  const list = filtered();

  if (!list.length) {
    main.innerHTML = `<div class="empty">&#127968; Nothing on this channel right now.<br>New messages are added soon — check back or pray along with us.</div>`;
    return;
  }

  const hero = list[0];
  const rest = list.slice(1);

  const heroHTML = `
    <section class="section" id="watch" style="padding-top:26px">
      <div class="featured" onclick="playVideo('${esc(hero.id)}')">
        <div class="featured-thumb">
          <img src="${esc(hero.thumb)}" alt="${esc(hero.title)}" onerror="this.style.display='none'">
          <div class="play-overlay"><span class="circle">&#9654;</span></div>
          <span class="duration">${esc(hero.duration || '')}</span>
        </div>
        <div class="featured-body">
          <span class="hero-badge">${esc(hero.category || 'MESSAGE')}</span>
          <h2 class="featured-title">${esc(hero.title)}</h2>
          <p class="hero-desc">${esc(hero.desc || '')}</p>
          <span class="btn-play-hero">&#9654; Watch Now</span>
        </div>
      </div>
    </section>`;

  const gridHTML = `
    <section class="section">
      <div class="section-title">
        <h2>${searchQuery ? 'Search Results' : 'More to Watch'}</h2>
        <span class="count">${list.length} videos</span>
      </div>
      <div class="grid">
        ${rest.map(cardHTML).join('')}
      </div>
    </section>`;

  main.innerHTML = heroHTML + gridHTML;
}

function cardHTML(v) {
  return `
    <article class="card" onclick="playVideo('${esc(v.id)}')">
      <div class="thumbwrap">
        <img src="${esc(v.thumb)}" alt="${esc(v.title)}" loading="lazy"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 320 180%22><rect fill=%22%2310182f%22 width=%22320%22 height=%22180%22/><text x=%22160%22 y=%2295%22 fill=%22%235f6890%22 font-size=%2216%22 text-anchor=%22middle%22 font-family=%22sans-serif%22>DWIM TV</text></svg>'">
        <span class="duration">${esc(v.duration || '')}</span>
        <div class="play-overlay"><span class="circle">&#9654;</span></div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(v.title)}</h3>
        <div class="card-meta">
          <span class="cat">${esc(v.category || 'VIDEO')}</span>
          <span>&#8226;</span>
          <span>${esc(v.channel ? (CATALOG.channels.find(c => c.id === v.channel) || {}).name || '' : '')}</span>
        </div>
      </div>
    </article>`;
}

/* ---------- Interactions ---------- */
function setChannel(id) {
  activeChannel = id;
  render();
  const watch = document.getElementById('watch');
  if (watch) watch.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goHome(e) {
  if (e) e.preventDefault();
  activeChannel = 'ch-all';
  searchQuery = '';
  const s = document.getElementById('search');
  if (s) s.value = '';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  renderMain();
});

/* Play the first video of a given channel (e.g. "Pray Along Now") */
function playFirstOf(channelId) {
  const v = (CATALOG.videos || []).find(x => x.channel === channelId);
  if (v) playVideo(v.id);
}

/* ---------- Watch Live ---------- */
function watchLive() {
  const live = CATALOG.live;
  if (live && live.source) {
    openPlayer(live.title || 'DWIM TV Live', live.type || 'youtube', live.source,
      'ON AIR', 'Join the DWIM family live — distance is not a barrier. May the Lord bless you as you join us in worship, the Word and prayer.', 'LIVE', true);
  } else {
    // no stream yet -> if a service is under way tell the viewer, else guide the viewer to the next service + latest message
    const latest = (CATALOG.videos || [])[0];
    const target = document.getElementById('hero');
    if (target) target.scrollIntoView({ behavior: 'smooth' });
    if (latest) setTimeout(() => playVideo(latest.id), 400);
  }
}

/* ---------- Player ---------- */
function playVideo(id) {
  const v = CATALOG.videos.find(x => x.id === id);
  if (!v) return;
  openPlayer(v.title || 'Now Playing', v.type, v.source, v.duration || '—', v.desc || '', v.category);
}

function openPlayer(title, type, source, duration, desc, category, isLive) {
  document.getElementById('playerTitle').textContent = title;
  document.getElementById('playerCat').textContent = category || 'DWIM TV';
  document.getElementById('playerDur').textContent = duration || '—';
  document.getElementById('playerDesc').textContent = desc || '';

  const frame = document.getElementById('playerFrame');
  const fake = { source, title };
  if (type === 'youtube') frame.innerHTML = youtubeSrc(fake);
  else if (type === 'direct') frame.innerHTML = directSrc(fake);
  else frame.innerHTML = embedSrc(fake);

  // live theatre: YouTube live chat beside the player + prayer / give / share actions
  const box = document.getElementById('playerBox');
  const chat = document.getElementById('liveChat');
  const actions = document.getElementById('liveActions');
  const vid = type === 'youtube' ? ytId(source) : null;
  if (isLive && vid) {
    document.getElementById('liveChatBody').innerHTML =
      `<iframe src="https://www.youtube.com/live_chat?v=${vid}&embed_domain=${encodeURIComponent(location.hostname)}" title="Live chat"></iframe>`;
    chat.style.display = ''; actions.style.display = ''; box.classList.add('is-live-theatre');
  } else {
    document.getElementById('liveChatBody').innerHTML = '';
    chat.style.display = 'none'; actions.style.display = 'none'; box.classList.remove('is-live-theatre');
  }

  document.getElementById('playerModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePlayer() {
  document.getElementById('playerModal').classList.remove('open');
  document.getElementById('playerFrame').innerHTML = '';
  document.getElementById('liveChatBody').innerHTML = '';
  document.body.style.overflow = '';
}

document.getElementById('playerModal').addEventListener('click', (e) => {
  if (e.target.id === 'playerModal') closePlayer();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePlayer();
});

/* ---------- Service schedule (Sundays 11:00 AM CAT = UTC+2, no DST) ---------- */
const CAT_OFFSET_MS = 2 * 3600 * 1000;
const WEEK_MS = 7 * 86400 * 1000;

function serviceSchedule(nowMs = Date.now()) {
  const hours = Number((CATALOG.church || {}).serviceDurationHours) || 3;
  const cat = new Date(nowMs + CAT_OFFSET_MS);
  // 11:00 CAT on the most recent Sunday (today if it is Sunday), expressed in real UTC ms
  const lastStart = Date.UTC(cat.getUTCFullYear(), cat.getUTCMonth(), cat.getUTCDate() - cat.getUTCDay(), 11, 0, 0) - CAT_OFFSET_MS;
  const inWindow = nowMs >= lastStart && nowMs < lastStart + hours * 3600 * 1000;
  const nextStart = nowMs < lastStart ? lastStart : lastStart + WEEK_MS;
  return { inWindow, nextStart, windowStart: lastStart };
}

/* Is the stream "on air"? Admin sets a live URL; during the service window we also show a "starting" state */
function liveState() {
  const hasSource = !!(CATALOG.live && CATALOG.live.source);
  const { inWindow } = serviceSchedule();
  if (hasSource) return 'live';
  if (inWindow) return 'starting';
  return 'upcoming';
}

function tickCountdown() {
  const d = document.getElementById('cdD');
  if (!d) return;
  const { nextStart } = serviceSchedule();
  const sec = Math.max(0, Math.floor((nextStart - Date.now()) / 1000));
  d.textContent = String(Math.floor(sec / 86400)).padStart(2, '0');
  document.getElementById('cdH').textContent = String(Math.floor((sec % 86400) / 3600)).padStart(2, '0');
  document.getElementById('cdM').textContent = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  document.getElementById('cdS').textContent = String(sec % 60).padStart(2, '0');

  const local = document.getElementById('cdLocal');
  if (local && !local.dataset.set) {
    try {
      const t = new Date(nextStart).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      local.textContent = `That is ${t} in your time zone`;
      local.dataset.set = '1';
    } catch (e) { /* ignore */ }
  }
  // flip UI the second a service window opens/closes
  const st = liveState();
  if (st !== lastLiveState) applyLiveUI();
}

/* ---------- Live status UI (hero, banner, tab title) ---------- */
let lastLiveState = null;
let wasLive = false;
const LIVE_PREFIX = /^\u{1F534} LIVE \u2014 /u;

function applyLiveUI() {
  const st = liveState();
  lastLiveState = st;
  const live = CATALOG.live || {};
  const cd = document.getElementById('countdown');
  const ln = document.getElementById('liveNow');
  const banner = document.getElementById('liveBanner');
  const dot = document.getElementById('liveDot');
  const word = dot && dot.querySelector('.word');

  if (st === 'live') {
    if (cd) cd.style.display = 'none';
    if (ln) ln.style.display = '';
    document.getElementById('liveNowTitle').textContent = live.title || 'DWIM TV Live';
    document.getElementById('liveNowBtn').innerHTML = '&#9654; Join the Service';
    document.getElementById('liveNowSub').textContent = 'The service is live right now. Join the DWIM family from wherever you are.';
    if (banner) { banner.style.display = 'flex'; document.getElementById('liveTitle').textContent = live.title || 'DWIM TV Live'; }
    if (word) word.textContent = 'ON AIR';
    if (dot) dot.classList.add('is-live');
    document.title = '\u{1F534} LIVE \u2014 ' + document.title.replace(LIVE_PREFIX, '');
  } else if (st === 'starting') {
    if (cd) cd.style.display = 'none';
    if (ln) ln.style.display = '';
    document.getElementById('liveNowTitle').textContent = 'Service is starting';
    document.getElementById('liveNowBtn').innerHTML = '&#9654; Watch the Latest Message';
    document.getElementById('liveNowSub').textContent = 'Our Sunday service is under way. The live stream will appear here the moment it goes on air. This page updates by itself, so no need to refresh.';
    if (banner) banner.style.display = 'none';
    if (word) word.textContent = 'STARTING';
    if (dot) dot.classList.remove('is-live');
    document.title = document.title.replace(LIVE_PREFIX, '');
  } else {
    if (cd) cd.style.display = '';
    if (ln) ln.style.display = 'none';
    if (banner) banner.style.display = 'none';
    if (word) word.textContent = 'LIVE SUNDAYS';
    if (dot) dot.classList.remove('is-live');
    document.title = document.title.replace(LIVE_PREFIX, '');
  }
  // the old "Watch Live" label on the nav button
  const navBtn = document.querySelector('.btn-live-sm');
  if (navBtn) navBtn.innerHTML = st === 'live' ? '&#9679; Watch Live Now' : '&#9654; Watch Live';

  if (st === 'live' && !wasLive) showToast('\u{1F534} We are LIVE! Tap to join the service.', watchLive);
  wasLive = st === 'live';
}

function showToast(msg, onClick) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.onclick = () => { t.classList.remove('show'); if (onClick) onClick(); };
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 12000);
}

/* Poll the live status so viewers see ON AIR without refreshing */
async function pollLive() {
  try {
    const res = await fetch('/api/live', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const before = JSON.stringify(CATALOG.live || {});
    CATALOG.live = data.live || null;
    if (JSON.stringify(CATALOG.live || {}) !== before) applyLiveUI();
  } catch (e) { /* offline - ignore */ }
}
function schedulePolling() {
  // every 20s during a service window, every 2 minutes otherwise; paused while tab is hidden
  setTimeout(async () => {
    if (!document.hidden) await pollLive();
    schedulePolling();
  }, serviceSchedule().inWindow ? 20000 : 120000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });

/* ---------- Share ---------- */
function shareService() {
  const url = location.origin;
  const text = 'Join Destiny Word International Ministries LIVE on DWIM TV - Sundays 11:00 AM (CAT). Distance is not a barrier!';
  if (navigator.share) navigator.share({ title: 'DWIM TV', text, url }).catch(() => {});
  else window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener');
}

/* ---------- Contact buttons (prayer / giving / testimony) ---------- */
function initContactButtons() {
  const ch = CATALOG.church || {};
  const contact = ch.contact || {};
  const fb = contact.facebook || '';
  const wa = contact.whatsapp || '';
  const phone = contact.phone || '';
  const email = contact.email || '';

  // choose best contact channel
  let href = '#';
  let label = 'Contact the Church';
  if (wa) { href = `https://wa.me/${wa}`; label = 'Message on WhatsApp'; }
  else if (phone) { href = `tel:${phone}`; label = 'Call the Church'; }
  else if (email) { href = `mailto:${email}`; label = 'Email the Church'; }
  else if (fb) { href = fb; label = 'Message us on Facebook'; }

  const prayerBtn = document.getElementById('prayerBtn');
  if (prayerBtn) { prayerBtn.href = href; prayerBtn.innerHTML = `&#9993; ${esc(label)}`; }
  const testiBtn = document.getElementById('testiBtn');
  if (testiBtn) { testiBtn.href = href; testiBtn.innerHTML = `&#9998; ${esc(label)}`; }
  const giveContact = document.getElementById('giveContact');
  if (giveContact) { giveContact.href = href; giveContact.innerHTML = `&#9742; ${esc(label)}`; }

  // giving details (bank account) if provided
  const giving = ch.giving || {};
  if (giving.accountNumber) {
    const details = document.createElement('p');
    details.className = 'giving-details';
    details.innerHTML = `<b>${esc(giving.bankName || 'Bank')}</b> &middot; ${esc(giving.accountName || 'Destiny Word International Ministries')} &middot; Acc: <b>${esc(giving.accountNumber)}</b>`;
    const givingBlock = document.getElementById('giving');
    if (givingBlock) givingBlock.querySelector('.block-content').appendChild(details);
  }
}

/* ---------- Boot ---------- */
document.getElementById('year').textContent = new Date().getFullYear();
tickCountdown();
setInterval(tickCountdown, 1000);
loadCatalog().then(() => { initContactButtons(); schedulePolling(); });
