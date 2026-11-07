import { HandleSaveOptions, handleSave, resolveChapterPath } from './handle-save';
import { SaveResult, SaveStore, StoreError } from './save-store';

const VALID = JSON.stringify([{ children: [{ id: 'abcdefgh', text: 'שלום' }] }]);

interface WriteCall {
  repoPath: string;
  content: string;
  message: string;
  expectedSha: string | null;
}

class FakeStore implements SaveStore {
  readonly shaCalls: string[] = [];
  readonly writes: WriteCall[] = [];
  current: string | null = 'cur';
  result: SaveResult = { commitSha: 'commit1', contentSha: 'blob1' };
  failCurrent: unknown = null;
  failWrite: unknown = null;

  async currentSha(repoPath: string): Promise<string | null> {
    this.shaCalls.push(repoPath);
    if (this.failCurrent) throw this.failCurrent;
    return this.current;
  }

  async write(repoPath: string, content: string, message: string, expectedSha: string | null): Promise<SaveResult> {
    this.writes.push({ repoPath, content, message, expectedSha });
    if (this.failWrite) throw this.failWrite;
    return this.result;
  }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const good = { path: 'data/chapters/chapter_01.json', content: VALID, message: 'Save chapter 1' };
const noAuth: HandleSaveOptions = { apiSecret: null };

async function call(
  request: Request,
  store: SaveStore,
  options: HandleSaveOptions = noAuth,
): Promise<{ status: number; body: Record<string, unknown>; res: Response }> {
  const res = await handleSave(request, store, options);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, res };
}

describe('resolveChapterPath', () => {
  it('accepts data/chapters and the legacy hugo/chapters prefix', () => {
    expect(resolveChapterPath('data/chapters/chapter_01.json')).toBe('data/chapters/chapter_01.json');
    expect(resolveChapterPath('hugo/chapters/chapter_07.json')).toBe('data/chapters/chapter_07.json');
  });
});

describe('handleSave', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  describe('auth', () => {
    const opts: HandleSaveOptions = { apiSecret: 's', headers: { 'X-Cors': 'yes' } };

    it.each([
      ['no header', {}],
      ['wrong token', { Authorization: 'Bearer nope' }],
      ['bare Bearer', { Authorization: 'Bearer ' }],
      ['no Bearer prefix', { Authorization: 's' }],
    ])('rejects %s with 401 and the extra headers', async (_name, headers) => {
      const { status, body, res } = await call(post(good, headers), store, opts);
      expect(status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
      expect(res.headers.get('X-Cors')).toBe('yes');
      expect(res.headers.get('Content-Type')).toBe('application/json');
      expect(store.shaCalls).toEqual([]);
    });

    it('accepts the right token and adds the headers on 200', async () => {
      const { status, res } = await call(post(good, { Authorization: 'Bearer s' }), store, opts);
      expect(status).toBe(200);
      expect(res.headers.get('X-Cors')).toBe('yes');
    });

    it("rejects everything when the secret is ''", async () => {
      for (const auth of ['', 'Bearer ', 'Bearer x']) {
        const headers: Record<string, string> = auth ? { Authorization: auth } : {};
        const { status } = await call(post(good, headers), store, { apiSecret: '' });
        expect(status).toBe(401);
      }
      expect(store.writes).toEqual([]);
    });

    it('needs no Authorization when apiSecret is null', async () => {
      const { status } = await call(post(good), store, noAuth);
      expect(status).toBe(200);
    });
  });

  it('answers 405 to GET', async () => {
    const { status, body } = await call(new Request('http://localhost/api/save'), store);
    expect(status).toBe(405);
    expect(body).toEqual({ error: 'Method not allowed' });
  });

  describe('validation (store never called)', () => {
    afterEach(() => {
      expect(store.shaCalls).toEqual([]);
      expect(store.writes).toEqual([]);
    });

    it('rejects invalid JSON', async () => {
      const { status, body } = await call(post('{nope'), store);
      expect(status).toBe(400);
      expect(body).toEqual({ error: 'Invalid JSON body' });
    });

    it.each([
      ['missing path', { content: VALID, message: 'm' }],
      ['empty content', { ...good, content: '' }],
      ['empty message', { ...good, message: '' }],
      ['non-string path', { ...good, path: 1 }],
      ['non-string content', { ...good, content: [] }],
      ['null body', null],
      ['array body', []],
    ])('rejects %s', async (_name, payload) => {
      const { status, body } = await call(post(payload), store);
      expect(status).toBe(400);
      expect(body).toEqual({ error: 'Missing required fields: path, content, message' });
    });

    it('rejects a non-string baseSha', async () => {
      const { status } = await call(post({ ...good, baseSha: 5 }), store);
      expect(status).toBe(400);
    });

    it.each([
      'data/chapters/../x.json',
      '../data/chapters/chapter_01.json',
      'data/chapters/foo.json',
      'data/chapters/chapter_01.json.bak',
      'data/other/chapter_01.json',
      '/data/chapters/chapter_01.json',
    ])('rejects path %s', async (path) => {
      const { status, body } = await call(post({ ...good, path }), store);
      expect(status).toBe(400);
      expect(body).toEqual({ error: 'Invalid path: expected data/chapters/chapter_NN.json' });
    });

    it('rejects invalid chapter content', async () => {
      const { status, body } = await call(post({ ...good, content: JSON.stringify([{ children: ['x'] }]) }), store);
      expect(status).toBe(400);
      expect(String(body['error'])).toMatch(/^Invalid chapter content: \/0\/children\/0: text must be a line object/);
    });
  });

  it('maps the legacy hugo/chapters path', async () => {
    await call(post({ ...good, path: 'hugo/chapters/chapter_03.json' }), store);
    expect(store.shaCalls).toEqual(['data/chapters/chapter_03.json']);
    expect(store.writes[0].repoPath).toBe('data/chapters/chapter_03.json');
  });

  it('answers 409 when baseSha differs from the current sha, without writing', async () => {
    const { status, body } = await call(post({ ...good, baseSha: 'old' }), store);
    expect(status).toBe(409);
    expect(String(body['error'])).toContain('Reload it before saving');
    expect(store.writes).toEqual([]);
  });

  it.each([
    ['no baseSha', undefined, 'cur'],
    ['no current file', 'old', null],
    ['equal shas', 'cur', 'cur'],
  ])('allows %s', async (_name, baseSha, current) => {
    store.current = current;
    const { status } = await call(post({ ...good, baseSha }), store);
    expect(status).toBe(200);
    expect(store.writes).toEqual([
      { repoPath: 'data/chapters/chapter_01.json', content: VALID, message: 'Save chapter 1', expectedSha: current },
    ]);
  });

  it('answers 200 with the store result', async () => {
    const { status, body, res } = await call(post(good), store);
    expect(status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(body).toEqual({ commitSha: 'commit1', contentSha: 'blob1' });
  });

  it('answers a StoreError with its status', async () => {
    store.failWrite = new StoreError(422, 'Unprocessable');
    const { status, body } = await call(post(good), store);
    expect(status).toBe(422);
    expect(body).toEqual({ error: 'Unprocessable' });
  });

  it('answers a StoreError from currentSha with its status', async () => {
    store.failCurrent = new StoreError(502, 'Failed to reach GitHub API');
    const { status, body } = await call(post(good), store);
    expect(status).toBe(502);
    expect(body).toEqual({ error: 'Failed to reach GitHub API' });
    expect(store.writes).toEqual([]);
  });

  it('answers any other error with 500', async () => {
    store.failWrite = new Error('boom');
    expect(await call(post(good), store)).toMatchObject({ status: 500, body: { error: 'boom' } });
    store.failWrite = new Error('');
    expect(await call(post(good), store)).toMatchObject({ status: 500, body: { error: 'Save failed' } });
  });
});
