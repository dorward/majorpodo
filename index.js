const path = "/home/downloaduser/get_iplayer/";
const klaw = require("klaw");
const mm = require("music-metadata");
const podcast = require("podcast");
const md = require("markdown-it")();
const express = require("express");
const morgan = require("morgan");
const serveStatic = require("serve-static");

const isM4a = /m4a$/;


const app = express();
app.use(morgan("tiny"));
app.get("/rss", serveRSS);
// app.use("/static", express.static(path));
app.use("/static", serveStatic(path));

app.listen(3000, () => process.stdout.write("podcast_get_iplayer now on port 3000\n"));

function serveRSS(req, res) {
    getAudioFiles().then(getMetaData).then(filterMetaData).then(generateRSS);

    function getAudioFiles() {
        return new Promise(resolve => {
            const paths = [];
            klaw(path)
                .on("data", item => paths.push(item.path))
                .on("end", () => {
                    const m4as = paths.filter(file => isM4a.test(file));
                    resolve(m4as);
                });
        });
    }

    function getMetaData(data) {
        return Promise.all(data.map(path => {
            return new Promise(resolve =>
                mm.parseFile(path).then(
                    metadata => resolve({ path: path, metadata: metadata })
                )
            );
        }));
    }


    function filterMetaData(data) {
        // data.forEach(item => process.stdout.write(`${item.metadata.common.date}\n\n${item.metadata.common.album}: ${item.metadata.common.title}\n\n${item.metadata.common.artist}\n\n${item.metadata.common.lyrics}\n\n=======\n\n`));
        return data.map(item => ({
            url: item.path.replace(path, "http://dorward.no-ip.org:3000/static/"),
            enclosure: {
                url: item.path.replace(path, "http://dorward.no-ip.org:3000/static/"),
                file: item.path
            },
            date: item.metadata.common.date,
            title: `${item.metadata.common.album}: ${item.metadata.common.title}`,
            author: item.metadata.common.artist,
            description: md.render(item.metadata.common.lyrics && item.metadata.common.lyrics.toString() || "")
        }));
    }

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