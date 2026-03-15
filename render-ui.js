// ============================================
// UI 渲染與本地 JSON 更新模組
// ============================================
var RenderUI = window.RenderUI = (() => {
  let currentNP = null;
  let pollTimer = null;
  let period = '7day';
  let datasetVersion = '';
  let isRefreshing = false;
  const runtimeConfig = window.DASHBOARD_CONFIG || {};
  const dashboardMode = runtimeConfig.mode || 'local';
  const hasLiveApi = dashboardMode === 'local' || !!runtimeConfig.recentApiBase;

  const esc = s => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
  const fmtNum = n => Number(n || 0).toLocaleString('en-US');
  const $ = id => document.getElementById(id);

  function timeAgo(ts) {
    const d = Math.floor(Date.now() / 1000) - ts;
    if (d < 60) return '剛剛';
    if (d < 3600) return `${Math.floor(d / 60)} 分鐘前`;
    if (d < 86400) return `${Math.floor(d / 3600)} 小時前`;
    if (d < 604800) return `${Math.floor(d / 86400)} 天前`;
    return new Date(ts * 1000).toLocaleDateString('zh-TW');
  }

  function fmtDate(ts) {
    return new Date(ts * 1000).toLocaleString('zh-TW', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function getImg(t, size = 'extralarge') {
    if (!t?.image) return '';
    if (typeof t.image === 'string') return t.image;
    const found = (t.image.find(i => i.size === size) || t.image[t.image.length - 1])?.['#text'] || '';
    if (!found || found.includes('2a96cbd8b46e442fc41c2b86b821562f')) return '';
    return found;
  }

  function getImgBest(t, sizes = ['extralarge', 'large', 'medium', 'small']) {
    for (const size of sizes) {
      const url = getImg(t, size);
      if (url) return url;
    }
    return '';
  }

  const FALLBACK_ART = 'data:image/svg+xml;base64,' + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' +
    '<rect fill="#2a2a2a" width="300" height="300" rx="8"/>' +
    '<circle cx="150" cy="140" r="50" fill="none" stroke="#555" stroke-width="3"/>' +
    '<path d="M175 140 L175 90" stroke="#555" stroke-width="3" fill="none"/>' +
    '<rect x="173" y="85" width="12" height="8" rx="2" fill="#555"/>' +
    '</svg>'
  );

  function safeImgLoad(imgEl, url, maxRetry = 2) {
    if (!url || url === FALLBACK_ART) {
      imgEl.src = FALLBACK_ART;
      return;
    }
    let attempt = 0;
    imgEl.onload = null;
    imgEl.onerror = () => {
      attempt++;
      if (attempt <= maxRetry) {
        setTimeout(() => {
          imgEl.src = '';
          imgEl.src = url + (url.includes('?') ? '&' : '?') + '_r=' + attempt;
        }, attempt * 1000 - 500);
      } else {
        imgEl.onerror = null;
        imgEl.src = FALLBACK_ART;
      }
    };
    imgEl.src = url;
  }

  window.__fallbackSrc = FALLBACK_ART;
  window.__imgFallback = function(el, retries) {
    const r = parseInt(retries || '0', 10);
    const origSrc = el.dataset.origSrc || el.src;
    if (!el.dataset.origSrc) el.dataset.origSrc = origSrc;
    if (r < 2 && origSrc && !origSrc.startsWith('data:')) {
      el.dataset.retry = String(r + 1);
      setTimeout(() => {
        el.src = '';
        el.src = origSrc + (origSrc.includes('?') ? '&' : '?') + '_r=' + (r + 1);
      }, (r + 1) * 800);
      el.onerror = function() { window.__imgFallback(this, r + 1); };
    } else {
      el.onerror = null;
      el.src = window.__fallbackSrc;
    }
  };

  function imgTag(url, cls, alt = '') {
    const src = url || FALLBACK_ART;
    const isReal = src !== FALLBACK_ART;
    return `<img class="${cls}" src="${src}" alt="${esc(alt)}" loading="lazy" decoding="async"${isReal ? ' onerror="window.__imgFallback(this,0)"' : ''}>`;
  }

  function extractColor(url) {
    return new Promise(res => {
      if (!url || url.startsWith('data:')) { res({ r: 30, g: 40, b: 60 }); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = c.height = 8;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, 8, 8);
          const d = ctx.getImageData(0, 0, 8, 8).data;
          let r = 0; let g = 0; let b = 0; let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            r += d[i];
            g += d[i + 1];
            b += d[i + 2];
            n++;
          }
          res({ r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) });
        } catch {
          res({ r: 30, g: 40, b: 60 });
        }
      };
      img.onerror = () => res({ r: 30, g: 40, b: 60 });
      img.src = url;
    });
  }

  async function renderNowPlaying(data) {
    const tracks = data.track || [];
    const np = tracks.find(t => t['@attr']?.nowplaying === 'true');
    const card = $('now-playing');

    if (np) {
      const artist = np.artist?.name || np.artist?.['#text'] || '';
      const album = np.album?.['#text'] || '';
      const name = np.name;
      const imgUrl = getImgBest(np, ['large', 'extralarge', 'medium', 'small']) || FALLBACK_ART;
      const isNew = !currentNP || currentNP.name !== name || currentNP.artist !== artist;
      currentNP = { name, artist };

      safeImgLoad($('np-art'), imgUrl);
      $('np-bg').style.backgroundImage = `url('${imgUrl}')`;
      $('np-badge').className = 'np-badge np-badge-live';
      $('np-badge').innerHTML = '<span class="np-pulse"></span><span>正在播放</span>';
      $('np-title').textContent = name;
      $('np-artist').textContent = artist;
      $('np-album').textContent = album;
      $('np-time-ago').textContent = '';
      card.classList.remove('is-idle');

      if (isNew) {
        const content = card.querySelector('.np-content');
        content.classList.remove('np-animate');
        void content.offsetWidth;
        content.classList.add('np-animate');
        const { r, g, b } = await extractColor(imgUrl);
        document.documentElement.style.setProperty('--ambient', `rgba(${r},${g},${b},0.12)`);
      }
      return;
    }

    const last = tracks[0];
    currentNP = null;
    card.classList.add('is-idle');
    if (!last) return;
    const artist = last.artist?.name || last.artist?.['#text'] || '';
    const imgUrl = getImgBest(last, ['large', 'extralarge', 'medium', 'small']) || FALLBACK_ART;
    const ts = last.date?.uts ? +last.date.uts : null;
    safeImgLoad($('np-art'), imgUrl);
    $('np-bg').style.backgroundImage = `url('${imgUrl}')`;
    $('np-badge').className = 'np-badge np-badge-idle';
    $('np-badge').innerHTML = '<span>最近播放</span>';
    $('np-title').textContent = last.name;
    $('np-artist').textContent = artist;
    $('np-album').textContent = last.album?.['#text'] || '';
    $('np-time-ago').textContent = ts ? timeAgo(ts) : '';
    const { r, g, b } = await extractColor(imgUrl);
    document.documentElement.style.setProperty('--ambient', `rgba(${r},${g},${b},0.08)`);
  }

  function renderRecent(data) {
    const el = $('recent-tracks-list');
    if (!el) return;
    const tracks = (data.track || []).filter(t => !t['@attr']?.nowplaying);
    if (!tracks.length) { el.innerHTML = '<p class="muted">暫無資料</p>'; return; }
    el.innerHTML = tracks.slice(0, 20).map(t => {
      const artist = t.artist?.name || t.artist?.['#text'] || '';
      const img = getImgBest(t, ['medium', 'large', 'small', 'extralarge']);
      const ts = t.date?.uts ? +t.date.uts : null;
      const loved = t.loved === '1';
      return `<div class="track-row">
        ${imgTag(img, 'track-thumb')}
        <div class="track-info">
          <span class="track-name">${esc(t.name)}</span>
          <span class="track-artist">${esc(artist)}${t.album?.['#text'] ? ' — ' + esc(t.album['#text']) : ''}</span>
        </div>
        ${loved ? '<span class="track-loved" title="Loved">♥</span>' : ''}
        <span class="track-time">${ts ? fmtDate(ts) : ''}</span>
      </div>`;
    }).join('');
  }

  function renderStats(u, meta = {}) {
    const el = $('stats-cards');
    if (!el || !u) return;
    const sc = +(meta.trackCount || u.playcount || 0);
    const ar = +u.artist_count || 0;
    const al = +u.album_count || 0;
    const tk = +u.track_count || 0;
    const loved = +(meta.lovedTrackCount || 0);
    el.innerHTML = `
      <div class="stat-card"><span class="stat-value">${fmtNum(sc)}</span><span class="stat-label">Scrobbles</span></div>
      <div class="stat-card"><span class="stat-value">${fmtNum(ar)}</span><span class="stat-label">藝人</span></div>
      <div class="stat-card"><span class="stat-value">${fmtNum(loved)}</span><span class="stat-label">Loved Tracks</span></div>
      <div class="stat-card"><span class="stat-value">${fmtNum(al)}</span><span class="stat-label">專輯</span></div>
      <div class="stat-card"><span class="stat-value">${fmtNum(tk)}</span><span class="stat-label">曲目</span></div>`;

    const nameEl = $('username-display');
    if (nameEl) {
      nameEl.textContent = u.name || 'Last.fm';
      nameEl.href = u.url || '#';
    }
    const avEl = $('user-avatar');
    if (avEl && u.image) {
      const img = getImgBest(u, ['large', 'medium', 'small', 'extralarge']);
      if (img) safeImgLoad(avEl, img);
    }
  }

  function renderTopLists(artists, albums, tracks) {
    renderTop('top-artists', artists?.artist || [], 'artist');
    renderTop('top-albums', albums?.album || [], 'album');
    renderTop('top-tracks', tracks?.track || [], 'track');
  }

  function renderTop(id, items, type) {
    const el = $(id);
    if (!el) return;
    if (!items.length) { el.innerHTML = '<p class="muted">暫無資料</p>'; return; }
    el.innerHTML = items.slice(0, 10).map((item, i) => {
      const count = +item.playcount || 0;
      let sub = '';
      if (type === 'album' || type === 'track') sub = item.artist?.name || item.artist?.['#text'] || '';
      const showImg = type !== 'artist';
      const img = showImg ? getImgBest(item, ['medium', 'large', 'small', 'extralarge']) : '';
      return `<div class="top-item">
        <span class="top-rank">${i + 1}</span>
        ${showImg ? imgTag(img, 'top-thumb', item.name) : ''}
        <div class="top-info">
          <span class="top-name">${esc(item.name)}</span>
          ${sub ? `<span class="top-subtitle">${esc(sub)}</span>` : ''}
        </div>
        <span class="top-count">${fmtNum(count)}</span>
      </div>`;
    }).join('');
  }

  function renderClock(hourly) {
    const canvas = $('listening-clock');
    if (!canvas || !hourly || !hourly.some(v => v > 0)) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(canvas.parentElement.clientWidth, 280);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.scale(dpr, dpr);
    const cx = size / 2;
    const cy = size / 2;
    const maxR = size / 2 - 24;
    const innerR = maxR * 0.35;
    const max = Math.max(...hourly, 1);

    ctx.clearRect(0, 0, size, size);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const barColor = isDark ? [160, 202, 253] : [25, 118, 210];

    for (let h = 0; h < 24; h++) {
      const ratio = hourly[h] / max;
      const sa = ((h - 6) / 24) * Math.PI * 2 - Math.PI / 48;
      const ea = ((h - 5) / 24) * Math.PI * 2 - Math.PI / 48;
      const r = innerR + (maxR - innerR) * ratio;
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, sa, ea);
      ctx.arc(cx, cy, r, ea, sa, true);
      ctx.closePath();
      const a = 0.2 + ratio * 0.8;
      ctx.fillStyle = `rgba(${barColor[0]},${barColor[1]},${barColor[2]},${a})`;
      ctx.fill();
    }

    const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const tzShort = tzName.split('/').pop().replace(/_/g, ' ') || '本地';
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)';
    ctx.font = '500 11px var(--font-sans)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('24hr', cx, cy - 6);
    ctx.fillText(tzShort, cx, cy + 8);

    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)';
    ctx.font = '400 9px var(--font-sans)';
    for (const h of [0, 6, 12, 18]) {
      const angle = ((h - 6) / 24) * Math.PI * 2;
      ctx.fillText(`${h}:00`, cx + Math.cos(angle) * (maxR + 14), cy + Math.sin(angle) * (maxR + 14));
    }
  }

  function renderHeatmap(daily) {
    const el = $('heatmap');
    if (!el || !daily) return;
    const today = new Date();
    const weeks = 52;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    start.setDate(start.getDate() - weeks * 7 + 1);
    start.setDate(start.getDate() - start.getDay());
    const vals = Object.values(daily);
    const max = Math.max(...vals, 1);

    let h = '<div class="heatmap-grid"><div style="display:flex;gap:3px;">';
    h += '<div class="heatmap-labels">';
    ['', 'Mon', '', 'Wed', '', 'Fri', ''].forEach(l => { h += `<span class="heatmap-day-label">${l}</span>`; });
    h += '</div><div class="heatmap-weeks">';
    const cur = new Date(start);
    for (let w = 0; w < weeks; w++) {
      h += '<div class="heatmap-week">';
      for (let d = 0; d < 7; d++) {
        const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
        const c = daily[ds] || 0;
        const lv = c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4));
        h += `<div class="heatmap-cell hm-level-${lv}" title="${ds}: ${c} scrobbles"></div>`;
        cur.setDate(cur.getDate() + 1);
      }
      h += '</div>';
    }
    h += '</div></div>';
    h += '<div class="heatmap-months">';
    const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mDate = new Date(start);
    let lastM = -1;
    for (let w = 0; w < weeks; w++) {
      const m = mDate.getMonth();
      if (m !== lastM) {
        h += `<span>${mNames[m]}</span>`;
        lastM = m;
      } else {
        h += '<span></span>';
      }
      mDate.setDate(mDate.getDate() + 7);
    }
    h += '</div>';
    h += '<div class="heatmap-legend"><span>少</span>';
    for (let i = 0; i <= 4; i++) h += `<div class="heatmap-cell hm-level-${i}"></div>`;
    h += '<span>多</span></div></div>';
    el.innerHTML = h;
  }

  function renderTrend(monthly) {
    const canvas = $('monthly-trend');
    if (!canvas || !monthly) return;
    const entries = Object.entries(monthly).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
    if (!entries.length) return;

    if (entries.length === 1) {
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.parentElement.clientWidth;
      const ht = 200;
      canvas.width = w * dpr;
      canvas.height = ht * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = ht + 'px';
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, ht);
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const lc = isDark ? [160, 202, 253] : [25, 118, 210];
      const val = entries[0][1];
      const label = entries[0][0].slice(5);
      ctx.fillStyle = `rgba(${lc[0]},${lc[1]},${lc[2]},0.6)`;
      ctx.fillRect(w / 2 - 30, 20, 60, ht - 70);
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
      ctx.font = '500 14px var(--font-mono)';
      ctx.textAlign = 'center';
      ctx.fillText(fmtNum(val), w / 2, 15);
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
      ctx.font = '12px var(--font-sans)';
      ctx.fillText(label, w / 2, ht - 10);
      return;
    }

    const labels = entries.map(([m]) => m.slice(5));
    const values = entries.map(([, v]) => v);
    const max = Math.max(...values, 1);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.parentElement.clientWidth;
    const ht = 200;
    canvas.width = w * dpr;
    canvas.height = ht * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = ht + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, ht);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const pL = 50;
    const pR = 20;
    const pT = 20;
    const pB = 30;
    const cW = w - pL - pR;
    const cH = ht - pT - pB;

    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
    ctx.font = '10px var(--font-mono)';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = pT + cH - (cH * i / 4);
      ctx.beginPath();
      ctx.moveTo(pL, y);
      ctx.lineTo(w - pR, y);
      ctx.stroke();
      ctx.fillText(fmtNum(Math.round(max * i / 4)), pL - 8, y + 3);
    }

    const pts = values.map((v, i) => ({ x: pL + (i / (values.length - 1)) * cW, y: pT + cH - (v / max) * cH }));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pT + cH);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, pT + cH);
    ctx.closePath();
    const lineColor = isDark ? [160, 202, 253] : [25, 118, 210];
    const grad = ctx.createLinearGradient(0, pT, 0, pT + cH);
    grad.addColorStop(0, `rgba(${lineColor[0]},${lineColor[1]},${lineColor[2]},0.25)`);
    grad.addColorStop(1, `rgba(${lineColor[0]},${lineColor[1]},${lineColor[2]},0.02)`);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = `rgba(${lineColor[0]},${lineColor[1]},${lineColor[2]},0.8)`;
    ctx.lineWidth = 2;
    ctx.stroke();

    pts.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${lineColor[0]},${lineColor[1]},${lineColor[2]})`;
      ctx.fill();
    });

    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
    ctx.textAlign = 'center';
    ctx.font = '10px var(--font-sans)';
    labels.forEach((l, i) => ctx.fillText(l, pL + (i / (labels.length - 1)) * cW, ht - 8));
  }

  async function renderTags(fresh = false) {
    const el = $('tag-cloud');
    if (!el) return;
    const items = await window.LastFmAPI.getTagCloud(fresh);
    const sorted = items.slice(0, 15);
    if (!sorted.length) { el.innerHTML = '<p class="muted">暫無標籤資料</p>'; return; }
    const mx = sorted[0].count || 1;
    el.innerHTML = sorted.map(item => {
      const sz = 0.75 + ((item.count || 0) / mx) * 0.6;
      return `<span class="tag" style="font-size:${sz}rem">${esc(item.name)}</span>`;
    }).join('');
  }

  function setupTheme() {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    updateThemeIcon();

    const toggle = $('theme-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', async () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      updateThemeIcon();
      const s = await window.CacheControl.computeStats();
      if (s) {
        renderClock(s.hourly);
        renderTrend(s.monthly);
      }
    });
  }

  function updateThemeIcon() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const lightIcon = $('icon-theme-light');
    const darkIcon = $('icon-theme-dark');
    if (lightIcon) lightIcon.style.display = dark ? 'none' : 'block';
    if (darkIcon) darkIcon.style.display = dark ? 'block' : 'none';
  }

  function setupPeriod() {
    document.querySelectorAll('[data-period]').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('[data-period]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        period = btn.dataset.period;
        await refreshTop(true);
      });
    });
  }

  async function refreshTop(fresh = false) {
    const [a, al, t] = await Promise.all([
      window.LastFmAPI.getTopArtists(period, 10, fresh),
      window.LastFmAPI.getTopAlbums(period, 10, fresh),
      window.LastFmAPI.getTopTracks(period, 10, fresh),
    ]);
    renderTopLists(a, al, t);
  }

  function setupData() {
    $('btn-export')?.addEventListener('click', () => window.CacheControl.exportJSON());
    $('btn-refresh')?.addEventListener('click', () => {
      void refreshLiveData(true);
    });
    if (!hasLiveApi) {
      const btn = $('btn-refresh');
      if (btn) {
        btn.disabled = true;
        btn.title = dashboardMode === 'cloud' ? '尚未設定 Cloudflare Worker 網址' : '本地 recent.json 同步未啟動';
      }
      setLiveStatus(dashboardMode === 'cloud'
        ? 'Cloud 版尚未設定 Worker，重新抓取不可用'
        : '本地版會讀 recent.json，請啟動同步');
    }
  }

  function setLiveStatus(message) {
    const el = $('live-status');
    if (el) el.textContent = message;
  }

  function setRefreshBusy(busy) {
    isRefreshing = busy;
    const btn = $('btn-refresh');
    if (!btn) return;
    btn.disabled = busy;
    btn.innerHTML = busy
      ? '<svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/></svg> 抓取中...'
      : '<svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/></svg> 立即重新抓取';
  }

  async function updateDatasetInfo(fresh = false) {
    const meta = await window.LastFmAPI.getMeta(fresh);
    const countEl = $('cache-count');
    if (countEl) countEl.textContent = `${fmtNum(meta.trackCount || meta.user?.playcount || 0)} Scrobbles`;
    const updatedEl = $('data-updated');
    if (updatedEl) {
      updatedEl.textContent = (meta.liveUpdatedAt || meta.generatedAt)
        ? `更新於 ${new Date(meta.liveUpdatedAt || meta.generatedAt).toLocaleString('zh-TW')}`
        : '尚未建立資料';
    }
    datasetVersion = meta.generatedAt || '';
    return meta;
  }

  async function renderAll(fresh = false) {
    const [meta, userInfo, recent, stats] = await Promise.all([
      window.LastFmAPI.getMeta(fresh),
      window.LastFmAPI.getUserInfo(fresh),
      window.LastFmAPI.getRecentTracks(50, fresh),
      window.LastFmAPI.getStats(fresh),
    ]);
    renderStats(userInfo, meta);
    await renderNowPlaying(recent);
    renderRecent(recent);
    await refreshTop(fresh);
    await renderTags(fresh);
    if (stats) {
      renderClock(stats.hourly);
      renderHeatmap(stats.daily);
      renderTrend(stats.monthly);
    }
    await updateDatasetInfo(fresh);
  }

  async function refreshLiveData(manual = false) {
    if (!hasLiveApi) {
      setLiveStatus(dashboardMode === 'cloud'
        ? '尚未設定 Cloudflare Worker，無法即時重新抓取'
        : '本地版同步未啟動，無法重新抓取');
      return;
    }
    if (isRefreshing) return;
    setRefreshBusy(true);
    if (manual) setLiveStatus('正在向即時來源重新抓取...');
    try {
      const meta = await window.LastFmAPI.getMeta(true);
      const recent = await window.LastFmAPI.getLiveRecentTracks(50, true);
      const userInfo = await window.LastFmAPI.getUserInfo(true);
      await renderNowPlaying(recent);
      renderRecent(recent);
      renderStats(userInfo, meta);
      setLiveStatus(`最近播放更新於 ${new Date().toLocaleTimeString('zh-TW')}`);
      await updateDatasetInfo(true);
    } catch (e) {
      console.error('Refresh live data:', e);
      setLiveStatus('即時抓取失敗，已保留目前資料');
    } finally {
      setRefreshBusy(false);
    }
  }

  async function poll() {
    try {
      const meta = await window.LastFmAPI.getMeta(true);
      if ((meta.generatedAt || '') !== datasetVersion) {
        await renderAll(true);
        setLiveStatus(`資料集更新於 ${new Date().toLocaleTimeString('zh-TW')}`);
        return;
      }
      await refreshLiveData(false);
    } catch (e) {
      console.error('Poll:', e);
      setLiveStatus('自動抓取失敗，稍後重試');
    }
  }

  async function init() {
    setupTheme();
    try {
      await window.CacheControl.ensureDB();
      setupPeriod();
      setupData();
      await renderAll(true);
      setLiveStatus(hasLiveApi ? '最近播放已載入（Cloud 版）' : '最近播放已載入（本地版）');
      if (hasLiveApi) {
        void refreshLiveData(false);
      }
      pollTimer = setInterval(poll, 20000);
    } catch (e) {
      console.error('Init:', e);
      const app = $('app');
      if (app) {
        app.innerHTML = `<div class="setup-prompt">
          <h2>找不到本地資料檔</h2>
          <p>${esc(e.message)}</p>
          <p class="muted">請先執行 <code>npm run build:data</code>，再用本地靜態伺服器開啟頁面。</p>
        </div>`;
      }
    }
  }

  return { init };
})();

async function bootRenderUI(tries = 20) {
  if (window.LastFmAPI && window.CacheControl) {
    await RenderUI.init();
    return;
  }
  if (tries <= 0) {
    console.error('Boot:', new Error('Core modules not ready'));
    return;
  }
  setTimeout(() => {
    void bootRenderUI(tries - 1);
  }, 50);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootRenderUI();
  });
} else {
  void bootRenderUI();
}
