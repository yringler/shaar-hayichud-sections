/// <reference types="@cloudflare/workers-types" />
import { createGitHubStore } from '../../src/save-api/github-store';
import { handleSave } from '../../src/save-api/handle-save';

/**
 * POST /api/save: commits a chapter file to GitHub. All validation, the
 * stale-base check and the response shape live in src/save-api/handle-save.ts,
 * shared with the offline server (server/local.ts).
 */

interface Env {
  API_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  ALLOWED_ORIGIN: string;
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

export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  handleSave(
    request,
    createGitHubStore({ token: env.GITHUB_TOKEN, owner: env.GITHUB_OWNER, repo: env.GITHUB_REPO }),
    // `?? ''`: an unset secret must reject every request, never disable auth.
    { apiSecret: env.API_SECRET ?? '', headers: corsHeaders(env) },
  );
