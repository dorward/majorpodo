import klaw from 'klaw';

const getFileList = (path: string, regex: RegExp) => {
    return new Promise<string[]>((resolve, reject) => {
        const paths: string[] = [];
        klaw(path)
            .on('data', (item) => {
                if (item.stats.isFile()) paths.push(item.path);
            })
            .on('error', reject)
            .on('end', () => {
                const mediaFiles = paths.filter((file) => regex.test(file));
                resolve(mediaFiles);
            });
    });
};

export default getFileList;
