const { filterMetaDataFactory, updateShowIndex } = require("./audio_search");
const podcast = require("podcast");
const nunjucks = require("nunjucks");
const config = require("config");

const path = config.get("path");
const http_path = config.get("httpRoot");

const filterMetaData = filterMetaDataFactory(path);

let showindex = updateShowIndex();
setInterval(() => showindex = updateShowIndex(), 60000 * 90); // Refresh every 90 minutes

async function listShows(req, res) {
    const data = await showindex;
    const shows = Object.keys(data).sort();
    res.send(nunjucks.render("index.html", { shows }));
}

async function aboutShow(req, res) {
    const data = await showindex;
    const show = data[req.params.show];
    if (!show) {
        res.status(404).send("Sorry can't find that!");
    } else {
        res.send(nunjucks.render("show.html", { show, title: req.params.show }));
    }
}

async function aboutShowRSS(req, res) {
    const data = await showindex;
    const show = data[req.params.show];
    if (!show) {
        res.status(404).send("Sorry can't find that!");
    } else {
        let rss_data = filterMetaData(show);
        const feed = new podcast({
            title: req.params.show,
            feedUrl: http_path + encodeURIComponent(req.params.show) + "/rss",
            siteUrl: http_path + encodeURIComponent(req.params.show),
            description: "BBC radio programs collected using get_iplayer",
            imageUrl: rss_data[0].image
        });
        rss_data.forEach(item => feed.addItem(item));
        const xml = feed.buildXml("    ");
        res.set("Content-Type", "application/rss+xml");
        res.send(xml);
    }
}

async function serveDebugData(req, res) {
    const data = await showindex;
    // Images are expensive!
    Object.keys(data).forEach(key => data[key].forEach(item => item.metadata.common.picture = "placeholder"));
    res.set("Content-Type", "application/json");
    res.send(JSON.stringify(data, undefined, 4));
}

module.exports = { listShows, aboutShow, aboutShowRSS, serveDebugData };