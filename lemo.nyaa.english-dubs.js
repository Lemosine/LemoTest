const DOMAIN = "https://nyaa.si";
const CATEGORY = "1_2";
const FILTER = "0";
const TIMEOUT_MS = 15000;

const TRACKERS = [
  "http://nyaa.tracker.wf:7777/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce"
].map(tracker => `&tr=${encodeURIComponent(tracker)}`).join("");

const AUDIO_RE = /\b(dubbed|dual[-\s._]?audio|english[-\s._]?dub|eng[-\s._]?dub|multi[-\s._]?audio)\b/i;

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

function buildUrl(query) {
  const params = new URLSearchParams({
    page: "rss",
    q: query,
    c: CATEGORY,
    f: FILTER,
    s: "seeders",
    o: "desc"
  });

  return `${DOMAIN}/?${params.toString()}`;
}

async function fetchText(request, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await request(url, {
      signal: controller.signal,
      headers: { Accept: "application/rss+xml, application/xml, text/xml" }
    });

    if (!res.ok) throw new Error(`Nyaa returned HTTP ${res.status}.`);
    return await res.text();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Nyaa did not respond in time.");
    throw new Error(`Could not reach Nyaa: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function parseRss(xml, query) {
  if (!xml.includes("<rss")) return [];

  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .map(item => {
      const title = tag(item, "title");
      const hash = nyaaTag(item, "infoHash").toLowerCase();
      if (!title || !hash || !AUDIO_RE.test(title)) return null;
      if (query.episode && !episodeMatches(title, query.episode) && !isBatchTitle(title)) return null;

      const seeders = Number.parseInt(nyaaTag(item, "seeders") || "0", 10);
      const leechers = Number.parseInt(nyaaTag(item, "leechers") || "0", 10);
      const downloads = Number.parseInt(nyaaTag(item, "downloads") || "0", 10);
      const pubDate = tag(item, "pubDate");

      return {
        title,
        link: magnet(hash, title),
        hash,
        seeders: seeders >= 30000 ? 0 : seeders,
        leechers: leechers >= 30000 ? 0 : leechers,
        downloads,
        size: parseSize(nyaaTag(item, "size")),
        date: pubDate ? new Date(pubDate) : new Date(0),
        accuracy: query.episode ? episodeMatches(title, query.episode) ? "high" : "medium" : "medium",
        type: isBatchTitle(title) ? "batch" : undefined
      };
    })
    .filter(Boolean);
}

function episodeMatches(title, episode) {
  const ep = String(episode);
  const ep2 = ep.padStart(2, "0");
  const ep3 = ep.padStart(3, "0");
  return [
    new RegExp(`(^|[^\\d])${ep2}([^\\d]|$)`),
    new RegExp(`(^|[^\\d])${ep3}([^\\d]|$)`),
    new RegExp(`e${ep2}([^\\d]|$)`, "i")
  ].some(pattern => pattern.test(title));
}

function isBatchTitle(title) {
  return /batch|complete|\b\d{1,3}\s*[-~]\s*\d{1,3}\b/i.test(title);
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

async function search(query, suffixes, isBatch = false) {
  if (!query.titles?.length) return [];

  const request = query.fetch ?? fetch;
  const titles = query.titles.slice(0, 3);
  const episode = query.episode == null ? null : String(query.episode).padStart(2, "0");
  const searches = [];

  for (const title of titles) {
    for (const suffix of suffixes) {
      if (episode && !isBatch) {
        searches.push(`${title} - ${episode} ${suffix}`);
        searches.push(`${title} ${episode} ${suffix}`);
      }

      if (isBatch) {
        searches.push(`${title} batch ${suffix}`);
        searches.push(`${title} complete ${suffix}`);
        searches.push(`${title} season ${suffix}`);
      }

      searches.push(`${title} ${suffix}`);
    }
  }

  const results = [];
  for (const item of [...new Set(searches)]) {
    const xml = await fetchText(request, buildUrl(item));
    results.push(...parseRss(xml, query));
    if (results.length >= 20) break;
  }

  return applyExclusions(dedupe(results), query.exclusions);
}

export default {
  async test(query = {}) {
    const request = query.fetch ?? fetch;
    const xml = await fetchText(request, buildUrl("Dubbed"));
    return xml.includes("<rss");
  },

  async single(query) {
    return search(query, ["Dubbed", "Dual Audio"]);
  },

  async batch(query) {
    return search(query, ["Dubbed", "Dual Audio"], true);
  },

  async movie(query) {
    return search(query, ["Dubbed", "Dual Audio"]);
  }
};
