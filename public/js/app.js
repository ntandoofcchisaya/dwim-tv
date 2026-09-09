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

  // live stream banner
  const live = CATALOG.live;
  const banner = document.getElementById('liveBanner');
  if (live && live.source && banner) {
    banner.style.display = 'flex';
    document.getElementById('liveTitle').textContent = live.title || 'DWIM TV Live';
    document.getElementById('liveDot').querySelector('.word').textContent = 'ON AIR';
  }
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
  return list;
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
      'LIVE', 'Join the DWIM family live — distance is not a barrier. May the Lord bless you as you join us in worship, the Word and prayer.');
  } else {
    // no stream configured yet -> guide the viewer to the next service + latest message
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

function openPlayer(title, type, source, duration, desc, category) {
  document.getElementById('playerTitle').textContent = title;
  document.getElementById('playerCat').textContent = category || 'DWIM TV';
  document.getElementById('playerDur').textContent = duration || '—';
  document.getElementById('playerDesc').textContent = desc || '';

  const frame = document.getElementById('playerFrame');
  const fake = { source, title };
  if (type === 'youtube') frame.innerHTML = youtubeSrc(fake);
  else if (type === 'direct') frame.innerHTML = directSrc(fake);
  else frame.innerHTML = embedSrc(fake);

  document.getElementById('playerModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePlayer() {
  document.getElementById('playerModal').classList.remove('open');
  document.getElementById('playerFrame').innerHTML = '';
  document.body.style.overflow = '';
}

document.getElementById('playerModal').addEventListener('click', (e) => {
  if (e.target.id === 'playerModal') closePlayer();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePlayer();
});

/* ---------- Countdown to next Sunday 11:00 AM CAT (UTC+2) ---------- */
function nextSundayService() {
  // CAT is UTC+2, no DST
  const now = new Date();
  // current time in CAT
  const nowCat = new Date(now.getTime() + (2 * 60 + now.getTimezoneOffset()) * 60000);
  const target = new Date(nowCat);
  target.setHours(11, 0, 0, 0);
  let day = target.getDay(); // 0 = Sunday
  if (day === 0 && nowCat.getHours() >= 11) {
    // Sunday after service start -> next Sunday
    target.setDate(target.getDate() + 7);
  } else if (day !== 0) {
    target.setDate(target.getDate() + (7 - day)); // days until Sunday
  }
  return target;
}

function tickCountdown() {
  const d = document.getElementById('cdD');
  if (!d) return;
  const now = new Date();
  const nowCat = new Date(now.getTime() + (2 * 60 + now.getTimezoneOffset()) * 60000);
  const target = nextSundayService();
  let ms = target - nowCat;
  if (ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  d.textContent = String(days).padStart(2, '0');
  document.getElementById('cdH').textContent = String(hours).padStart(2, '0');
  document.getElementById('cdM').textContent = String(mins).padStart(2, '0');
  document.getElementById('cdS').textContent = String(secs).padStart(2, '0');
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
loadCatalog().then(initContactButtons);
