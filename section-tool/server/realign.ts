/**
 * The offline editor's re-alignment hook: after a chapter save, runs
 * data/tools' `yarn align --chapter <key>` (its compiled CLI) so the class
 * alignments of that chapter follow the new line ids, and the save commit
 * carries them. Node only.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { Realign } from './git-worktree-store';

const CHAPTER_FILE = /^data\/chapters\/(chapter_\d+)\.json$/;
const MAX_BUFFER = 10 * 1024 * 1024;

function run(cmd: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, [...args], { cwd, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (err, _stdout, stderr) => {
      if (err) reject(new Error((stderr ?? '').trim() || err.message));
      else resolve();
    });
  });
}

/** The chapter key ("chapter_18") of a chapter file's repo path, or null for other files. */
export function chapterKeyOf(repoPath: string): string | null {
  return CHAPTER_FILE.exec(repoPath)?.[1] ?? null;
}

/**
 * Compiles data/tools once and returns the hook, or null (with the reason)
 * when data/tools is not installed or does not compile: saving then works
 * as before, without re-alignment.
 */
export async function createRealign(repoRoot: string): Promise<{ realign: Realign } | { reason: string }> {
  const toolsDir = path.join(repoRoot, 'data', 'tools');
  const tsc = path.join(toolsDir, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) {
    return { reason: `data/tools is not installed (run "yarn install" in ${toolsDir})` };
  }
  try {
    await run(process.execPath, [tsc, '-p', 'tsconfig.json'], toolsDir);
  } catch (err) {
    return { reason: `data/tools does not compile: ${err instanceof Error ? err.message : String(err)}` };
  }
  const cli = path.join(toolsDir, 'build', 'cli', 'align.js');
  return {
    realign: async (repoPath) => {
      const key = chapterKeyOf(repoPath);
      if (key === null) return;
      await run(process.execPath, [cli, '--chapter', key], toolsDir);
    },
  };
}
