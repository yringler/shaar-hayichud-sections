/**
 * Where the editor gets fresh ids from. Pure editor code never calls
 * `crypto` directly; it asks an IdSource, so tests can inject a deterministic
 * one (see `sequentialIds` in ./testing.ts).
 */
export interface IdSource {
  /** A fresh in-memory section id. Never persisted. */
  nodeId(): string;
}

export const randomIds: IdSource = {
  nodeId: () => crypto.randomUUID(),
};
