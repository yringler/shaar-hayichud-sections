/**
 * Offline mode entry point: `yarn serve:offline [--port <n>] [--dist <dir>]`.
 * Serves the offline Angular build and saves chapters into the local checkout
 * of the repository containing the working directory, one local commit per
 * save. Each save also re-aligns the class transcripts of the saved chapter
 * (data/tools `yarn align --chapter`) and commits the changed
 * data/alignments/ files with it. Pushing is left to the user.
 */
import { existsSync, statSync } from 'node:fs';
import * as path from 'node:path';

import { findRepoRoot, GitWorktreeStore } from './git-worktree-store';
import { createLocalServer } from './local-server';
import { createRealign } from './realign';

const DEFAULT_PORT = 4300;

interface CliOptions {
  port: number;
  distDir: string;
}

/** The value of `--name <v>` or `--name=<v>`, or undefined. */
function flag(args: readonly string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === `--${name}`) {
      const value = args[i + 1];
      if (value === undefined) throw new Error(`--${name} needs a value`);
      return value;
    }
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return undefined;
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port "${raw}": expected a number from 1 to 65535`);
  }
  return port;
}

function parseArgs(args: readonly string[]): CliOptions {
  const portArg = flag(args, 'port') ?? process.env['PORT'];
  const port = portArg === undefined || portArg === '' ? DEFAULT_PORT : parsePort(portArg);
  const dist = flag(args, 'dist');
  const distDir = dist ? path.resolve(dist) : path.resolve(process.cwd(), 'dist/offline/browser');
  return { port, distDir };
}

async function main(): Promise<void> {
  const { port, distDir } = parseArgs(process.argv.slice(2));

  if (!existsSync(path.join(distDir, 'index.html'))) {
    console.error(`No offline build at ${distDir}. Run "yarn offline" (or "yarn build:offline").`);
    process.exit(1);
  }

  const repoRoot = await findRepoRoot(process.cwd());
  const chaptersDir = path.join(repoRoot, 'data', 'chapters');
  if (!existsSync(chaptersDir) || !statSync(chaptersDir).isDirectory()) {
    throw new Error(`No data/chapters/ directory in ${repoRoot}`);
  }

  const hook = await createRealign(repoRoot);
  if ('reason' in hook) console.warn(`Saves will not re-align class transcripts: ${hook.reason}`);
  const store = new GitWorktreeStore(repoRoot, { realign: 'realign' in hook ? hook.realign : undefined });
  const server = createLocalServer({ distDir, chaptersDir, store });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use; try --port <n>`);
    } else {
      console.error(err.message);
    }
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Section tool (offline): http://localhost:${port}/`);
    console.log(`Saves write data/chapters/ in ${repoRoot} and commit locally. Push yourself.`);
    if ('realign' in hook) console.log('Each save re-aligns that chapter\'s classes into the same commit.');
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
