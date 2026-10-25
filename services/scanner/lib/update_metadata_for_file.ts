import type { Metadata, SourceMetadata, StoredEpisode } from './types';
import { parseFile } from 'music-metadata';
import md_it from 'markdown-it';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { HAS_VIDEO_EXTENSION, IMAGE_PATH } from './constants';
import configuration from './configuration';
import { cacheImage, cacheManualImage, defaultImage } from './select_image';
import { media_path_to_url } from './path_to_url';
import logger from './log';
import { normaliseSeriesWithRules } from './normalise_series_name';
import { recordDiscoveryFailure } from './database/discovery';
import select_episode from './database/select_episode';
import saveEpisode from './database/save_episode';
import filters from './filters';
import { fileStats, signature } from './file_signature';

const md = md_it();
export const filtersSignature = () =>
    createHash('sha256')
        .update(
            JSON.stringify({
                version: 2,
                filters,
                paths: configuration.paths,
                media: configuration.media,
            }),
        )
        .digest('hex');

type Options = { existing?: StoredEpisode | null; filtersSignature?: string };

const update_metadata_for_file = async (filepath: string, options: Options = {}) => {
    const existing =
        options.existing === undefined ? await select_episode(filepath) : options.existing;
    try {
        const stats = await fileStats(filepath);
        if (!stats) return existing ?? undefined;
        const fileSignature = signature(stats);
        const manualPath = filepath.replace(/\.[0-9a-zA-Z]{3,4}$/, '.jpg');
        const manualStats = await fileStats(manualPath);
        const artworkSignature = manualStats ? signature(manualStats) : null;
        const filterSignature = options.filtersSignature ?? filtersSignature();
        const inCache = (filename: string) => {
            const relative = path.relative(IMAGE_PATH, filename);
            return (
                relative !== '..' &&
                !relative.startsWith('..' + path.sep) &&
                !path.isAbsolute(relative)
            );
        };
        const embedded = existing?.source_metadata?.embeddedImage;
        const cacheMoved = !!embedded && !inCache(embedded.path);
        // Stat cached assets without reading their bytes. Repair only missing
        // images; source media is reparsed only if embedded artwork was lost.
        const embeddedAvailable =
            !embedded || (!cacheMoved && !!(await fileStats(embedded.path)));
        const imageAvailable =
            !existing?.image_path ||
            (inCache(existing.image_path) &&
                (existing.image_path === embedded?.path
                    ? embeddedAvailable
                    : !!(await fileStats(existing.image_path))));
        if (
            !cacheMoved &&
            embeddedAvailable &&
            imageAvailable &&
            existing?.source_metadata &&
            existing.file_signature === fileSignature &&
            existing.artwork_signature === artworkSignature &&
            existing.filters_signature === filterSignature
        )
            return existing;

        let source: SourceMetadata;
        if (
            !cacheMoved &&
            embeddedAvailable &&
            existing?.source_metadata &&
            existing.file_signature === fileSignature
        ) {
            source = existing.source_metadata;
        } else {
            const parsed = await parseFile(filepath);
            if (!parsed.format.container) throw new Error(`Unrecognised media: ${filepath}`);
            const common = parsed.common;
            const picture = common.picture?.[0]?.data;
            source = {
                album: common.album,
                title: common.title,
                description: md.render(
                    common.lyrics?.map((lyrics) => lyrics.text ?? '').join(',') ?? '',
                ),
                season_num: common.disk.no || 0,
                episode_num: common.track.no || 0,
                author: common.artist,
                date: new Date(
                    common.date || Number(stats.birthtimeNs / 1000000n),
                ).toISOString(),
                embeddedImage: picture ? await cacheImage(picture) : undefined,
            };
        }
        const image = manualStats
            ? existing?.source_metadata &&
              existing.artwork_signature === artworkSignature &&
              inCache(existing.image_path) &&
              imageAvailable
                ? { path: existing.image_path, url: existing.image_url }
                : await cacheManualImage(manualPath)
            : (source.embeddedImage ?? defaultImage);
        const aliases = normaliseSeriesWithRules(source.album);
        const series = aliases.title;
        const title =
            source.title ||
            path.basename(filepath, path.extname(filepath)).replace(/[^a-zA-Z0-9]+/g, ' ');
        const metadata: Metadata = {
            filepath,
            url: media_path_to_url(filepath),
            isVideo: HAS_VIDEO_EXTENSION.test(filepath),
            title: source.album ? `${series}: ${title}` : title,
            series_name: series,
            description: source.description,
            image,
            season_num: source.season_num,
            episode_num: source.episode_num,
            author: source.author,
            date: new Date(source.date),
        };
        // A file edited during parsing is retried next scan, never recorded with
        // a fingerprint that would make partially read metadata look up to date.
        const after = await fileStats(filepath);
        const manualAfter = await fileStats(manualPath);
        if (
            !after ||
            signature(after) !== fileSignature ||
            (manualAfter ? signature(manualAfter) : null) !== artworkSignature
        ) {
            throw new Error(`File changed during refresh: ${filepath}`);
        }
        return await saveEpisode(
            metadata,
            source,
            fileSignature,
            artworkSignature,
            filterSignature,
            existing?.series_id,
            aliases.rules,
        );
    } catch (error) {
        logger.log({ level: 'error', message: `Unable to refresh ${filepath}: ${error}` });
        await recordDiscoveryFailure(filepath, error).catch((auditError) =>
            logger.log({
                level: 'error',
                message: `Unable to record discovery failure: ${auditError}`,
            }),
        );
        return existing ?? undefined;
    }
};

export default update_metadata_for_file;
