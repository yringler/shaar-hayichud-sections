/**
 * A SaveStore over a local git checkout (offline mode): each save writes
 * data/chapters/<file>.json in the working tree and commits only that file.
 * Node only.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { SaveResult, SaveStore, StoreError } from '../src/save-api/save-store';

const CHAPTER_PATH = /^data\/chapters\/[A-Za-z0-9_-]+\.json$/;
const MAX_BUFFER = 10 * 1024 * 1024;

/** The git blob sha (hex SHA-1 of "blob <byte length>\0<bytes>") of raw bytes. */
export function gitBlobShaOfBytes(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

interface GitOutput {
  stdout: string;
  stderr: string;
}

/** A failed git invocation: exit code (null if git could not be run) and stderr. */
class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number | null,
    readonly stderr: string,
    message: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

function execGit(git: string, args: readonly string[], cwd: string): Promise<GitOutput> {
  return new Promise((resolve, reject) => {
    execFile(git, [...args], { cwd, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        const code = typeof err.code === 'number' ? err.code : null;
        reject(new GitError(args, code, stderr ?? '', err.message));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/** The top-level directory of the git checkout containing `cwd`. */
export async function findRepoRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execGit('git', ['rev-parse', '--show-toplevel'], cwd);
    return path.resolve(stdout.trim());
  } catch (err) {
    const detail = err instanceof GitError ? err.stderr.trim() || err.message : String(err);
    throw new Error(`${cwd} is not inside a git checkout (or git is not installed): ${detail}`);
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export class GitWorktreeStore implements SaveStore {
  /** Serializes writes so compare-and-swap and commit are atomic per process. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly repoRoot: string,
    private readonly git = 'git',
  ) {}

  async currentSha(repoPath: string): Promise<string | null> {
    const bytes = await this.readBytes(this.resolve(repoPath));
    return bytes === null ? null : gitBlobShaOfBytes(bytes);
  }

  async write(repoPath: string, content: string, message: string, expectedSha: string | null): Promise<SaveResult> {
    const abs = this.resolve(repoPath);
    return this.run(() => this.writeLocked(repoPath, abs, content, message, expectedSha));
  }

  private async writeLocked(
    repoPath: string,
    abs: string,
    content: string,
    message: string,
    expectedSha: string | null,
  ): Promise<SaveResult> {
    const prev = await this.readBytes(abs);
    const prevSha = prev === null ? null : gitBlobShaOfBytes(prev);
    if (prevSha !== expectedSha) {
      throw new StoreError(409, 'The chapter changed on disk while saving. Reload it before saving.');
    }

    const bytes = Buffer.from(content, 'utf8');
    const contentSha = gitBlobShaOfBytes(bytes);
    await writeFile(abs, bytes);

    let added = false;
    let committed = false;
    try {
      await this.runGit(['add', '--', repoPath]);
      added = true;

      const head = await this.headSha();
      if (head !== null && (await this.unchangedFromHead(repoPath))) {
        return { commitSha: head, contentSha };
      }

      await this.runGit(['commit', '--only', '-m', message, '--', repoPath]);
      committed = true;
      const { stdout } = await this.runGit(['rev-parse', 'HEAD']);
      return { commitSha: stdout.trim(), contentSha };
    } catch (err) {
      // Once the commit exists, the file on disk is what was committed: keep it.
      if (!committed) await this.rollback(repoPath, abs, prev, added);
      if (err instanceof GitError) {
        throw new StoreError(500, `git ${err.args[0]} failed: ${err.stderr.trim() || err.message}`);
      }
      throw err;
    }
  }

  /** Restore the file's previous bytes and unstage it; rollback errors are ignored. */
  private async rollback(repoPath: string, abs: string, prev: Uint8Array | null, added: boolean): Promise<void> {
    try {
      if (prev === null) await unlink(abs);
      else await writeFile(abs, prev);
    } catch {
      // Best effort.
    }
    if (added) {
      try {
        await this.runGit(['reset', '-q', '--', repoPath]);
      } catch {
        // Best effort (e.g. no HEAD yet).
      }
    }
  }

  /** HEAD's commit sha, or null in a repository without commits. */
  private async headSha(): Promise<string | null> {
    try {
      const { stdout } = await this.runGit(['rev-parse', '--verify', '-q', 'HEAD']);
      return stdout.trim() || null;
    } catch (err) {
      if (err instanceof GitError && err.code === 1) return null;
      throw err;
    }
  }

  /** Whether the staged file equals its HEAD version. */
  private async unchangedFromHead(repoPath: string): Promise<boolean> {
    try {
      await this.runGit(['diff', '--quiet', '--cached', 'HEAD', '--', repoPath]);
      return true;
    } catch (err) {
      if (err instanceof GitError && err.code === 1) return false;
      throw err;
    }
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private runGit(args: readonly string[]): Promise<GitOutput> {
    return execGit(this.git, args, this.repoRoot);
  }

  private resolve(repoPath: string): string {
    if (!CHAPTER_PATH.test(repoPath)) throw new StoreError(400, 'Invalid path');
    const abs = path.resolve(this.repoRoot, repoPath);
    if (path.dirname(abs) !== path.join(path.resolve(this.repoRoot), 'data', 'chapters')) {
      throw new StoreError(400, 'Invalid path');
    }
    return abs;
  }

  private async readBytes(abs: string): Promise<Uint8Array | null> {
    try {
      return await readFile(abs);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}
