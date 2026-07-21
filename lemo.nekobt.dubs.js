const QUALITIES = ["1080", "720", "540", "480"];

async function fetchJson(request, url) {
  const res = await request(url, {
    headers: { Accept: "application/json" }
  });

  if (!res.ok) return null;

  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
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

export default new class NekoBT {
  url = atob("aHR0cHM6Ly9uZWtvYnQudG8vYXBpL3YxLw==");

  async _fetch(request, search) {
    const json = await fetchJson(request, `${this.url}torrents/search?${search}`);

    if (json?.error) throw new Error("NekoBT: " + json.message);
    if (!json?.data) return null;
    return json.data;
  }

  async single({
    tvdbId,
    tvdbEId,
    tmdbId,
    episode,
    fetch: request = fetch,
    resolution,
    exclusions = []
  }) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];

    const mediaParams = new URLSearchParams({ limit: "1" });
    if (tvdbId) mediaParams.append("tvdbid", tvdbId.toString());
    if (tmdbId) mediaParams.append("tmdbid", tmdbId);

    const mappings = await this._fetch(request, mediaParams);
    if (!mappings?.media) return [];

    const ep = mappings.media.episodes?.find(item => item.tvdbId === tvdbEId)
      ?? mappings.media.episodes?.find(item => item.episode === episode);
    const searchParams = new URLSearchParams({
      media_id: mappings.media.id,
      audio_lang: "en,enm"
    });

    if (ep?.id) searchParams.append("episode_ids", ep.id.toString());

    const high = ep?.tvdbId === tvdbEId;
    const lowerExclusions = exclusions.map(item => item.toLowerCase());
    const effectiveExclusions = resolution
      ? lowerExclusions.concat(...QUALITIES.filter(item => item !== resolution).map(item => `${item}p`))
      : lowerExclusions;

    return (await this._fetch(request, searchParams))?.results
      ?.filter(({ title }) => {
        if (!acceptableEpisodeResult(title, episode)) return false;
        if (!effectiveExclusions.length) return true;
        const lowerTitle = title.toLowerCase();
        return !effectiveExclusions.some(item => lowerTitle.includes(item));
      })
      .map(entry => ({
        title: entry.title,
        link: `${this.url}torrents/${entry.id}/download?public=true`,
        seeders: Number(entry.seeders),
        leechers: Number(entry.leechers),
        downloads: Number(entry.completed),
        hash: entry.infohash,
        size: Number(entry.filesize),
        accuracy: high ? "high" : "medium",
        type: (entry.level ?? 0) >= 3 ? "alt" : entry.batch ? "batch" : undefined,
        date: new Date(entry.uploaded_at)
      })) ?? [];
  }

  async batch() {
    return [];
  }

  async movie() {
    return [];
  }

  async test() {
    try {
      const { ok } = await fetch(this.url + "announcements");
      if (!ok) throw new Error(`Failed to load data from ${this.url}! Is the site down?`);
      return true;
    } catch {
      throw new Error(`Could not reach ${this.url}! Does the site work in your region?`);
    }
  }
}();
