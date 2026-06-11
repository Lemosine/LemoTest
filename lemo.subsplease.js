const BASE_URL = "https://subsplease.org/api/";
const TIMEOUT_MS = 8000;
const RESOLUTIONS = ["1080", "720", "480"];

function base32ToHex(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of base32.toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }

  return bytes.map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeHash(hash) {
  const trimmed = hash.trim();
  if (/^[0-9a-f]{40}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^[A-Z2-7]{32}$/i.test(trimmed)) return base32ToHex(trimmed);
  return trimmed.toLowerCase();
}

function extractHash(magnet) {
  const match = /xt=urn:btih:([A-Za-z0-9]+)/i.exec(magnet);
  return match ? normalizeHash(match[1]) : "";
}

function extractSize(magnet) {
  const match = /[?&]xl=(\d+)/.exec(magnet);
  return match ? Number(match[1]) : 0;
}

function cleanTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleMatches(showTitle, titles = []) {
  const show = cleanTitle(showTitle ?? "");
  return !!show && titles.some(title => {
    const candidate = cleanTitle(title);
    return candidate.includes(show) || show.includes(candidate);
  });
}

function episodeMatches(value, episode) {
  if (value === "Batch") return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric === Number(episode);
}

function resolveResolution(item, options = {}, queryResolution = "") {
  const preferred = options.resolution || queryResolution;
  if (preferred === "480") return "480";
  if (preferred === "540" || preferred === "720") return "720";
  if (preferred === "1080") return "1080";
  return item?.downloads?.some(download => download.res === "1080") ? "1080" : "";
}

function pickDownload(downloads = [], resolution = "") {
  if (resolution) {
    const exact = downloads.find(download => download.res === resolution);
    if (exact) return exact;
  }

  for (const item of RESOLUTIONS) {
    const fallback = downloads.find(download => download.res === item);
    if (fallback) return fallback;
  }

  return downloads[0] ?? null;
}

async function fetchText(request, url) {
  const controller = new AbortController();
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("SubsPlease did not respond in time."));
    }, TIMEOUT_MS);
  });

  const response = (async () => {
    const res = await request(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`SubsPlease returned HTTP ${res.status}.`);
    return res.text();
  })();

  response.catch(() => {});

  try {
    return await Promise.race([response, timeout]);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("SubsPlease did not respond in time.");
    throw new Error(`Could not reach SubsPlease: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function searchSubsPlease(request, title) {
  const text = await fetchText(request, `${BASE_URL}?f=search&tz=UTC&s=${encodeURIComponent(title)}`);
  if (!text.trim() || text.trim() === "[]") return [];

  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return Object.values(data).filter(item => item && typeof item === "object");
}

function mapItem(item, download, type) {
  const hash = extractHash(download.magnet);
  const episode = item.episode && item.episode !== "Batch" ? ` - ${String(item.episode).padStart(2, "0")}` : "";

  return {
    title: `[SubsPlease] ${item.show}${episode} (${download.res}p).mkv`,
    link: download.magnet,
    hash,
    seeders: 0,
    leechers: 0,
    downloads: 0,
    size: extractSize(download.magnet),
    accuracy: "high",
    date: item.release_date ? new Date(item.release_date) : new Date(0),
    type
  };
}

async function search(query, options, wantBatch = false, episode) {
  const titles = (query.titles ?? []).filter(Boolean).slice(0, 3);
  if (!titles.length) return [];

  const request = query.fetch ?? fetch;
  const seen = new Set();
  const results = [];

  for (const title of titles) {
    const items = await searchSubsPlease(request, title);

    for (const item of items) {
      if (!titleMatches(item.show, query.titles)) continue;
      if (wantBatch && item.episode !== "Batch") continue;
      if (!wantBatch && item.episode === "Batch") continue;
      if (episode !== undefined && !episodeMatches(item.episode, episode)) continue;

      const resolution = resolveResolution(item, options, query.resolution);
      const download = pickDownload(item.downloads, resolution);
      if (!download?.magnet) continue;

      const hash = extractHash(download.magnet);
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      results.push(mapItem(item, download, wantBatch ? "batch" : undefined));
    }

    if (results.length) break;
  }

  return results;
}

export default {
  async test(query = {}) {
    const request = query.fetch ?? fetch;
    const text = await fetchText(request, `${BASE_URL}?f=schedule&tz=UTC`);
    return !!text.trim();
  },

  async single(query, options = {}) {
    return search(query, options, false, query.episode);
  },

  async batch(query, options = {}) {
    return search(query, options, true);
  },

  async movie(query, options = {}) {
    return search(query, options, false);
  }
};
