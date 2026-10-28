import { freshLineId } from './line-id';

/**
 * Where the editor gets fresh ids from. Pure editor code never calls
 * `crypto` directly; it asks an IdSource, so tests can inject a deterministic
 * one (see `sequentialIds` in ./testing.ts).
 */
export interface IdSource {
  /** A fresh in-memory section id. Never persisted. */
  nodeId(): string;
  /**
   * A fresh persisted line id that is not in `taken`. Callers pass every
   * line id in the document (plus any they already handed out), so ids stay
   * unique; corpus-wide uniqueness is checked by the data build.
   */
  lineId(taken: ReadonlySet<string>): string;
}

export const randomIds: IdSource = {
  nodeId: () => crypto.randomUUID(),
  lineId: (taken) => freshLineId(taken),
};
