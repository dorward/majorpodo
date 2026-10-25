export type Metadata = {
    description: string;
    title: string;
    author: string | undefined;
    series_name: string;
    isVideo: boolean;
    image: {
        path: string;
        url: string;
    };
    season_num: number | null;
    episode_num: number | null;
    filepath: string;
    url: string;
    date: Date;
};

export type Image = { path: string; url: string };

// Store only useful tag data, never the embedded image bytes or full parser output.
export type SourceMetadata = {
    album?: string;
    title?: string;
    description: string;
    season_num: number;
    episode_num: number;
    author?: string;
    date: string;
    embeddedImage?: Image;
};

export type StoredEpisode = {
    id: number;
    series_id: number;
    file_path: string;
    image_path: string;
    image_url: string;
    file_signature: string | null;
    artwork_signature: string | null;
    filters_signature: string | null;
    source_metadata: SourceMetadata | null;
};

export type AliasRule = {
    kind: 'remove' | 'replace';
    rule: number;
    expression: string;
    before: string;
    after: string;
};
