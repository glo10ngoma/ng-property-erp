import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
const KEY_LENGTH = 64;
const DEFAULT_N = 16384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;

export async function hashPassword(password: string, salt = randomBytes(16).toString('base64url')) {
  const derivedKey = await deriveKey(password, salt, KEY_LENGTH, DEFAULT_N, DEFAULT_R, DEFAULT_P);
  return ['scrypt', DEFAULT_N, DEFAULT_R, DEFAULT_P, salt, derivedKey.toString('base64url')].join('|');
}

export async function verifyPassword(password: string, storedHash: string) {
  if (storedHash.startsWith('scrypt|')) {
    const [, n, r, p, salt, hash] = storedHash.split('|');
    if (!n || !r || !p || !salt || !hash) return false;
    const derivedKey = await deriveKey(password, salt, Buffer.from(hash, 'base64url').length, Number(n), Number(r), Number(p));
    const expected = Buffer.from(hash, 'base64url');
    return derivedKey.length === expected.length && timingSafeEqual(derivedKey, expected);
  }

  // Temporary compatibility for databases seeded before password hashing.
  return storedHash === password;
}

function deriveKey(password: string, salt: string, keyLength: number, n: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, { N: n, r, p }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
