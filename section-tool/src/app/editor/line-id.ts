/**
 * Stable line ids: 8 random characters from the lowercase RFC 4648 base32
 * alphabet ([a-z2-7]{8}). Random, never positional, so inserting or moving
 * lines never renumbers anything.
 *
 * Same format as data/tools/src/line-id.ts, which the data build validates
 * against (line-id.spec.ts checks the two stay in step).
 */

export const LINE_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const LINE_ID_LENGTH = 8;
export const LINE_ID_PATTERN = /^[a-z2-7]{8}$/;

export type RandomBytes = (n: number) => Uint8Array;

const cryptoBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export function isLineId(value: unknown): value is string {
  return typeof value === 'string' && LINE_ID_PATTERN.test(value);
}

/** One random id. The alphabet has 32 symbols, so `byte & 31` is unbiased. */
export function randomLineId(random: RandomBytes = cryptoBytes): string {
  let id = '';
  for (const b of random(LINE_ID_LENGTH)) id += LINE_ID_ALPHABET[b & 31];
  return id;
}

/** A random id not in `taken`, retrying on collision. Does not add it to `taken`. */
export function freshLineId(taken: ReadonlySet<string>, random: RandomBytes = cryptoBytes): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = randomLineId(random);
    if (!taken.has(id)) return id;
  }
  throw new Error('freshLineId: could not find a free id (is the random source broken?)');
}
