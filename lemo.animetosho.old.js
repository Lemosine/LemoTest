const QUALITIES = ["1080", "720", "540", "480"];

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
    return entries.map(entry => ({
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
    if (!anidbEid) throw new Error("No anidbEid provided");

    const query = this._buildQuery({ resolution, exclusions });
    const res = await request(this.url + "?eid=" + anidbEid + query);
    const data = await res.json();
    return data.length ? this.map(data, false, options?.useTorrent) : [];
  }

  async batch({ anidbAid, resolution, exclusions = [], episode, fetch: request = fetch }, options) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    if (!anidbAid) throw new Error("No anidbAid provided");

    const query = this._buildQuery({ resolution, exclusions });
    const res = await request(this.url + "?order=size-d&aid=" + anidbAid + query);
    const data = (await res.json()).filter(entry => entry.num_files >= Math.min(24, Math.max(2, episode ?? 1)));
    return data.length ? this.map(data, true, options?.useTorrent) : [];
  }

  async movie({ anidbAid, resolution, exclusions = [], fetch: request = fetch }, options) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    if (!anidbAid) throw new Error("No anidbAid provided");

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
