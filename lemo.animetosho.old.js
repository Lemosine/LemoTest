const QUALITIES = ["1080", "720", "540", "480"];
const AUDIO_RE = /\b(dubbed|dual[-\s._]?audio|dual|english[-\s._]?(?:dub|audio)|eng[-\s._]?(?:dub|audio)|multi[-\s._]?audio)\b/i;

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

function rangeForEpisode(title, episode) {
  const ep = Number.parseInt(episode, 10);
  if (!Number.isFinite(ep)) return null;

  const ranges = [
    ...title.matchAll(/\bS\d{1,2}E(\d{1,4})\s*[-~]\s*E?(\d{1,4})\b/gi),
    ...title.matchAll(/\b(\d{1,4})\s*[-~]\s*(\d{1,4})\b/g)
  ];

  for (const match of ranges) {
    const start = Number.parseInt(match[1], 10);
    const end = Number.parseInt(match[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (ep >= low && ep <= high) return { start: low, end: high, span: high - low + 1 };
  }

  return null;
}

function acceptableEpisodeResult(title, episode) {
  if (!episode) return true;
  if (rangeForEpisode(title, episode)) return false;
  return episodeMatches(title, episode);
}

export default new class Tosho {
  url = atob("aHR0cHM6Ly9mZWVkLmFuaW1ldG9zaG8ub3JnL2pzb24=");

  _buildQuery({ resolution, exclusions = [] }) {
    const excluded = Array.isArray(exclusions) ? exclusions : [];
    if (!excluded.length && !resolution) return "";

    const parts = [];
    if (excluded.length) parts.push(`!("${excluded.join('"|"')}")`);
    if (resolution) parts.push(`!(*${QUALITIES.filter(quality => quality !== resolution).join("*|*")}*)`);

    return parts.length ? `&qx=1&q=${parts.join("")}` : "";
  }

  map(entries, batch = false, useTorrent = false) {
    return entries
      .filter(entry => AUDIO_RE.test(entry.title || entry.torrent_name || ""))
      .map(entry => ({
        title: entry.title || entry.torrent_name,
        link: useTorrent ? entry.torrent_url : entry.magnet_uri,
        seeders: (entry.seeders || 0) >= 3e4 ? 0 : entry.seeders || 0,
        leechers: (entry.leechers || 0) >= 3e4 ? 0 : entry.leechers || 0,
        downloads: entry.torrent_downloaded_count || 0,
        hash: entry.info_hash,
        size: entry.total_size,
        accuracy: entry.anidb_fid && !batch ? "high" : "medium",
        type: batch ? "batch" : undefined,
        date: new Date(1e3 * entry.timestamp)
      }));
  }

  async single({ anidbEid, resolution, exclusions = [], fetch: request = fetch }, options) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    if (!anidbEid) return [];

    const query = this._buildQuery({ resolution, exclusions });
    const res = await request(this.url + "?eid=" + anidbEid + query);
    const data = await res.json();
    return data.length ? this.map(data, false, options?.useTorrent) : [];
  }

  async batch({ anidbAid, resolution, exclusions = [], episode, fetch: request = fetch }, options) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    if (!anidbAid) return [];

    const query = this._buildQuery({ resolution, exclusions });
    const res = await request(this.url + "?order=size-d&aid=" + anidbAid + query);
    const data = (await res.json()).filter(entry => (
      entry.num_files >= Math.min(24, Math.max(2, episode ?? 1)) &&
      acceptableEpisodeResult(entry.title || entry.torrent_name || "", episode)
    ));
    return data.length ? this.map(data, true, options?.useTorrent) : [];
  }

  async movie({ anidbAid, resolution, exclusions = [], fetch: request = fetch }, options) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    if (!anidbAid) return [];

    const query = this._buildQuery({ resolution, exclusions });
    const res = await request(this.url + "?aid=" + anidbAid + query);
    const data = await res.json();
    return data.length ? this.map(data, false, options?.useTorrent) : [];
  }

  async test() {
    try {
      if (!(await fetch(this.url)).ok) throw new Error(`Failed to load data from ${this.url}! Is the site down?`);
      return true;
    } catch {
      throw new Error(`Could not reach ${this.url}! Does the site work in your region?`);
    }
  }
}();
