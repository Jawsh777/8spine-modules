/**
 * BitTorrent hash validation utilities
 */

const HASH_LENGTH_V1 = 40; // SHA-1 hex
const HASH_LENGTH_V2 = 32; // Base32

export function validateHash(hash: string): boolean {
  if (!hash || typeof hash !== 'string') return false;

  const len = hash.length;
  if (len !== HASH_LENGTH_V1 && len !== HASH_LENGTH_V2) {
    return false;
  }

  if (len === HASH_LENGTH_V1) {
    return /^[a-fA-F0-9]{40}$/i.test(hash);
  }

  if (len === HASH_LENGTH_V2) {
    return /^[a-zA-Z2-7]{32}$/i.test(hash);
  }

  return false;
}

export function extractHash(magnet: string): string | null {
  if (!magnet) return null;

  const match = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  const hash = match ? match[1].toLowerCase() : null;

  if (hash && !validateHash(hash)) {
    return null;
  }

  return hash;
}
