export type ShowInfo = {
    // PostgreSQL COUNT returns int8 values as strings through node-postgres.
    is_video: string;
    episode_count: string;
    series_title: string;
    image: string;
};

export type EpisodeInfo = {
    id: number;
    author: string | null;
    is_video: boolean;
    episode_title: string;
    episode_description: string;
    season_num: number;
    episode_num: number;
    file_url: string;
    image_url: string;
    series_title: string;
    date: Date;
};
