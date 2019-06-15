const klaw = require("klaw");
const mm = require("music-metadata");
const md = require("markdown-it")();

const isM4a = /(mp3)|(m4a)$/;

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



async function getMetaDataForPath(root, path) {
    let metadata;
    try {
        metadata = await mm.parseFile(path);
    } catch (e) {
        console.log("Error parsing file", path, e);
        return null;
    }
    const url = path.replace(root, "http://dorward.no-ip.org:3000/audio/");
    // console.log("URL is ", url);
    let image = "";
    if (metadata.common.picture) {
        image = "data:image/jpeg;base64," + metadata.common.picture[0].data.toString("base64");
    }
    metadata.description = md.render(metadata.common.lyrics && metadata.common.lyrics.toString() || "");
    const data = {
        url,
        path,
        metadata,
        title: `${metadata.common.album}: ${metadata.common.title}`,
        image
    };
    return data;
}

function getMetaDataFactory(root) {
    return function getMetaData(episodes) {
        const promises = episodes.map(path => getMetaDataForPath(root, path));
        return Promise.all(promises);
    };
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
        const shows = {};
        episodes.forEach(episode => {
            let show = episode.metadata.common.album;
            // The BBC includes track name in the album titles, but this is unhelpful for subscribing to a given show
            show = show.replace(/[:-] Series \d+(?: Omnibus)?$/, "");
            show = show.replace(/: Christmas Special(?: \d+)?$/, "");
            show = show.replace(/\(Omnibus\)$/, "");
            // Special cases
            if (show.match(/Hitchhiker's Guide to the Galaxy/)) {
                show = "The Hitchhiker's Guide to the Galaxy";
            } else if (show.match(/How to Survive the Roman Empire, by Pliny and Me/)) {
                show = "How to Survive the Roman Empire, by Pliny and Me";
            }

            if (!shows[show]) {
                shows[show] = [];
            }
            shows[show].push(episode);
        });

        // Now sort them
        Object.values(shows).forEach(album => album.sort(sort_rules));
        Object.values(shows).forEach(album => album.forEach(episode => {
            if (episode.metadata) {
                console.log({
                    title: episode.title,
                    disc: episode.metadata.common.disk.no,
                    track: episode.metadata.common.track.no,
                    top_keys: Object.keys(episode), 
                    metadata_keys: Object.keys(episode.metadata)
                });
            } else {
                console.log("!!!!!!!!!");
                console.log("No metadata for: ", { episode, top_keys: Object.keys(episode), metadata_keys: Object.keys(episode.metadata) });
            }
            
        }));
        function sort_rules(a, b) {
            if (a.metadata.common.disk.no < b.metadata.common.disk.no) {
                console.log(a.title, "Disk", a.metadata.common.disk.no, "<", b.title, "Disk", b.metadata.common.disk.no);
                return 1;
            }
            if (a.metadata.common.disk.no > b.metadata.common.disk.no) {
                console.log(a.title, "Disk", a.metadata.common.disk.no, ">", b.title, "Disk", b.metadata.common.disk.no);
                return -1;
            }
            if (a.metadata.common.track.no < b.metadata.common.track.no) {
                console.log(a.title, "Track", a.metadata.common.track.no, "<", b.title, "Track", b.metadata.common.track.no);
                return 1;
            }
            if (a.metadata.common.track.no > b.metadata.common.track.no) {
                console.log(a.title, "Track", a.metadata.common.track.no, ">", b.title, "Track", b.metadata.common.track.no);
                return -1;
            }
            console.log(a.title, "=", b.title, [
                a.metadata.common.disk.no,
                b.metadata.common.disk.no,
                a.metadata.common.track.no,
                b.metadata.common.track.no
            ]);
            return 0;
        }

        resolve(shows);
    });
}

function filterMetaDataFactory(path) {
    return function filterMetaData(data) {
        return data.map(item => ({
            url: item.path.replace(path, "http://dorward.no-ip.org:3000/audio/"),
            enclosure: {
                url: item.path.replace(path, "http://dorward.no-ip.org:3000/audio/"),
                file: item.path
            },
            date: item.metadata.common.date,
            title: `${item.metadata.common.album}: ${item.metadata.common.title}`,
            author: item.metadata.common.artist,
            description: item.metadata.description
        }));
    };
}

module.exports = {
    getAudioFiles,
    getMetaDataFactory,
    filterMetaDataFactory,
    groupByAlbum,
    removeEpisodesWithMissingMetaData
};