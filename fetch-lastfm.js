// ============================================
// 本地 JSON 資料讀取模組
// ============================================
var LastFmAPI = window.LastFmAPI = (() => {
  const runtimeConfig = window.DASHBOARD_CONFIG || {};
  const cache = {
    meta: null,
    stats: null,
    tags: null,
    recent: null,
    top: new Map(),
    chunks: new Map(),
  };

  function recentApi(path) {
    const base = (runtimeConfig.recentApiBase || '').replace(/\/$/, '');
    return base ? `${base}${path}` : '';
  }

  function bust(path) {
    return `${path}?t=${Date.now()}`;
  }

  async function fetchJSON(path, fresh = false) {
    const res = await fetch(fresh ? bust(path) : path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`讀取失敗：${path} (${res.status})`);
    return res.json();
  }

  async function getMeta(fresh = false) {
    if (!fresh && cache.meta) return cache.meta;
    cache.meta = await fetchJSON('data/meta.json', fresh);
    return cache.meta;
  }

  async function getUserInfo(fresh = false) {
    const meta = await getMeta(fresh);
    return meta.user || null;
  }

  async function getRecentTracks(limit = 50, fresh = false) {
    if (!fresh && cache.recent) {
      return {
        track: (cache.recent.track || []).slice(0, limit),
        '@attr': cache.recent['@attr'] || {},
      };
    }
    cache.recent = await fetchJSON('data/recent.json', fresh);
    return {
      track: (cache.recent.track || []).slice(0, limit),
      '@attr': cache.recent['@attr'] || {},
    };
  }

  async function getLiveRecentTracks(limit = 50, fresh = false) {
    const remoteRecent = recentApi(`/recent?limit=${encodeURIComponent(limit)}`);
    if (remoteRecent) {
      try {
        return await fetchJSON(remoteRecent, fresh);
      } catch (error) {
        console.warn('Remote recent API failed, fallback to local JSON:', error);
      }
    }
    return getRecentTracks(limit, fresh);
  }

  async function getTopArtists(period = '7day', limit = 10, fresh = false) {
    const key = `artists:${period}`;
    if (!fresh && cache.top.has(key)) return { artist: cache.top.get(key).slice(0, limit) };
    const data = await fetchJSON(`data/top/${period}.json`, fresh);
    const items = data.artist || [];
    cache.top.set(key, items);
    return { artist: items.slice(0, limit) };
  }

  async function getTopAlbums(period = '7day', limit = 10, fresh = false) {
    const key = `albums:${period}`;
    if (!fresh && cache.top.has(key)) return { album: cache.top.get(key).slice(0, limit) };
    const data = await fetchJSON(`data/top/${period}.json`, fresh);
    const items = data.album || [];
    cache.top.set(key, items);
    return { album: items.slice(0, limit) };
  }

  async function getTopTracks(period = '7day', limit = 10, fresh = false) {
    const key = `tracks:${period}`;
    if (!fresh && cache.top.has(key)) return { track: cache.top.get(key).slice(0, limit) };
    const data = await fetchJSON(`data/top/${period}.json`, fresh);
    const items = data.track || [];
    cache.top.set(key, items);
    return { track: items.slice(0, limit) };
  }

  async function getTagCloud(fresh = false) {
    if (!fresh && cache.tags) return cache.tags;
    cache.tags = await fetchJSON('data/tags.json', fresh);
    return cache.tags;
  }

  async function getStats(fresh = false) {
    if (!fresh && cache.stats) return cache.stats;
    cache.stats = await fetchJSON('data/stats.json', fresh);
    return cache.stats;
  }

  async function getChunkList() {
    const meta = await getMeta();
    return meta.chunks || [];
  }

  async function getChunk(file, fresh = false) {
    if (!fresh && cache.chunks.has(file)) return cache.chunks.get(file);
    const data = await fetchJSON(`data/chunks/${file}`, fresh);
    cache.chunks.set(file, data);
    return data;
  }

  async function getAllTracks() {
    const chunks = await getChunkList();
    const files = await Promise.all(chunks.map(chunk => getChunk(chunk.file)));
    return files.flatMap(file => file.tracks || []);
  }

  return {
    getMeta,
    getUserInfo,
    getRecentTracks,
    getLiveRecentTracks,
    getTopArtists,
    getTopAlbums,
    getTopTracks,
    getTagCloud,
    getStats,
    getChunkList,
    getChunk,
    getAllTracks,
  };
})();
