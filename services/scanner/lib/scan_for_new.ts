import { recordDiscoveredFiles } from './database/discovery';
import getFileList from './get_file_list';
import update_metadata_for_file, { filtersSignature } from './update_metadata_for_file';
import ensureRefreshSchema from './database/ensure_refresh_schema';
import pool from './database/database';
import type { StoredEpisode } from './types';
import { HAS_MEDIA_EXTENSION, MEDIA_PATH } from './constants';

import { log, error } from './log';
import withScanLock from './with_scan_lock';

const scan = () =>
    withScanLock(async () => {
        log(`Start insert scan: ${new Date().toISOString()}`);
        await ensureRefreshSchema();
        const known =
            await pool.query<StoredEpisode>(`SELECT id, series_id, file_path, image_path, image_url, file_signature,
            artwork_signature, filters_signature, source_metadata FROM episode`);
        const existing = new Map(known.rows.map((episode) => [episode.file_path, episode]));
        const filterSignature = filtersSignature();
        const list_of_files = await getFileList(MEDIA_PATH, HAS_MEDIA_EXTENSION);
        await recordDiscoveredFiles(list_of_files);
        for (let i = 0; i < list_of_files.length; i++) {
            try {
                const file = list_of_files[i];
                await update_metadata_for_file(file, {
                    existing: existing.get(file) ?? null,
                    filtersSignature: filterSignature,
                });
            } catch (e) {
                error(e);
            }
        }
        log(`End insert scan: ${new Date().toISOString()}`);
    });

export default scan;
