import { expect, test } from 'vitest';
import { legacy_episode_guid, url_for_asset, url_for_episode } from '../lib/urls';

test.each([
    ['/media/example.mp3', '/media/example.mp3'],
    ['/images/a picture.jpg', '/images/a%20picture.jpg'],
    ['/media/Épisode ?#&.mp3', '/media/%C3%89pisode%20%3F%23%26.mp3'],
    ['/media/100% complete.mp4', '/media/100%25%20complete.mp4'],
    ['/media/literal%20name.m4a', '/media/literal%2520name.m4a'],
    ['/static/default_image.png', '/static/default_image.png'],
])('encodes raw asset path %j as an absolute URL', (path, encoded) => {
    const result = url_for_asset(path);
    expect(result).toBe(`https://majorpodo.example.com${encoded}`);
    expect(new URL(result).search).toBe('');
    expect(new URL(result).hash).toBe('');
    expect(decodeURIComponent(new URL(result).pathname)).toBe(path);
});

test('episode page links encode the series title as one path segment', () => {
    expect(url_for_episode('Show / ?#&%', 42)).toBe(
        'https://majorpodo.example.com/Show%20%2F%20%3F%23%26%25/episode/42',
    );
});

test('keeps existing episode GUIDs even when asset encoding changes', () => {
    expect(legacy_episode_guid('/media/literal%20name.mp3')).toBe(
        'https://majorpodo.example.com/media/literal%20name.mp3',
    );
});
