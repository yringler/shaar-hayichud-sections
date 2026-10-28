import { InjectionToken } from '@angular/core';
import { IdSource, randomIds } from './ids';

/**
 * The id source `TextSectionService` uses. Defaults to `randomIds` (random
 * UUIDs for in-memory section ids, random base32 line ids); tests override
 * it with `provideSequentialIds()` from ./testing.ts.
 */
export const ID_SOURCE = new InjectionToken<IdSource>('ID_SOURCE', {
  providedIn: 'root',
  factory: () => randomIds,
});
