/**
 * Offline mode: served same-origin by server/local.ts (`yarn offline`), which
 * serves the chapters from the local checkout and commits each save to it.
 * No password: the server only listens on localhost.
 */
export const environment = {
  production: true,
  xmlBaseUrl: '',
  saveApiBaseUrl: '',
  requireAuth: false,
};
