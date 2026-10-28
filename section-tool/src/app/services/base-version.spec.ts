import { describe, it, expect } from 'vitest';
import { gitBlobSha, staleBaseError } from './base-version';

describe('gitBlobSha', () => {
  it('matches git hash-object', async () => {
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('hashes UTF-8 bytes (Hebrew text)', async () => {
    // printf 'שלום\n' | git hash-object --stdin
    expect(await gitBlobSha('שלום\n')).toBe('319a9628524cae3be1420c3fd49683f1212c5bcf');
  });
});

describe('staleBaseError', () => {
  it('allows a save with no base, no current file, or a matching base', () => {
    expect(staleBaseError(null, 'abc')).toBeNull();
    expect(staleBaseError(undefined, 'abc')).toBeNull();
    expect(staleBaseError('abc', undefined)).toBeNull();
    expect(staleBaseError('abc', 'abc')).toBeNull();
  });

  it('refuses a save whose base is not the current file', () => {
    expect(staleBaseError('abc', 'def')).toMatch(/changed in the repository/);
  });
});
