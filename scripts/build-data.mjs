import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CHUNK_DIR = path.join(DATA_DIR, 'chunks');
const TOP_DIR = path.join(DATA_DIR, 'top');
const STATE_FILE = path.join(DATA_DIR, '.build-state.json');
const PERIODS = ['7day', '1month', '3month', '6month', '12month', 'overall'];
const CHUNK_DAYS = 15;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readConfig() {
  if (process.env.LASTFM_API_KEY && process.env.LASTFM_USERNAME) {
    return { API_KEY: process.env.LASTFM_API_KEY, USERNAME: process.env.LASTFM_USERNAME };
  }
  const file = path.join(ROOT, 'api-key.js');
  const source = await fs.readFile(file, 'utf8');
  const context = { globalThis: {} };
  vm.runInNewContext(`${source}\nglobalThis.__cfg = LASTFM_CONFIG;`, context);
  const cfg = context.globalThis.__cfg;
  if (!cfg?.API_KEY || !cfg?.USERNAME) throw new Error('找不到 LASTFM_CONFIG');
  return cfg;
}

function apiUrl(config, method, extra = {}) {
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', config.API_KEY);
  url.searchParams.set('user', config.USERNAME);
  url.searchParams.set('format', 'json');
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  return url;
}

async function apiGet(config, method, extra = {}) {
  const res = await fetch(apiUrl(config, method, extra));
  if (!res.ok) throw new Error(`API ${method} ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.message || `API error ${data.error}`);
  return data;
}

function pickImage(entity, preferred = 'extralarge') {
  if (!entity?.image) return '';
  if (typeof entity.image === 'string') return entity.image;
  const url = (entity.image.find(img => img.size === preferred) || entity.image[entity.image.length - 1])?.['#text'] || '';
  return url.includes('2a96cbd8b46e442fc41c2b86b821562f') ? '' : url;
}

function normalizeTrack(track) {
  const ts = track.date?.uts ? +track.date.uts : null;
  if (!ts) return null;
  const d = new Date(ts * 1000);
  return {
    id: `${ts}_${track.artist?.['#text'] || track.artist?.name || ''}_${track.name}`,
    name: track.name,
    artist: track.artist?.['#text'] || track.artist?.name || '',
    album: track.album?.['#text'] || '',
    image: pickImage(track),
    url: track.url || '',
    ts,
    month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    hour: d.getHours(),
    wd: d.getDay(),
    loved: track.loved === '1',
  };
}

async function fetchAllTracks(config, resume = null) {
  let page = resume?.page || 1;
  let totalPages = resume?.totalPages || 1;
  const map = resume?.map || new Map();

  if (resume) {
    console.log(`接續上次中斷進度，從第 ${page} 頁繼續...`);
  }

  while (page <= totalPages) {
    const data = await apiGet(config, 'user.getrecenttracks', { limit: 200, page, extended: 1 });
    const recent = data.recenttracks;
    totalPages = +recent['@attr']?.totalPages || 1;
    for (const track of recent.track || []) {
      const row = normalizeTrack(track);
      if (row) map.set(row.id, row);
    }
    await writeState({
      username: config.USERNAME,
      startedAt: resume?.startedAt || new Date().toISOString(),
      nextPage: page + 1,
      totalPages,
      tracks: [...map.values()],
    });
    process.stdout.write(`\r抓取歷史資料 ${page}/${totalPages}`);
    page += 1;
    if (page <= totalPages) await sleep(250);
  }
  process.stdout.write('\n');
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

function buildStats(tracks) {
  const daily = {};
  const hourly = Array(24).fill(0);
  const weekday = Array(7).fill(0);
  const monthly = {};
  for (const track of tracks) {
    daily[track.day] = (daily[track.day] || 0) + 1;
    hourly[track.hour] += 1;
    weekday[track.wd] += 1;
    monthly[track.month] = (monthly[track.month] || 0) + 1;
  }
  return { total: tracks.length, daily, hourly, weekday, monthly };
}

function chunkTracks(tracks) {
  if (!tracks.length) return [];
  const chunks = [];
  let index = 0;
  while (index < tracks.length) {
    const start = new Date(tracks[index].ts * 1000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + CHUNK_DAYS - 1);
    end.setHours(23, 59, 59, 999);
    const items = [];
    while (index < tracks.length && tracks[index].ts * 1000 <= end.getTime()) {
      items.push(tracks[index]);
      index += 1;
    }
    const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    chunks.push({
      file: `scrobbles-${startDate}_${endDate}.json`,
      startDate,
      endDate,
      count: items.length,
      tracks: items,
    });
  }
  return chunks;
}

async function getTrackInfoImage(config, artist, track) {
  try {
    const data = await apiGet(config, 'track.getInfo', { artist, track });
    const images = data.track?.album?.image || [];
    const url = (images.find(img => img.size === 'extralarge') || images[images.length - 1])?.['#text'] || '';
    return url.includes('2a96cbd8b46e442fc41c2b86b821562f') ? '' : url;
  } catch {
    return '';
  }
}

async function buildTopData(config) {
  const out = {};
  for (const period of PERIODS) {
    const [artistsRes, albumsRes, tracksRes] = await Promise.all([
      apiGet(config, 'user.gettopartists', { period, limit: 10 }),
      apiGet(config, 'user.gettopalbums', { period, limit: 10 }),
      apiGet(config, 'user.gettoptracks', { period, limit: 10 }),
    ]);
    const artists = artistsRes.topartists?.artist || [];
    const albums = albumsRes.topalbums?.album || [];
    const tracks = tracksRes.toptracks?.track || [];
    for (const item of tracks) {
      if (!pickImage(item)) {
        item.image = await getTrackInfoImage(config, item.artist?.name || item.artist?.['#text'] || '', item.name);
        await sleep(100);
      }
    }
    out[period] = { artist: artists, album: albums, track: tracks };
  }
  return out;
}

async function buildTags(config, topArtists) {
  const map = {};
  for (const artist of topArtists.slice(0, 8)) {
    try {
      const data = await apiGet(config, 'artist.gettoptags', { artist: artist.name });
      for (const tag of data.toptags?.tag?.slice(0, 3) || []) {
        const name = tag.name.toLowerCase();
        map[name] = (map[name] || 0) + (+tag.count || 1);
      }
      await sleep(100);
    } catch {
      // ignore tag errors
    }
  }
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(CHUNK_DIR, { recursive: true });
  await fs.mkdir(TOP_DIR, { recursive: true });
}

async function clearDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(entry => fs.rm(path.join(dir, entry.name), { recursive: true, force: true })));
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function writeState(state) {
  await writeJSON(STATE_FILE, state);
}

async function clearState() {
  await fs.rm(STATE_FILE, { force: true });
}

async function loadResumeState(config) {
  const state = await readState();
  if (!state) return null;
  if (state.username !== config.USERNAME) return null;
  if (!Array.isArray(state.tracks)) return null;
  const map = new Map(state.tracks.map(track => [track.id, track]));
  return {
    startedAt: state.startedAt || new Date().toISOString(),
    page: Math.max(1, +state.nextPage || 1),
    totalPages: Math.max(1, +state.totalPages || 1),
    map,
  };
}

async function main() {
  const config = await readConfig();
  await ensureDirs();
  const resume = await loadResumeState(config);
  if (!resume) {
    await clearDir(CHUNK_DIR);
    await clearDir(TOP_DIR);
  }

  const generatedAt = new Date().toISOString();
  const [userInfo, recentRes, allTracks, topData] = await Promise.all([
    apiGet(config, 'user.getinfo'),
    apiGet(config, 'user.getrecenttracks', { limit: 50, page: 1, extended: 1 }),
    fetchAllTracks(config, resume),
    buildTopData(config),
  ]);

  const stats = buildStats(allTracks);
  const chunks = chunkTracks(allTracks);
  const tags = await buildTags(config, topData['7day'].artist || []);

  await writeJSON(path.join(DATA_DIR, 'recent.json'), recentRes.recenttracks || { track: [] });
  await writeJSON(path.join(DATA_DIR, 'stats.json'), stats);
  await writeJSON(path.join(DATA_DIR, 'tags.json'), tags);

  for (const period of PERIODS) {
    await writeJSON(path.join(TOP_DIR, `${period}.json`), topData[period]);
  }

  for (const chunk of chunks) {
    await writeJSON(path.join(CHUNK_DIR, chunk.file), {
      generatedAt,
      startDate: chunk.startDate,
      endDate: chunk.endDate,
      count: chunk.count,
      tracks: chunk.tracks,
    });
  }

  const meta = {
    generatedAt,
    username: config.USERNAME,
    chunkDays: CHUNK_DAYS,
    trackCount: allTracks.length,
    firstScrobbleAt: allTracks[0]?.ts || null,
    lastScrobbleAt: allTracks[allTracks.length - 1]?.ts || null,
    user: userInfo.user,
    chunks: chunks.map(({ file, startDate, endDate, count }) => ({ file, startDate, endDate, count })),
  };
  await writeJSON(path.join(DATA_DIR, 'meta.json'), meta);
  await clearState();

  console.log(`完成：${config.USERNAME}，${allTracks.length} 筆，${chunks.length} 個分段 JSON`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
