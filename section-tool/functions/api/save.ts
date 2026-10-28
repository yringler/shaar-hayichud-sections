/// <reference types="@cloudflare/workers-types" />
import { checkChapterJson } from '../../src/app/editor/chapter-check';
import { staleBaseError } from '../../src/app/services/base-version';

interface Env {
  API_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  ALLOWED_ORIGIN: string;
}

interface SaveRequest {
  path: string;
  content: string;
  message: string;
  /**
   * Git blob sha of the JSON the editor loaded. When given, the save is
   * refused (409) if the file has changed since; see base-version.ts.
   */
  baseSha?: string;
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (b) => String.fromCodePoint(b)).join('');
  return btoa(binString);
}

/**
 * Chapter files live in the monorepo's data/chapters/ (the single source of
 * truth that the site and the published /data/v1/ JSON are built from).
 * Only chapter files may be written. The pre-move client path
 * 'hugo/chapters/<file>' is still accepted for editors running a cached build.
 */
function resolveChapterPath(path: string): string | null {
  const m = /^(?:data\/chapters|hugo\/chapters)\/(chapter_\d+\.json)$/.exec(path);
  return m ? `data/chapters/${m[1]}` : null;
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

export const onRequestOptions: PagesFunction<Env> = async ({ env }) => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(env),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const cors = corsHeaders(env);

  // Auth check
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || token !== env.API_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  // Parse body
  let body: SaveRequest;
  try {
    body = (await request.json()) as SaveRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const { path, content, message, baseSha } = body;
  if (!path || !content || !message) {
    return new Response(JSON.stringify({ error: 'Missing required fields: path, content, message' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const repoPath = resolveChapterPath(path);
  if (!repoPath) {
    return new Response(
      JSON.stringify({ error: 'Invalid path: expected data/chapters/chapter_NN.json' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
  // Cheap structural check (line objects with valid, unique ids); the data
  // build does the full schema and corpus-wide checks.
  const problems = checkChapterJson(content);
  if (problems.length > 0) {
    return new Response(
      JSON.stringify({ error: `Invalid chapter content: ${problems.join('; ')}` }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const apiUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${repoPath}`;
  const githubHeaders = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'section-tool-editor',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // GET current file to retrieve SHA
  let sha: string | undefined;
  try {
    const getResponse = await fetch(apiUrl, { headers: githubHeaders });
    if (getResponse.ok) {
      const fileData = (await getResponse.json()) as { sha: string };
      sha = fileData.sha;
    } else if (getResponse.status !== 404) {
      const errorData = (await getResponse.json()) as { message?: string };
      return new Response(
        JSON.stringify({ error: errorData.message || 'GitHub API error' }),
        { status: getResponse.status, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to reach GitHub API' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const stale = staleBaseError(baseSha, sha);
  if (stale) {
    return new Response(JSON.stringify({ error: stale }), {
      status: 409,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  // PUT updated content
  const putBody: { message: string; content: string; sha?: string } = {
    message,
    content: utf8ToBase64(content),
  };
  if (sha) {
    putBody.sha = sha;
  }

  try {
    const putResponse = await fetch(apiUrl, {
      method: 'PUT',
      headers: githubHeaders,
      body: JSON.stringify(putBody),
    });

    const putData = (await putResponse.json()) as {
      commit?: { sha: string };
      content?: { sha: string };
      message?: string;
    };

    if (!putResponse.ok) {
      return new Response(
        JSON.stringify({ error: putData.message || 'GitHub API error' }),
        { status: putResponse.status, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    return new Response(
      JSON.stringify({ commitSha: putData.commit?.sha, contentSha: putData.content?.sha }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to reach GitHub API' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
};
