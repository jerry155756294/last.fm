import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DATA_DIR = path.join(ROOT, 'data');
const RECENT_FILE = path.join(DATA_DIR, 'recent.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const PLACEHOLDER_IMAGE = '2a96cbd8b46e442fc41c2b86b821562f';

async function readConfig() {
  if (process.env.LASTFM_API_KEY && process.env.LASTFM_USERNAME) {
    return { API_KEY: process.env.LASTFM_API_KEY, USERNAME: process.env.LASTFM_USERNAME };
  }
  const source = await fs.readFile(path.join(ROOT, 'api-key.js'), 'utf8');
  const context = { globalThis: {} };
  vm.runInNewContext(`${source}\nglobalThis.__cfg = LASTFM_CONFIG;`, context);
  const cfg = context.globalThis.__cfg;
  if (!cfg?.API_KEY || !cfg?.USERNAME) throw new Error('找不到 LASTFM_CONFIG');
  return cfg;
}

async function fetchRecent(config, limit = 50) {
  const data = await apiGet(config, 'user.getrecenttracks', { limit, extended: 1 });
  return enrichRecentArtwork(config, data.recenttracks || { track: [] });
}

async function apiGet(config, method, extra = {}) {
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', config.API_KEY);
  url.searchParams.set('user', config.USERNAME);
  url.searchParams.set('format', 'json');
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Last.fm ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.message || `Last.fm error ${data.error}`);
  return data;
}

async function writeRecent(recent) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(RECENT_FILE, JSON.stringify(recent, null, 2), 'utf8');
}

function hasUsableImage(images) {
  if (!Array.isArray(images)) return false;
  return images.some(image => image?.['#text'] && !image['#text'].includes(PLACEHOLDER_IMAGE));
}

function normalizeImageArray(images) {
  return Array.isArray(images) ? images : [];
}

async function fetchTrackImage(config, artist, track) {
  try {
    const data = await apiGet(config, 'track.getInfo', { artist, track, autocorrect: 1 });
    return normalizeImageArray(data.track?.album?.image);
  } catch {
    return [];
  }
}

async function enrichRecentArtwork(config, recenttracks) {
  const tracks = Array.isArray(recenttracks.track) ? recenttracks.track : [];
  const imageCache = new Map();
  await Promise.all(tracks.map(async track => {
    if (hasUsableImage(track.image)) return;
    const artist = track.artist?.name || track.artist?.['#text'] || '';
    const key = `${artist}::${track.name}`;
    if (!imageCache.has(key)) {
      imageCache.set(key, fetchTrackImage(config, artist, track.name));
    }
    const images = await imageCache.get(key);
    if (hasUsableImage(images)) {
      track.image = images;
    }
  }));
  return recenttracks;
}

async function readMeta() {
  try {
    return JSON.parse(await fs.readFile(META_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function updateMeta(config) {
  const [userInfo, lovedInfo] = await Promise.all([
    apiGet(config, 'user.getinfo'),
    apiGet(config, 'user.getlovedtracks', { limit: 1, page: 1 }),
  ]);
  const meta = await readMeta();
  meta.user = userInfo.user || meta.user || null;
  meta.liveUpdatedAt = new Date().toISOString();
  meta.lovedTrackCount = +(lovedInfo.lovedtracks?.['@attr']?.total || meta.lovedTrackCount || 0);
  meta.trackCount = +(userInfo.user?.playcount || meta.trackCount || 0);
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

export async function syncRecent(limit = 50) {
  const config = await readConfig();
  const recent = await fetchRecent(config, limit);
  await writeRecent(recent);
  const meta = await updateMeta(config);
  return { recent, meta };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  syncRecent()
    .then(({ recent, meta }) => {
      const count = Array.isArray(recent.track) ? recent.track.length : 0;
      console.log(`recent.json updated (${count} tracks), playcount=${meta.user?.playcount || 'n/a'}`);
    })
    .catch(err => {
      console.error(err);
      process.exitCode = 1;
    });
}
