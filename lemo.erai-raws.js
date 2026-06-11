const DOMAIN = "https://nyaa.si";
const CATEGORY = "1_2";
const FILTER = "0";
const UPLOADER = "Erai-raws";
const TIMEOUT_MS = 6000;
const MAX_SEARCHES = 12;

const TRACKERS = [
  "http://nyaa.tracker.wf:7777/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce"
].map(tracker => `&tr=${encodeURIComponent(tracker)}`).join("");

function decodeEntities(value) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function nyaaTag(item, name) {
  const match = item.match(new RegExp(`<nyaa:${name}>([\\s\\S]*?)<\\/nyaa:${name}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function parseSize(size) {
  const match = String(size).match(/([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB)/i);
  if (!match) return 0;

  const value = Number.parseFloat(match[1]);
  const units = { KIB: 1024, KB: 1024, MIB: 1024 ** 2, MB: 1024 ** 2, GIB: 1024 ** 3, GB: 1024 ** 3, TIB: 1024 ** 4, TB: 1024 ** 4 };
  return Math.round(value * (units[match[2].toUpperCase()] ?? 0));
}

function magnet(hash, title) {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}${TRACKERS}`;
}

function buildUrl(search) {
  const params = new URLSearchParams({
    page: "rss",
    u: UPLOADER,
    q: search,
    c: CATEGORY,
    f: FILTER,
    s: "seeders",
    o: "desc"
  });

  return `${DOMAIN}/?${params.toString()}`;
}

async function fetchText(request, url) {
  const controller = new AbortController();
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Nyaa did not respond in time."));
    }, TIMEOUT_MS);
  });

  const response = (async () => {
    const res = await request(url, {
      signal: controller.signal,
      headers: { Accept: "application/rss+xml, application/xml, text/xml" }
    });

    if (!res.ok) throw new Error(`Nyaa returned HTTP ${res.status}.`);
    return res.text();
  })();

  response.catch(() => {});

  try {
    return await Promise.race([response, timeout]);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Nyaa did not respond in time.");
    throw new Error(`Could not reach Nyaa: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function episodeMatches(title, episode) {
  const ep = String(episode);
  const ep2 = ep.padStart(2, "0");
  const ep3 = ep.padStart(3, "0");

  return [
    new RegExp(`(^|[^\\d])${ep}([^\\d]|$)`),
    new RegExp(`(^|[^\\d])${ep2}([^\\d]|$)`),
    new RegExp(`(^|[^\\d])${ep3}([^\\d]|$)`),
    new RegExp(`e${ep2}([^\\d]|$)`, "i"),
    new RegExp(`e${ep3}([^\\d]|$)`, "i")
  ].some(pattern => pattern.test(title));
}

function isBatchTitle(title) {
  return /batch|complete|\b\d{1,4}\s*[-~]\s*\d{1,4}\b|\bS\d{1,2}E\d{1,3}\s*[-~]\s*E?\d{1,3}\b/i.test(title);
}

function seasonNumber(title) {
  const season = title.match(/\bseason\s+(\d+)\b/i);
  if (season) return Number.parseInt(season[1], 10);

  const ordinal = title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
  return ordinal ? Number.parseInt(ordinal[1], 10) : null;
}

function resultSeasonNumber(title) {
  const season = seasonNumber(title);
  if (season) return season;

  const absolute = title.match(/\bS(\d{1,2})E\d{1,4}\b/i);
  return absolute ? Number.parseInt(absolute[1], 10) : null;
}

function titleVariants(titles) {
  const variants = [];

  for (const title of titles) {
    const stripped = title
      .replace(/\s*(?:season\s+\d+|\d+(?:st|nd|rd|th)\s+season)\s*$/i, "")
      .trim();

    if (stripped && stripped !== title) variants.push(stripped);
    variants.push(title);
  }

  return [...new Set(variants)].slice(0, 5);
}

function resolutionMatches(title, resolution) {
  if (!resolution || resolution === "Any") return true;
  return new RegExp(`\\b${String(resolution).replace(/p$/i, "")}p\\b`, "i").test(title);
}

function applyExclusions(results, exclusions = []) {
  const blocked = exclusions.map(item => item.toLowerCase()).filter(Boolean);
  if (!blocked.length) return results;
  return results.filter(result => !blocked.some(item => result.title.toLowerCase().includes(item)));
}

function dedupe(results) {
  const seen = new Set();
  return results
    .filter(result => {
      if (seen.has(result.hash)) return false;
      seen.add(result.hash);
      return true;
    })
    .sort((a, b) => b.seeders - a.seeders);
}

function parseRss(xml, query) {
  if (!xml.includes("<rss")) return [];

  const resolution = query.resolution;
  const expectedSeason = query.expectedSeason;
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  return items
    .map(item => {
      const title = tag(item, "title");
      const hash = nyaaTag(item, "infoHash").toLowerCase();
      if (!title || !hash || !/^\s*\[Erai-raws\]/i.test(title)) return null;
      if (!resolutionMatches(title, resolution)) return null;
      if (expectedSeason > 1 && resultSeasonNumber(title) !== expectedSeason) return null;
      if (query.episode && !episodeMatches(title, query.episode) && !isBatchTitle(title)) return null;

      const seeders = Number.parseInt(nyaaTag(item, "seeders") || "0", 10);
      const leechers = Number.parseInt(nyaaTag(item, "leechers") || "0", 10);
      const downloads = Number.parseInt(nyaaTag(item, "downloads") || "0", 10);
      const pubDate = tag(item, "pubDate");
      const batch = isBatchTitle(title);

      return {
        title,
        link: magnet(hash, title),
        hash,
        seeders: seeders >= 30000 ? 0 : seeders,
        leechers: leechers >= 30000 ? 0 : leechers,
        downloads,
        size: parseSize(nyaaTag(item, "size")),
        date: pubDate ? new Date(pubDate) : new Date(0),
        accuracy: query.episode && episodeMatches(title, query.episode) ? "high" : "medium",
        type: batch ? "batch" : undefined
      };
    })
    .filter(Boolean);
}

async function search(query = {}, isBatch = false) {
  if (!query.titles?.length) return [];

  const request = query.fetch ?? fetch;
  const titles = titleVariants(query.titles.slice(0, 4));
  const episode = query.episode == null ? null : String(query.episode).padStart(2, "0");
  const season = seasonNumber(titles.join(" "));
  const normalizedQuery = { ...query, expectedSeason: season };
  const absolute = season && episode ? `S${String(season).padStart(2, "0")}E${episode}` : null;
  const searches = [];

  for (const title of titles) {
    if (episode && !isBatch) {
      if (absolute) searches.push(`${title} ${absolute}`);
      searches.push(`${title} - ${episode}`);
      searches.push(`${title} ${episode}`);
    }

    if (isBatch) {
      searches.push(`${title} batch`);
      searches.push(`${title} complete`);
      searches.push(`${title} season`);
    }

    if (!episode || isBatch) searches.push(title);
  }

  const attempts = [...new Set(searches)].slice(0, MAX_SEARCHES);
  const settled = await Promise.allSettled(attempts.map(async item => {
    const xml = await fetchText(request, buildUrl(item));
    return parseRss(xml, normalizedQuery);
  }));

  const results = settled
    .filter(item => item.status === "fulfilled")
    .flatMap(item => item.value);

  return applyExclusions(dedupe(results), normalizedQuery.exclusions);
}

export default {
  async test(query = {}) {
    const request = query.fetch ?? fetch;
    const xml = await fetchText(request, buildUrl("One Piece"));
    return xml.includes("<rss");
  },

  async single(query) {
    return search(query);
  },

  async batch(query) {
    return search(query, true);
  },

  async movie(query) {
    return search(query);
  }
};
