const { getAudioFiles, getMetaDataFactory, filterMetaDataFactory, groupByAlbum, removeEpisodesWithMissingMetaData } = require("./audio_search");
const podcast = require("podcast");
const nunjucks = require("nunjucks");
const logger = require("./log");
const config = require("config");

const path = config.get("path");
const http_path = config.get("httpRoot");

const getMetaData = getMetaDataFactory(path);
const filterMetaData = filterMetaDataFactory(path);

let showindex = updateShowIndex();
setInterval(() => showindex = updateShowIndex(), 60000 * 90); // Refresh every 90 minutes

function listShows(req, res) {
    try {
        showindex.then(generateShowList);
    } catch (error) {
        logger.log({ 
            level: "error", 
            message: "Error trying to use showindex which should be a promise: " + JSON.stringify({ showindex, error })
        });
    }
    
    function generateShowList(data) {
        var shows = Object.keys(data).sort();
        res.send(nunjucks.render("index.html", { shows }));
    }
}

function aboutShow(req, res) {
    try {
        showindex.then(generateShowInfo);
    } catch (error) {
        logger.log({ 
            level: "error", 
            message: "Error trying to use showindex which should be a promise: " + JSON.stringify({ showindex, error })
        });

    }

    function generateShowInfo(data) {
        let show = data[req.params.show];
        if (!show) {
            res.status(404).send("Sorry can't find that!");
        } else {
            res.send(nunjucks.render("show.html", { show, title: req.params.show }));
        }

    }
}

function aboutShowRSS(req, res) {
    try {
        showindex.then(generateShowRSS);
    } catch (error) {
        logger.log({ 
            level: "error", 
            message: "Error trying to use showindex which should be a promise: " + JSON.stringify({ showindex, error })
        });
    }

    function generateShowRSS(data) {
        let show = data[req.params.show];
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
}

function serveDebugData(req, res) {
    showindex.then(generateJSON);

    function generateJSON(data) {
        // Images are expensive!
        Object.keys(data).forEach(key => data[key].forEach(item => item.metadata.common.picture = "placeholder"));
        res.set("Content-Type", "application/json");
        res.send(JSON.stringify(data, undefined, 4));
    }
}

async function updateShowIndex() {
    let files, meta, filtered, grouped;
    files = await getAudioFiles(path);
    meta = await getMetaData(files);
    meta = meta.filter(element => element !== null);
    filtered = await removeEpisodesWithMissingMetaData(meta);
    grouped = await groupByAlbum(filtered);
    return grouped;
}

module.exports = { listShows, aboutShow, aboutShowRSS, serveDebugData };