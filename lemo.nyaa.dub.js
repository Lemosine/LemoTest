const API_URL = "https://releases.moe/api/collections/entries";

export default new class {
  url = API_URL;
  
  async single({ anilistId, titles, episodeCount, fetch: request = fetch }) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    if (!anilistId) throw new Error("No anilistId provided");
    if (!titles?.length) throw new Error("No titles provided");
    
    const filter = encodeURIComponent(`(alID="${anilistId}"&&trs.dualAudio?=true)`);
    const res = await request(`${this.url}?page=1&perPage=1&filter=${filter}&skipTotal=1&expand=trs`);
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    const trs = Array.isArray(items[0]?.expand?.trs) ? items[0].expand.trs : [];
    if (!trs.length) return [];
    
    return trs
      .filter(torrent => {
        const files = Array.isArray(torrent.files) ? torrent.files : [];

        return (
          torrent.infoHash &&
          "<redacted>" !== torrent.infoHash &&
          torrent.dualAudio &&
          (!episodeCount || 1 === episodeCount || 1 === files.length)
        );
      })
      .map(torrent => {
        const files = Array.isArray(torrent.files) ? torrent.files : [];
        const title = 1 === files.length && files[0]?.name
          ? files[0].name
          : `[${torrent.releaseGroup ?? "SeaDex"}] ${titles[0]} Dual Audio`;

        return {
          hash: torrent.infoHash,
          link: torrent.infoHash,
          title,
          size: files.reduce((prev, curr) => prev + (curr.length ?? 0), 0),
          type: torrent.isBest ? "best" : "alt",
          date: new Date(torrent.created),
          seeders: 0,
          leechers: 0,
          downloads: 0,
          accuracy: "high"
        };
      });
  }

  async batch() {
    return [];
  }

  async movie() {
    return [];
  }

  async test() {
    try {
      if (!(await fetch(this.url)).ok) {
        throw new Error(`Failed to load data from ${this.url}! Is the site down?`);
      }

      return true;
    } catch {
      throw new Error(`Could not reach ${this.url}! Does the site work in your region?`);
    }
  }
}();
