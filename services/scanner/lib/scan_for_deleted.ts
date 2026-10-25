import getFileList from './get_file_list';
import { HAS_MEDIA_EXTENSION, MEDIA_PATH, IMAGE_PATH } from './constants';
import pruneMissingEpisodes from './database/prune_missing_episodes';
import { listCachedImages, removeUnusedImages } from './cached_images';
import withScanLock from './with_scan_lock';
import { log } from './log';
import ensureRefreshSchema from './database/ensure_refresh_schema';

const scan = () =>
    withScanLock(async () => {
        log(`Start delete scan: ${new Date().toISOString()}`);
        // Finish both traversals before changing the database. Inaccessible or
        // partially scanned directories must not be interpreted as deleted files.
        await ensureRefreshSchema();
        const existingFiles = new Set(await getFileList(MEDIA_PATH, HAS_MEDIA_EXTENSION));
        const cachedImages = await listCachedImages(IMAGE_PATH);
        const { deletedFiles, referencedImages } = await pruneMissingEpisodes(existingFiles);
        for (const filename of deletedFiles) log(`Deleted missing episode: ${filename}`);
        // The database transaction has committed before any artwork is removed.
        await removeUnusedImages(cachedImages, referencedImages);
        log(`End delete scan: ${new Date().toISOString()}`);
    });

export default scan;
