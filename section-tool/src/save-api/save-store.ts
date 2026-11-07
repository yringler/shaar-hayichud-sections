/** Result of a committed save; mirrors the HTTP response body. */
export interface SaveResult {
  commitSha: string;
  contentSha?: string;
}

/**
 * Where chapter files are read from and committed to. Paths are repo-relative
 * and already validated ("data/chapters/chapter_NN.json").
 */
export interface SaveStore {
  /** Git blob sha of the file's current bytes, or null if it does not exist. */
  currentSha(repoPath: string): Promise<string | null>;
  /**
   * Write `content` (UTF-8) and commit it with `message`. Compare-and-swap:
   * fail with StoreError(409) if the file's sha is no longer `expectedSha`
   * (null = the file must not exist).
   */
  write(repoPath: string, content: string, message: string, expectedSha: string | null): Promise<SaveResult>;
}

/** A store failure with the HTTP status handleSave should answer with. */
export class StoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}
