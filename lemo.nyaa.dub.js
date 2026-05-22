// ==MiruExtension==
// @name Lemo Nyaa English Dubs
// @version v1.0.0
// @author Lemosine
// @lang en
// @package lemo.nyaa.dub
// @type bangumi
// @webSite https://nyaa.si
// ==/MiruExtension==

export default class extends Extension {
    async search(query) {
        const cleanQuery = encodeURIComponent(`${query} "dub"`);
        const searchUrl = `https://nyaa.si/?f=0&c=1_2&q=${cleanQuery}`;

        try {
            const response = await this.request({
                url: searchUrl,
                method: "GET"
            });
            return this.parseNyaaHTML(response);
        } catch (error) {
            console.error("Lemo Scraper Error:", error);
            return [];
        }
    }

    parseNyaaHTML(html) {
        const results = [];
        const regex = /<a href="magnet:\?xt=urn:btih:([^"]+)"[^>]*>.*?title="([^"]+)"/g;
        let match;

        while ((match = regex.exec(html)) !== null) {
            const infoHash = match[1];
            const title = decodeURIComponent(match[2]).replace(/\+/g, ' ');
            
            results.push({
                title: title,
                url: `magnet:?xt=urn:btih:${infoHash}`
            });
        }

        return results;
    }

    async latest() {
        return [];
    }

    async detail(url) {
        return {
            title: "Anime Torrent Stream",
            episodes: [{
                title: "Play Video",
                url: url
            }]
        };
    }

    async watch(url) {
        return {
            type: "torrent",
            url: url
        };
    }
}