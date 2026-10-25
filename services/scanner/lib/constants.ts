import configuration from './configuration';

export const HAS_MEDIA_EXTENSION = new RegExp(configuration.media.pattern);
export const HAS_VIDEO_EXTENSION = new RegExp(configuration.media.videoPattern);
export const MEDIA_PATH = configuration.paths.media;
export const IMAGE_PATH = configuration.paths.images;
export const HTTP_MEDIA_ROOT = '/media/';
export const HTTP_IMAGE_ROOT = '/images/';
