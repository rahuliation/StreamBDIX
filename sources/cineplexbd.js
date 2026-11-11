// StreamBDIX - By Corpse
const { extractQuality, titlesMatch, axios } = require('./utils');

const SOURCE_NAME = 'CineplexBD';
const BASE_URL = 'http://cineplexbd.net';

const baseHeaders = {
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

// Search the AJAX endpoint — same one used by the site's search bar
async function search(query) {
    try {
        const res = await axios.get(`${BASE_URL}/search_ajax.php`, {
            params: { q: query, limit: 8 },
            headers: { ...baseHeaders, Accept: 'application/json', Referer: `${BASE_URL}/index.php` },
            timeout: 6000
        });
        return res.data?.results || [];
    } catch {
        return [];
    }
}

// ─── MOVIES ──────────────────────────────────────────────────────────────────
// player.php embeds:  const videoSrc = "/v/m/...?md5=...&expires=..."
// or for older files: const videoSrc = "/Data/Movie/...?token=...&remote=..."
// Both are direct mp4/mkv links that return 200 without any cookie.

async function getMovieStream(id, resolution) {
    try {
        const res = await axios.get(`${BASE_URL}/player.php`, {
            params: { id },
            headers: { ...baseHeaders, Accept: 'text/html', Referer: `${BASE_URL}/view.php?id=${id}` },
            timeout: 6000
        });
        const html = res.data;

        // const videoSrc = "..."  — single or double quoted
        const m = html.match(/const\s+videoSrc\s*=\s*(["'])([\s\S]*?)\1/);
        if (!m || !m[2]) return null;

        const path = m[2].trim();
        // Build absolute URL if path-only
        const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
        const quality = extractQuality(url) !== 'Unknown'
            ? extractQuality(url)
            : (resolution || 'Unknown');

        return { name: SOURCE_NAME, title: quality, url };
    } catch {
        return null;
    }
}

// ─── SERIES ──────────────────────────────────────────────────────────────────
// watch.php?id=X&season=N&ep=N embeds:
//   <source src="/hls/t/Category/Title/Season N/file.mp4/master.m3u8" ...>
// The HLS URL needs the session cookies (REDFORCE + hlse + hlsk) obtained from
// the same watch.php response, so we forward them via a proxy-style header.

function parseCookies(setCookieArr) {
    return (setCookieArr || []).map(c => c.split(';')[0]).join('; ');
}

async function getSeriesStream(id, season, episode) {
    try {
        const res = await axios.get(`${BASE_URL}/watch.php`, {
            params: { id, season, ep: episode, autoplay: 1 },
            headers: {
                ...baseHeaders,
                Accept: 'text/html',
                Referer: `${BASE_URL}/watch.php?id=${id}`
            },
            timeout: 8000
        });

        const html = res.data;
        const cookie = parseCookies(res.headers['set-cookie']);

        // <source src="/hls/t/..." type="application/x-mpegURL"/>
        const srcMatch = html.match(/<source\s+src="(\/hls\/t\/[^"]+\.m3u8)"/i);
        if (!srcMatch) return null;

        const hlsPath = srcMatch[1];
        const hlsUrl = `${BASE_URL}${hlsPath}`;

        // Verify it is accessible with the cookie we got
        const check = await axios.head(hlsUrl, {
            headers: {
                ...baseHeaders,
                Referer: `${BASE_URL}/watch.php?id=${id}`,
                Cookie: cookie
            },
            validateStatus: null,
            timeout: 5000
        });

        if (check.status !== 200) return null;

        const quality = extractQuality(hlsPath) !== 'Unknown'
            ? extractQuality(hlsPath)
            : 'HLS';

        // Stremio cannot forward arbitrary cookies, so we embed the cookie as a
        // query-string workaround recognised by some players, or just return the
        // URL — most BD-local networks serve it without IP restriction anyway.
        return {
            name: SOURCE_NAME,
            title: quality,
            url: hlsUrl,
            // Provide the cookie as a behaviour hint so the player can send it
            behaviorHints: { notWebReady: false, proxyHeaders: { request: { Cookie: cookie } } }
        };
    } catch {
        return null;
    }
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────

module.exports = {
    name: SOURCE_NAME,
    types: ['movie', 'series'],

    async getStreams(type, meta, season, episode) {
        if (!meta || !meta.name) return [];

        const results = await search(meta.name);
        if (!results.length) return [];

        const expectedType = type === 'movie' ? 'movie' : 'series';

        const candidates = results.filter(r => {
            if (r.type !== expectedType) return false;
            if (!titlesMatch(r.title, meta.name)) return false;
            if (type === 'movie' && meta.year && r.year) {
                if (Math.abs(parseInt(r.year) - parseInt(meta.year)) > 1) return false;
            }
            return true;
        });

        if (!candidates.length) return [];

        const streams = [];

        for (const candidate of candidates.slice(0, 3)) {
            if (type === 'movie') {
                const stream = await getMovieStream(candidate.id, candidate.resolution);
                if (stream) {
                    streams.push(stream);
                    break; // first working hit is enough
                }
            } else {
                const stream = await getSeriesStream(candidate.id, season, episode);
                if (stream) {
                    streams.push(stream);
                    break;
                }
            }
        }

        return streams;
    }
};
