import configuration from './configuration';

const HTTP_PATH = configuration.publicUrl;

export const url_for_show = (show_name: string) => {
    const myURL = new URL(HTTP_PATH);
    myURL.pathname = `/${encodeURIComponent(show_name)}`;
    return myURL.toString();
};

export const url_for_show_rss = (show_name: string) => {
    const myURL = new URL(HTTP_PATH);
    myURL.pathname = `/${encodeURIComponent(show_name)}/rss`;
    return myURL.toString();
};

export const url_for_episode = (show_name: string, episode_id: number) => {
    return `${url_for_show(show_name)}/episode/${episode_id}`;
};

// Scanner paths are raw filesystem names, not already URL-encoded paths.
export const encode_asset_path = (path: string) =>
    path.split('/').map(encodeURIComponent).join('/');
export const url_for_asset = (path: string) => {
    const myURL = new URL(HTTP_PATH);
    myURL.pathname = encode_asset_path(path);
    return myURL.toString();
};

// RSS previously used the media URL as its implicit GUID. Keep that exact value
// so changing item links or correcting URL encoding does not create new episodes.
export const legacy_episode_guid = (path: string) => {
    const myURL = new URL(HTTP_PATH);
    myURL.pathname = path;
    return myURL.toString();
};
