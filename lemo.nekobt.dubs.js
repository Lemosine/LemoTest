const QUALITIES = ["1080", "720", "540", "480"];
const MAX_SAFE_BATCH_EPISODES = 36;

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
  const target = Number.parseInt(episode, 10);
  if (!Number.isFinite(target)) return false;

  const text = String(title);
  const explicitEpisodes = [
    ...text.matchAll(/\bS\d{1,2}\s*E\s*(\d{1,4})(?!\d)/gi),
    ...text.matchAll(/\b(?:E|EP|EPS|Episode)\s*\.?\s*(\d{1,4})(?!\d)/gi)
  ];

  if (explicitEpisodes.length) {
    return explicitEpisodes.some(match => Number.parseInt(match[1], 10) === target);
  }

  for (const match of text.matchAll(/\d{1,4}/g)) {
    const value = match[0];
    const parsed = Number.parseInt(value, 10);
    if (parsed !== target) continue;

    const index = match.index ?? 0;
    const before = text[index - 1] ?? "";
    const suffix = text.slice(index + value.length);
    const after = suffix[0] ?? "";

    if (value.length === 4 && parsed >= 1900 && parsed <= 2099) continue;
    if (/[A-Za-z]/.test(before)) continue;
    if (/[A-Za-z]/.test(after) && !/^v\d/i.test(suffix)) continue;
    return true;
  }

  return false;
}

function rangeForEpisode(title, episode) {
  const ep = Number.parseInt(episode, 10);
  if (!Number.isFinite(ep)) return null;

  const ranges = [
    ...title.matchAll(/\bS\d{1,2}E(\d{1,4})\s*[-~\u2013\u2014]\s*E?(\d{1,4})\b/gi),
    ...title.matchAll(/\b(?:E|EP|EPS|Episodes?)?\s*(\d{1,4})\s*[-~\u2013\u2014]\s*(?:E|EP|EPS|Episodes?)?\s*(\d{1,4})\b/gi)
  ];

  for (const match of ranges) {
    const start = Number.parseInt(match[1], 10);
    const end = Number.parseInt(match[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start >= 1900 && end >= 1900) continue;

    const low = Math.min(start, end);
    const high = Math.max(start, end);
    const span = high - low + 1;
    if (span < 2) continue;
    if (ep >= low && ep <= high) return { start: low, end: high, span };
  }

  return null;
}

function acceptableEpisodeResult(title, episode) {
  if (!episode) return true;
  const range = rangeForEpisode(title, episode);
  if (range) return range.span <= MAX_SAFE_BATCH_EPISODES;
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
        type: entry.batch || rangeForEpisode(entry.title, episode)
          ? "batch"
          : (entry.level ?? 0) >= 3 ? "alt" : undefined,
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
