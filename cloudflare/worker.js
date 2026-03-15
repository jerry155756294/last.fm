export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (!env.LASTFM_API_KEY || !env.LASTFM_USERNAME) {
      return json({ error: 'Missing Worker secrets' }, 500);
    }

    if (url.pathname === '/recent') {
      const limit = clampLimit(url.searchParams.get('limit'));
      const data = await lastfm(env, 'user.getrecenttracks', { limit, extended: 1 });
      return json(data.recenttracks, 200, { 'Cache-Control': 'public, max-age=15' });
    }

    if (url.pathname === '/now-playing') {
      const data = await lastfm(env, 'user.getrecenttracks', { limit: 5, extended: 1 });
      const tracks = data.recenttracks?.track || [];
      const nowPlaying = tracks.find(track => track['@attr']?.nowplaying === 'true') || null;
      return json({ nowPlaying }, 200, { 'Cache-Control': 'public, max-age=10' });
    }

    return json({ ok: true, endpoints: ['/recent', '/now-playing'] });
  },
};

function clampLimit(value) {
  const n = Number(value || 50);
  return Math.max(1, Math.min(200, Number.isFinite(n) ? n : 50));
}

async function lastfm(env, method, extra = {}) {
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', env.LASTFM_API_KEY);
  url.searchParams.set('user', env.LASTFM_USERNAME);
  url.searchParams.set('format', 'json');
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': 'lastfm-dashboard-worker' },
  });
  if (!response.ok) throw new Error(`Last.fm ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.message || `Last.fm error ${data.error}`);
  return data;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
