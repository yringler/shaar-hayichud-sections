import { SaveResult, SaveStore, StoreError } from './save-store';

export interface GitHubStoreConfig {
  token: string;
  owner: string;
  repo: string;
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (b) => String.fromCodePoint(b)).join('');
  return btoa(binString);
}

/**
 * A SaveStore over the GitHub contents API: each write is one commit on the
 * default branch. GitHub does the compare-and-swap itself (the PUT carries the
 * sha being replaced) and its error statuses are passed through.
 *
 * The default fetch is wrapped in an arrow: calling a detached `fetch` throws
 * "Illegal invocation" in Workers.
 */
export function createGitHubStore(
  cfg: GitHubStoreConfig,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): SaveStore {
  const githubHeaders: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'section-tool-editor',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const apiUrl = (repoPath: string) => `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${repoPath}`;
  const unreachable = () => new StoreError(502, 'Failed to reach GitHub API');

  return {
    async currentSha(repoPath: string): Promise<string | null> {
      try {
        const response = await fetchImpl(apiUrl(repoPath), { headers: githubHeaders });
        if (response.ok) {
          const fileData = (await response.json()) as { sha: string };
          return fileData.sha;
        }
        if (response.status === 404) return null;
        const errorData = (await response.json()) as { message?: string };
        throw new StoreError(response.status, errorData.message || 'GitHub API error');
      } catch (e) {
        if (e instanceof StoreError) throw e;
        throw unreachable();
      }
    },

    async write(repoPath: string, content: string, message: string, expectedSha: string | null): Promise<SaveResult> {
      const putBody: { message: string; content: string; sha?: string } = {
        message,
        content: utf8ToBase64(content),
      };
      if (expectedSha) {
        putBody.sha = expectedSha;
      }
      try {
        const response = await fetchImpl(apiUrl(repoPath), {
          method: 'PUT',
          headers: githubHeaders,
          body: JSON.stringify(putBody),
        });
        const putData = (await response.json()) as {
          commit?: { sha: string };
          content?: { sha: string };
          message?: string;
        };
        if (!response.ok) {
          throw new StoreError(response.status, putData.message || 'GitHub API error');
        }
        return { commitSha: putData.commit?.sha ?? '', contentSha: putData.content?.sha };
      } catch (e) {
        if (e instanceof StoreError) throw e;
        throw unreachable();
      }
    },
  };
}
