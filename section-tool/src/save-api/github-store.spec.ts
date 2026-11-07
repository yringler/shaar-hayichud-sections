import { createGitHubStore } from './github-store';
import { StoreError } from './save-store';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

type Responder = (call: FetchCall) => Response | Promise<Response>;

function fakeFetch(responder: Responder): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call = { url: String(input), init };
    calls.push(call);
    return responder(call);
  };
  return { fetch: impl as typeof fetch, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const cfg = { token: 'tok', owner: 'own', repo: 'rep' };
const PATH = 'data/chapters/chapter_01.json';
const URL_ = 'https://api.github.com/repos/own/rep/contents/data/chapters/chapter_01.json';

async function storeError(p: Promise<unknown>): Promise<StoreError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(StoreError);
    return e as StoreError;
  }
  throw new Error('expected a StoreError');
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

describe('createGitHubStore', () => {
  describe('currentSha', () => {
    it('returns the sha on 200 and sends the GitHub headers', async () => {
      const f = fakeFetch(() => jsonResponse(200, { sha: 'abc' }));
      expect(await createGitHubStore(cfg, f.fetch).currentSha(PATH)).toBe('abc');
      expect(f.calls[0].url).toBe(URL_);
      const headers = f.calls[0].init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer tok');
      expect(headers['User-Agent']).toBe('section-tool-editor');
      expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
      expect(headers['Accept']).toBe('application/vnd.github+json');
    });

    it('returns null on 404', async () => {
      const f = fakeFetch(() => jsonResponse(404, { message: 'Not Found' }));
      expect(await createGitHubStore(cfg, f.fetch).currentSha(PATH)).toBeNull();
    });

    it('passes other statuses through with the GitHub message', async () => {
      const f = fakeFetch(() => jsonResponse(500, { message: 'Server broke' }));
      const e = await storeError(createGitHubStore(cfg, f.fetch).currentSha(PATH));
      expect([e.status, e.message]).toEqual([500, 'Server broke']);
    });

    it('falls back to a generic message', async () => {
      const f = fakeFetch(() => jsonResponse(403, {}));
      const e = await storeError(createGitHubStore(cfg, f.fetch).currentSha(PATH));
      expect([e.status, e.message]).toEqual([403, 'GitHub API error']);
    });

    it('answers 502 when GitHub is unreachable', async () => {
      const f = fakeFetch(() => {
        throw new TypeError('network down');
      });
      const e = await storeError(createGitHubStore(cfg, f.fetch).currentSha(PATH));
      expect([e.status, e.message]).toEqual([502, 'Failed to reach GitHub API']);
    });
  });

  describe('write', () => {
    const okPut = () => jsonResponse(201, { commit: { sha: 'c1' }, content: { sha: 'b1' } });

    it('PUTs base64 UTF-8 content with the expected sha', async () => {
      const f = fakeFetch(okPut);
      const content = '[{"children":[{"id":"abcdefgh","text":"בראשית"}]}]';
      const result = await createGitHubStore(cfg, f.fetch).write(PATH, content, 'msg', 'old');
      expect(result).toEqual({ commitSha: 'c1', contentSha: 'b1' });
      expect(f.calls[0].url).toBe(URL_);
      expect(f.calls[0].init?.method).toBe('PUT');
      expect((f.calls[0].init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
      const body = JSON.parse(String(f.calls[0].init?.body)) as Record<string, string>;
      expect(body['message']).toBe('msg');
      expect(body['sha']).toBe('old');
      expect(decodeBase64Utf8(body['content'])).toBe(content);
    });

    it('omits sha for a new file', async () => {
      const f = fakeFetch(okPut);
      await createGitHubStore(cfg, f.fetch).write(PATH, 'x', 'msg', null);
      const body = JSON.parse(String(f.calls[0].init?.body)) as Record<string, string>;
      expect('sha' in body).toBe(false);
    });

    it('maps a missing commit to an empty commitSha', async () => {
      const f = fakeFetch(() => jsonResponse(200, {}));
      expect(await createGitHubStore(cfg, f.fetch).write(PATH, 'x', 'm', null)).toEqual({
        commitSha: '',
        contentSha: undefined,
      });
    });

    it('passes error statuses through', async () => {
      const f = fakeFetch(() => jsonResponse(409, { message: 'sha does not match' }));
      const e = await storeError(createGitHubStore(cfg, f.fetch).write(PATH, 'x', 'm', 'old'));
      expect([e.status, e.message]).toEqual([409, 'sha does not match']);
      const f2 = fakeFetch(() => jsonResponse(422, {}));
      const e2 = await storeError(createGitHubStore(cfg, f2.fetch).write(PATH, 'x', 'm', 'old'));
      expect([e2.status, e2.message]).toEqual([422, 'GitHub API error']);
    });

    it('answers 502 when GitHub is unreachable or answers non-JSON', async () => {
      const f = fakeFetch(() => {
        throw new TypeError('down');
      });
      expect((await storeError(createGitHubStore(cfg, f.fetch).write(PATH, 'x', 'm', null))).status).toBe(502);
      const f2 = fakeFetch(() => new Response('<html>', { status: 502 }));
      expect((await storeError(createGitHubStore(cfg, f2.fetch).write(PATH, 'x', 'm', null))).status).toBe(502);
    });
  });
});
