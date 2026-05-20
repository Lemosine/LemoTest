export async function search(query) {
    const cleanQuery = encodeURIComponent(`${query} "dub"`);
    const searchUrl = `https://nyaa.si/?f=0&c=1_2&q=${cleanQuery}`;

    try {
        const response = await fetch(searchUrl);
        const htmlText = await response.text();
        return parseNyaaHTML(htmlText);
    } catch (error) {
        console.error("Lemo Scraper Error:", error);
        return [];
    }
}

function parseNyaaHTML(html) {
    const results = [];
    const regex = /<a href="magnet:\?xt=urn:btih:([^"]+)"[^>]*>.*?title="([^"]+)"/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
        const infoHash = match[1];
        const title = decodeURIComponent(match[2]).replace(/\+/g, ' ');
        
        results.push({
            title: title,
            magnet: `magnet:?xt=urn:btih:${infoHash}`,
            source: "Lemo Dub Tracker"
        });
    }

    return results;
}