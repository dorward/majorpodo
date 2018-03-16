const klaw = require("klaw");
const mm = require("music-metadata");
const md = require("markdown-it")();

const isM4a = /m4a$/;

function getAudioFiles(path) {
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

// This is syncronous so it doesn't need to be a promise, it is only that way so it chain in with the other ones nicely
function removeEpisodesWithMissingMetaData(episodes) {
    return new Promise(resolve => {
        resolve(episodes.filter(episode => {
            if (!episode.metadata.common.album) {
                process.stderr.write(episode.path + " missing metadata\n");
                return false;
            } else {
                return true;
            }
        }));
    });
}

// This is syncronous so it doesn't need to be a promise, it is only that way so it chain in with the other ones nicely
function groupByAlbum(episodes) {
    return new Promise(resolve => {
        const albums = {};
        episodes.forEach(episode => {
            let album = episode.metadata.common.album;
            // The BBC includes series name in the album titles, but this is unhelpful for subscribing to a given show
            album = album.replace(/[:-] Series \d+(?: Omnibus)?$/, "");
            album = album.replace(/: Christmas Special(?: \d+)?$/, "");
            album = album.replace(/\(Omnibus\)$/, "");
            // Hitchhiker is something of a special case. Sometimes it has "The" on the front and the series names are not numbers!
            if (album.match(/Hitchhiker's Guide to the Galaxy/)) {
                album = "The Hitchhiker's Guide to the Galaxy";
            }

            if (!albums[album]) {
                albums[album] = [];
            }
            albums[album].push(episode);
        });
        resolve(albums);
    });
}


function filterMetaDataFactory(path) {
    return function filterMetaData(data) {
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
    };
}


module.exports = {
    getAudioFiles,
    getMetaData,
    filterMetaDataFactory,
    groupByAlbum,
    removeEpisodesWithMissingMetaData
};