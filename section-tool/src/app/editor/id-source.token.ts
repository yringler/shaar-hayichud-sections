import { InjectionToken } from '@angular/core';
import { IdSource, randomIds } from './ids';

/**
 * The id source `EditorService` uses. Defaults to random UUIDs; tests
 * override it with `provideSequentialIds()` from ./testing.ts.
 */
export const ID_SOURCE = new InjectionToken<IdSource>('ID_SOURCE', {
  providedIn: 'root',
  factory: () => randomIds,
});
