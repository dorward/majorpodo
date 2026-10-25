import { MEDIA_PATH, IMAGE_PATH, HTTP_MEDIA_ROOT, HTTP_IMAGE_ROOT } from './constants';

export const media_path_to_url = (path: string) => path.replace(MEDIA_PATH, HTTP_MEDIA_ROOT);
export const image_path_to_url = (path: string) => path.replace(IMAGE_PATH, HTTP_IMAGE_ROOT);
