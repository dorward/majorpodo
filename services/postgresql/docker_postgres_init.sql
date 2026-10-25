CREATE TABLE series (
    id SERIAL PRIMARY KEY,
    series_title TEXT NOT NULL UNIQUE
);

CREATE TABLE episode (
    id SERIAL PRIMARY KEY,
    is_video BOOLEAN,
    series_id INT NOT NULL,
    episode_title TEXT  NOT NULL,
    episode_description TEXT,
    season_num INTEGER,
    episode_num INTEGER,
    author TEXT,
    file_path TEXT NOT NULL UNIQUE,
    file_url TEXT NOT NULL UNIQUE,
    image_path TEXT NOT NULL,
    image_url TEXT NOT NULL,
    date TIMESTAMP NOT NULL,
    file_signature TEXT,
    artwork_signature TEXT,
    filters_signature TEXT,
    source_metadata JSONB,
    FOREIGN KEY (series_id) REFERENCES series (id)
);

CREATE TABLE IF NOT EXISTS media_discovery (
    file_path TEXT PRIMARY KEY,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ,
    original_title TEXT,
    series_title TEXT,
    alias_rules JSONB,
    last_error TEXT
);
CREATE INDEX IF NOT EXISTS media_discovery_order ON media_discovery(discovered_at DESC, file_path);
