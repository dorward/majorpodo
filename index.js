const path = "/home/downloaduser/get_iplayer/";
const klaw = require("klaw");
const mm = require("music-metadata");
const podcast = require("podcast");
const md = require("markdown-it")();

const isM4a = /m4a$/;

getAudioFiles().then(getMetaData).then(filterMetaData).then(generateRSS);

function getAudioFiles() {
    return new Promise(resolve => {
        const paths = [];
        klaw(path, { filter: item => isM4a.test(item) })
            .on("data", item => paths.push(item.path))
            .on("end", () => {
                paths.shift(); // Remove the root directory itself
                resolve(paths);
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
        enclosure: {
            url: item.path,
            file: item.path
        },
        date: item.metadata.common.date,
        title: `${item.metadata.common.album}: ${item.metadata.common.title}`,
        author: item.metadata.common.artist,
        description: md.render(item.metadata.common.lyrics.toString())
    }));
}

function generateRSS(data) {
    const feed = new podcast({
        title: "iPlayer on the pod",
        description: "BBC radio programs collected using get_iplayer"
    });
    data.forEach(item => feed.addItem(item));
    const xml = feed.buildXml("    ");
    process.stdout.write(xml);
}