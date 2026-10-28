/**
 * Stale-save protection. The editor loads chapters from the deployed site,
 * which can lag behind the repository it saves to. It sends the git blob sha
 * of the JSON it loaded (its base version); the save function refuses to
 * overwrite a file whose current sha differs, since that would silently drop
 * newer changes, including line ids minted by an earlier save.
 */

/** The git blob sha (hex SHA-1 of "blob <byte length>\0<bytes>") of UTF-8 text. */
export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header);
  bytes.set(body, header.length);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Why a save based on `baseSha` must be refused, or null to allow it.
 * No base (new content, e.g. pasted text) or no current file: allowed.
 */
export function staleBaseError(baseSha: string | null | undefined, currentSha: string | undefined): string | null {
  if (!baseSha || !currentSha || baseSha === currentSha) return null;
  return (
    'This chapter changed in the repository since this copy was loaded (the site may not have ' +
    'redeployed yet). Reload it before saving; saving now would overwrite those changes and their line ids.'
  );
}
