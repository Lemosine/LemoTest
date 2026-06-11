const API_URL = "https://releases.moe/api/collections/entries";

export default new class {
  url = API_URL;
  
  async single({ anilistId, titles, episodeCount, fetch: request = fetch }) {
    if (!navigator.onLine) return [];
    if (!anilistId) throw new Error("No anilistId provided");
    if (!titles?.length) throw new Error("No titles provided");
    
    const filter = encodeURIComponent(`(alID="${anilistId}"&&trs.dualAudio?=true)`);
    const res = await request(`${this.url}?page=1&perPage=1&filter=${filter}&skipTotal=1&expand=trs`);
    const {items: items = []} = await res.json();
    if (!items[0]?.expand?.trs?.length) return [];
    
    const {trs: trs} = items[0].expand;
    
    return trs.filter(({infoHash: infoHash, files: files, dualAudio: dualAudio}) => "<redacted>" !== infoHash && ((!episodeCount || 1 === episodeCount || 1 === files.length) && dualAudio)).map(torrent => ({
      hash: torrent.infoHash,
      link: torrent.infoHash,
      title: 1 === torrent.files.length ? torrent.files[0].name : `[${torrent.releaseGroup}] ${titles[0]} ${torrent.dualAudio ? "Dual Audio" : ""}`,
      size: torrent.files.reduce((prev, curr) => prev + curr.length, 0),
      type: torrent.isBest ? "best" : "alt",
      date: new Date(torrent.created),
      seeders: 0,
      leechers: 0,
      downloads: 0,
      accuracy: "high"
    }));
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
