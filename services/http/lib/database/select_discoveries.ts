import pool from './database';

export type Discovery = {
    file_path: string;
    discovered_at: Date;
    processed_at: Date | null;
    original_title: string | null;
    series_title: string | null;
    alias_rules:
        | {
              kind: string;
              rule: number;
              expression: string;
              before: string;
              after: string;
          }[]
        | null;
    last_error: string | null;
    episode_id: number | null;
};

export const discoveryPageSize = 100;
export const selectDiscoveries = async (page: number) => {
    const result = await pool.query<Discovery>(
        `SELECT discovery.*, episode.id AS episode_id FROM media_discovery discovery
         LEFT JOIN episode ON episode.file_path = discovery.file_path
         ORDER BY discovery.discovered_at DESC, discovery.file_path ASC
         LIMIT $1 OFFSET $2`,
        [discoveryPageSize + 1, (page - 1) * discoveryPageSize],
    );
    return {
        records: result.rows.slice(0, discoveryPageSize),
        hasNext: result.rows.length > discoveryPageSize,
    };
};
