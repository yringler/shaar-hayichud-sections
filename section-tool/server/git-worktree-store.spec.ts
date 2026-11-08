import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitBlobSha } from '../src/app/services/base-version';
import { StoreError } from '../src/save-api/save-store';
import { findRepoRoot, gitBlobShaOfBytes, GitWorktreeStore } from './git-worktree-store';

const CHAPTER = 'data/chapters/chapter_01.json';
const HEBREW = '[{"children":[{"id":"abcd1234","text":"שער היחוד והאמונה"}]}]\n';
const TIMEOUT = 20_000;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function statusOf(cwd: string, file: string): string {
  return execFileSync('git', ['status', '--porcelain', '--', file], { cwd, encoding: 'utf8' }).replace(/\n$/, '');
}

async function rejection(p: Promise<unknown>): Promise<StoreError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(StoreError);
    return err as StoreError;
  }
  throw new Error('expected a rejection');
}

describe('GitWorktreeStore', () => {
  let root: string;
  let store: GitWorktreeStore;
  let chapterAbs: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'git-store-'));
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(root, 'data', 'chapters'), { recursive: true });
    chapterAbs = path.join(root, CHAPTER);
    writeFileSync(chapterAbs, HEBREW);
    writeFileSync(path.join(root, 'a.txt'), 'a\n');
    writeFileSync(path.join(root, 'b.txt'), 'b\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'initial');
    store = new GitWorktreeStore(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it(
    'hashes on-disk bytes like git hash-object and like the browser gitBlobSha',
    async () => {
      const sha = await store.currentSha(CHAPTER);
      expect(sha).toBe(git(root, 'hash-object', CHAPTER));
      expect(sha).toBe(await gitBlobSha(HEBREW));
      expect(gitBlobShaOfBytes(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    },
    TIMEOUT,
  );

  it('returns null for a missing file', async () => {
    expect(await store.currentSha('data/chapters/chapter_99.json')).toBeNull();
  });

  it('finds the repository root from a subdirectory', async () => {
    const found = await findRepoRoot(path.join(root, 'data', 'chapters'));
    expect(found).toBe(git(root, 'rev-parse', '--show-toplevel'));
    const outside = mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    try {
      await expect(findRepoRoot(outside)).rejects.toThrow(/not inside a git checkout/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it(
    'commits only the chapter, leaving other staged, unstaged and untracked changes alone',
    async () => {
      writeFileSync(path.join(root, 'a.txt'), 'a staged\n');
      git(root, 'add', 'a.txt');
      writeFileSync(path.join(root, 'b.txt'), 'b unstaged\n');
      writeFileSync(path.join(root, 'c.txt'), 'c untracked\n');
      const before = git(root, 'rev-parse', 'HEAD');
      const content = HEBREW.replace('והאמונה', 'חדש');

      const result = await store.write(CHAPTER, content, 'Update chapter 1', await gitBlobSha(HEBREW));

      const head = git(root, 'rev-parse', 'HEAD');
      expect(head).not.toBe(before);
      expect(git(root, 'rev-parse', 'HEAD~1')).toBe(before);
      expect(result.commitSha).toBe(head);
      expect(result.contentSha).toBe(await gitBlobSha(content));
      expect(result.contentSha).toBe(git(root, 'rev-parse', `HEAD:${CHAPTER}`));
      expect(git(root, 'log', '-1', '--format=%B')).toBe('Update chapter 1');
      expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe(CHAPTER);
      expect(readFileSync(chapterAbs, 'utf8')).toBe(content);

      expect(statusOf(root, CHAPTER)).toBe('');
      expect(statusOf(root, 'a.txt')).toBe('M  a.txt');
      expect(statusOf(root, 'b.txt')).toBe(' M b.txt');
      expect(statusOf(root, 'c.txt')).toBe('?? c.txt');
    },
    TIMEOUT,
  );

  it(
    'creates a new file when expectedSha is null',
    async () => {
      const file = 'data/chapters/chapter_02.json';
      const result = await store.write(file, HEBREW, 'Add chapter 2', null);
      expect(readFileSync(path.join(root, file), 'utf8')).toBe(HEBREW);
      expect(result.commitSha).toBe(git(root, 'rev-parse', 'HEAD'));
      expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe(file);
      expect(statusOf(root, file)).toBe('');
    },
    TIMEOUT,
  );

  it(
    'refuses with 409 when the file changed, leaving file and HEAD unchanged',
    async () => {
      const head = git(root, 'rev-parse', 'HEAD');
      const err = await rejection(store.write(CHAPTER, '[]\n', 'stale', 'f'.repeat(40)));
      expect(err.status).toBe(409);
      expect(readFileSync(chapterAbs, 'utf8')).toBe(HEBREW);
      expect(git(root, 'rev-parse', 'HEAD')).toBe(head);

      const created = await rejection(store.write(CHAPTER, '[]\n', 'exists', null));
      expect(created.status).toBe(409);
      expect(readFileSync(chapterAbs, 'utf8')).toBe(HEBREW);
    },
    TIMEOUT,
  );

  it(
    'lets only one of two concurrent writes from the same base succeed',
    async () => {
      const base = await gitBlobSha(HEBREW);
      const before = git(root, 'rev-parse', 'HEAD');
      const results = await Promise.allSettled([
        store.write(CHAPTER, '[{"children":[]}]\n', 'first', base),
        store.write(CHAPTER, '[{"children":[{}]}]\n', 'second', base),
      ]);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      const reason = (results[1] as PromiseRejectedResult).reason as StoreError;
      expect(reason.status).toBe(409);
      expect(readFileSync(chapterAbs, 'utf8')).toBe('[{"children":[]}]\n');
      expect(git(root, 'rev-parse', 'HEAD~1')).toBe(before);
    },
    TIMEOUT,
  );

  it(
    'makes no commit when the content is unchanged',
    async () => {
      const head = git(root, 'rev-parse', 'HEAD');
      const sha = await gitBlobSha(HEBREW);
      const result = await store.write(CHAPTER, HEBREW, 'no-op', sha);
      expect(result).toEqual({ commitSha: head, contentSha: sha });
      expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
      expect(statusOf(root, CHAPTER)).toBe('');
    },
    TIMEOUT,
  );

  it('rejects paths outside data/chapters with 400 and writes nothing', async () => {
    const bad = [
      'data/chapters/../x.json',
      '../data/chapters/chapter_01.json',
      'data/chapters/foo.txt',
      'data/chapters/chapter_01.json.bak',
      'data/other/chapter_01.json',
      '/data/chapters/chapter_01.json',
      'data/chapters/sub/chapter_01.json',
    ];
    for (const p of bad) {
      expect((await rejection(store.write(p, '[]\n', 'bad', null))).status).toBe(400);
      expect((await rejection(store.currentSha(p))).status).toBe(400);
    }
    expect(existsSync(path.join(root, 'data', 'x.json'))).toBe(false);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it.skipIf(process.platform === 'win32')(
    'restores the file and unstages it when a pre-commit hook fails',
    async () => {
      const hook = path.join(root, '.git', 'hooks', 'pre-commit');
      writeFileSync(hook, '#!/bin/sh\necho "hook says no" >&2\nexit 1\n');
      chmodSync(hook, 0o755);
      const head = git(root, 'rev-parse', 'HEAD');

      const err = await rejection(store.write(CHAPTER, '[]\n', 'blocked', await gitBlobSha(HEBREW)));
      expect(err.status).toBe(500);
      expect(err.message).toContain('git commit failed');
      expect(err.message).toContain('hook says no');
      expect(readFileSync(chapterAbs, 'utf8')).toBe(HEBREW);
      expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
      expect(statusOf(root, CHAPTER)).toBe('');

      const newFile = 'data/chapters/chapter_03.json';
      const err2 = await rejection(store.write(newFile, '[]\n', 'blocked', null));
      expect(err2.status).toBe(500);
      expect(existsSync(path.join(root, newFile))).toBe(false);
      expect(statusOf(root, newFile)).toBe('');
    },
    TIMEOUT,
  );

  describe('with a realign hook', () => {
    const ALIGN_A = 'data/alignments/a.json';
    const ALIGN_B = 'data/alignments/b.json';
    const ALIGN_NEW = 'data/alignments/new.json';
    let calls: string[];

    beforeEach(() => {
      mkdirSync(path.join(root, 'data', 'alignments'), { recursive: true });
      writeFileSync(path.join(root, ALIGN_A), 'a1\n');
      writeFileSync(path.join(root, ALIGN_B), 'b1\n');
      git(root, 'add', '-A');
      git(root, 'commit', '-q', '-m', 'alignments');
      calls = [];
    });

    it(
      'commits the alignment files the hook changed with the chapter',
      async () => {
        store = new GitWorktreeStore(root, {
          realign: async (repoPath) => {
            calls.push(repoPath);
            writeFileSync(path.join(root, ALIGN_A), 'a2\n');
            writeFileSync(path.join(root, ALIGN_NEW), 'new\n');
          },
        });
        await store.write(CHAPTER, '[]\n', 'Update chapter 1', await gitBlobSha(HEBREW));
        expect(calls).toEqual([CHAPTER]);
        expect(git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(
          [ALIGN_A, ALIGN_NEW, CHAPTER].sort(),
        );
        expect(git(root, 'status', '--porcelain')).toBe('');
      },
      TIMEOUT,
    );

    it(
      'leaves alignment files that were already modified out of the commit',
      async () => {
        writeFileSync(path.join(root, ALIGN_B), 'mine\n');
        store = new GitWorktreeStore(root, {
          realign: async () => {
            writeFileSync(path.join(root, ALIGN_A), 'a2\n');
            writeFileSync(path.join(root, ALIGN_B), 'b2\n');
          },
        });
        await store.write(CHAPTER, '[]\n', 'Update chapter 1', await gitBlobSha(HEBREW));
        expect(git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(
          [ALIGN_A, CHAPTER].sort(),
        );
        expect(statusOf(root, ALIGN_B)).toBe(' M data/alignments/b.json');
      },
      TIMEOUT,
    );

    it(
      'commits the chapter alone and discards partial output when the hook fails',
      async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        store = new GitWorktreeStore(root, {
          realign: async () => {
            writeFileSync(path.join(root, ALIGN_A), 'half\n');
            writeFileSync(path.join(root, ALIGN_NEW), 'half\n');
            throw new Error('retimed file is stale');
          },
        });
        try {
          await store.write(CHAPTER, '[]\n', 'Update chapter 1', await gitBlobSha(HEBREW));
          expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe(CHAPTER);
          expect(readFileSync(path.join(root, ALIGN_A), 'utf8')).toBe('a1\n');
          expect(existsSync(path.join(root, ALIGN_NEW))).toBe(false);
          expect(git(root, 'status', '--porcelain')).toBe('');
          expect(warn).toHaveBeenCalledWith(expect.stringContaining('retimed file is stale'));
        } finally {
          warn.mockRestore();
        }
      },
      TIMEOUT,
    );

    it(
      'does not run the hook when the chapter is unchanged',
      async () => {
        store = new GitWorktreeStore(root, { realign: async (p) => void calls.push(p) });
        await store.write(CHAPTER, HEBREW, 'same', await gitBlobSha(HEBREW));
        expect(calls).toEqual([]);
      },
      TIMEOUT,
    );
  });
});
