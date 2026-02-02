/**
 * Torrent name parsing and formatting utilities
 */

export interface ParsedTorrentName {
  artist: string | null;
  album: string | null;
  quality: string | null;
}

export function parseTorrentName(name: string): ParsedTorrentName {
  if (!name) return { artist: null, album: null, quality: null };

  let cleanName = name
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\{.*?\}/g, '')
    .trim();

  const qualityMatch = name.match(
    /\b(FLAC|MP3|320|256|V0|24bit|16bit|Hi-?Res|Lossless|WEB|CD|Vinyl)\b/i
  );
  const quality = qualityMatch ? qualityMatch[1].toUpperCase() : null;

  const parts = cleanName.split(/\s*[-–]\s*/);
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      album: parts.slice(1).join(' - ').trim(),
      quality,
    };
  }

  return { artist: null, album: cleanName, quality };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function extractArtistFromTitle(title: string): string | null {
  if (!title) return null;
  const parts = title.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return parts[0].replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
  }
  return null;
}
