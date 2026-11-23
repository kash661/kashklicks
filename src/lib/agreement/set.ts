// The set of finished documents of one booking: a pool of exact JSON text fragments plus one index list
// per mix. No data imports: the page script imports this file too, and rebuilds a mix's text the same way.
import type { Choice } from './types';

/** The id of a mix: the sharing choice, then `+id` for every ticked extra. The extras are already in tick box order. */
export const mixId = (choice: Choice, extras: readonly string[]): string => [choice, ...extras].join('+');

/**
 * doc_json of one mix: pool[f[0]] + f.slice(1, -1).map(i => pool[i]).join(',') + pool[f[f.length - 1]].
 * f is [head, every section in document order, tail]. An index list that does not fit the pool throws.
 */
export function docJsonFromSet(pool: readonly string[], f: readonly number[]): string {
  if (!Array.isArray(f) || f.length < 2) throw new Error('a mix needs a head and a tail');
  for (const i of f)
    if (!Number.isInteger(i) || i < 0 || i >= pool.length || typeof pool[i] !== 'string') throw new Error(`no fragment ${String(i)} in the pool`);
  return (
    pool[f[0]] +
    f
      .slice(1, -1)
      .map((i) => pool[i])
      .join(',') +
    pool[f[f.length - 1]]
  );
}
