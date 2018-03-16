const path = "/home/downloaduser/get_iplayer/";
const podcast = require("podcast");
const express = require("express");
const morgan = require("morgan");
const serveStatic = require("serve-static");
const { getAudioFiles, getMetaData, filterMetaDataFactory, groupByAlbum, removeEpisodesWithMissingMetaData } = require("./lib/audio_search.js");


const app = express();
app.use(morgan("tiny"));
app.get("/rss", serveRSS);
app.get("/json", serveDebugData);
app.use("/static", serveStatic(path));

app.listen(3000, () => process.stdout.write("podcast_get_iplayer now on port 3000\n"));

function serveDebugData(req, res) {
    getAudioFiles(path).then(getMetaData).then(removeEpisodesWithMissingMetaData).then(groupByAlbum).then(generateJSON);

    function generateJSON(data) {
        // Images are expensive!
        Object.keys(data).forEach(key => data[key].forEach(item => item.metadata.common.picture = "placeholder"));
        res.set("Content-Type", "application/json");
        res.send(JSON.stringify(data, undefined, 4));
    }
}

function serveRSS(req, res) {
    getAudioFiles(path).then(getMetaData).then(removeEpisodesWithMissingMetaData).then(filterMetaDataFactory(path)).then(generateRSS);

    function generateRSS(data) {
        const feed = new podcast({
            title: "iPlayer on the pod",
            feedUrl: "http://dorward.no-ip.org:3000/rss",
            siteUrl: "http://dorward.no-ip.org:3000/",
            description: "BBC radio programs collected using get_iplayer"
        });
        data.forEach(item => feed.addItem(item));
        const xml = feed.buildXml("    ");
        res.set("Content-Type", "application/rss+xml");
        res.send(xml);
    }
}