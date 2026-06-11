const QUALITIES = ["1080", "720", "540", "480"];

export default new class NekoBT {
  url = atob("aHR0cHM6Ly9uZWtvYnQudG8vYXBpL3YxLw==");

  async _fetch(request, search) {
    const res = await request(`${this.url}torrents/search?${search}`);
    const json = await res.json();

    if (json.error) throw new Error("NekoBT: " + json.message);
    if (!json.data) throw new Error("NekoBT: Invalid response from server!");
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
    if (!mappings?.media) throw new Error("NekoBT: No media found for the given anime!");

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

    return (await this._fetch(request, searchParams)).results
      ?.filter(({ title }) => {
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
