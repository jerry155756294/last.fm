// ============================================
// 本地資料檔控制模組
// ============================================
var CacheControl = window.CacheControl = (() => {
  async function ensureDB() {
    return window.LastFmAPI.getMeta();
  }

  async function count() {
    const meta = await window.LastFmAPI.getMeta();
    return +meta.trackCount || 0;
  }

  async function computeStats() {
    return window.LastFmAPI.getStats();
  }

  async function getAll() {
    return window.LastFmAPI.getAllTracks();
  }

  async function exportJSON() {
    const tracks = await getAll();
    const meta = await window.LastFmAPI.getMeta();
    const blob = new Blob([JSON.stringify(tracks, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lastfm-${meta.user?.name || 'export'}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importJSON() {
    throw new Error('分段 JSON 模式不支援瀏覽器匯入，請改用 build script 更新 data/');
  }

  async function saveTracks() {
    return 0;
  }

  async function setMeta() {
    throw new Error('分段 JSON 模式不支援瀏覽器寫入');
  }

  async function getMeta(key) {
    const meta = await window.LastFmAPI.getMeta();
    if (!key) return meta;
    return meta[key] ?? null;
  }

  async function backfill() {
    return { skipped: true };
  }

  return { ensureDB, count, computeStats, getAll, exportJSON, importJSON, saveTracks, setMeta, getMeta, backfill };
})();
