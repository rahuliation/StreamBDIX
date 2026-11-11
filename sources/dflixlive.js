// StreamBDIX - By Corpse
const { extractQuality, titlesMatch, normalize, axios } = require('./utils');

const SOURCE_NAME = 'DFLIX.LIVE';
const DFLIX_LIVE_URL = 'https://dflix.live';

const axiosConfig = {
    timeout: 6000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': `${DFLIX_LIVE_URL}/`
    }
};

async function search(query) {
    try {
        const response = await axios.get(`${DFLIX_LIVE_URL}/api/search`, {
            params: { q: query, limit: 20 },
            ...axiosConfig
        });
        return response.data?.results || [];
    } catch {
        return [];
    }
}

function parseTitleFiles(payload, titleId) {
    if (!payload || typeof payload !== 'string') return [];

    // Normalizing escaped quotes if response was wrapped in HTML Next.js script tags
    const normalizedText = payload.includes('\\"') ? payload.replace(/\\"/g, '"') : payload;
    const fileRegex = new RegExp(`\\{"id":\\s*(\\d+)\\s*,\\s*"titleId":\\s*${titleId}\\s*,[^{}]*\\}`, 'g');
    const files = [];
    const seen = new Set();
    let match;

    while ((match = fileRegex.exec(normalizedText)) !== null) {
        try {
            const obj = JSON.parse(match[0]);
            if (obj && obj.id && !seen.has(obj.id)) {
                seen.add(obj.id);
                files.push(obj);
            }
        } catch {}
    }
    return files;
}

async function getTitleFiles(titleId) {
    try {
        const response = await axios.get(`${DFLIX_LIVE_URL}/title/${titleId}`, {
            ...axiosConfig,
            headers: {
                ...axiosConfig.headers,
                'RSC': '1'
            }
        });
        const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        return parseTitleFiles(text, titleId);
    } catch {
        return [];
    }
}

function formatQuality(file) {
    let q = extractQuality(file.path || '');
    if (q === 'Unknown' && file.quality) {
        q = extractQuality(`${file.quality} ${file.codec || ''}`);
    }
    if (q === 'Unknown') {
        const parts = [];
        if (file.quality) parts.push(file.quality);
        if (file.codec) parts.push(file.codec);
        if (file.container) parts.push(file.container.toUpperCase());
        q = parts.join(' ') || 'Unknown';
    }
    return q;
}

function scoreCandidate(candidate, meta) {
    let score = 0;
    const cTitle = normalize(candidate.title);
    const mTitle = normalize(meta.name);

    if (cTitle === mTitle) score += 50;
    else if (cTitle.startsWith(mTitle) || mTitle.startsWith(cTitle)) score += 30;
    else score += 10;

    if (meta.year && candidate.year) {
        const diff = Math.abs(parseInt(candidate.year) - parseInt(meta.year));
        if (diff === 0) score += 40;
        else if (diff === 1) score += 20;
        else if (diff > 2) score -= 30;
    }
    return score;
}

module.exports = {
    name: SOURCE_NAME,
    types: ['movie', 'series'],

    async getStreams(type, meta, season, episode) {
        if (!meta || !meta.name) return [];

        const expectedKind = type === 'movie' ? 'movie' : 'tv';
        const results = await search(meta.name);
        if (!results || results.length === 0) return [];

        const candidates = results
            .filter(r => r.kind === expectedKind && titlesMatch(r.title, meta.name))
            .sort((a, b) => scoreCandidate(b, meta) - scoreCandidate(a, meta));

        if (candidates.length === 0) return [];

        const streams = [];
        const seenUrls = new Set();
        const topCandidates = candidates.slice(0, 3);

        for (const candidate of topCandidates) {
            const files = await getTitleFiles(candidate.id);
            if (!files || files.length === 0) continue;

            for (const file of files) {
                if (type === 'movie') {
                    // Check if imdb id matches directly in path if available
                    if (meta.imdb_id && file.path && file.path.toLowerCase().includes(meta.imdb_id.toLowerCase())) {
                        // High confidence match
                    } else if (file.season != null && file.season !== 0) {
                        continue;
                    }

                    const ext = file.container ? `.${file.container}` : '';
                    const streamUrl = `${DFLIX_LIVE_URL}/api/stream/${file.id}${ext}`;
                    if (!seenUrls.has(streamUrl)) {
                        seenUrls.add(streamUrl);
                        streams.push({
                            name: SOURCE_NAME,
                            title: formatQuality(file),
                            url: streamUrl
                        });
                    }
                } else if (type === 'series') {
                    let fileSeason = file.season != null ? parseInt(file.season) : null;
                    let fileEpisode = file.episode != null ? parseInt(file.episode) : null;

                    if (fileSeason === null || fileEpisode === null) {
                        const match = (file.path || '').match(/S0*(\d+)\D*E0*(\d+)/i);
                        if (match) {
                            fileSeason = parseInt(match[1]);
                            fileEpisode = parseInt(match[2]);
                        }
                    }

                    if (fileSeason === parseInt(season) && fileEpisode === parseInt(episode)) {
                        const ext = file.container ? `.${file.container}` : '';
                        const streamUrl = `${DFLIX_LIVE_URL}/api/stream/${file.id}${ext}`;
                        if (!seenUrls.has(streamUrl)) {
                            seenUrls.add(streamUrl);
                            streams.push({
                                name: SOURCE_NAME,
                                title: formatQuality(file),
                                url: streamUrl
                            });
                        }
                    }
                }
            }

            if (streams.length > 0) break;
        }

        return streams;
    }
};

