/**
 * marquee.mjs
 * -----------
 * Shared helpers for the marquee letter rental. One data source feeds the
 * page, its schema, the visible FAQ and llms.txt, so a price or a town is
 * changed in exactly one place:
 *
 *   src/data/packages.json   the packages, category "Marquee Letters"
 *   src/data/add-ons.json    the extras, categories ["Marquee Letters"]
 *   src/data/marquee.json    free delivery zone, ask first towns, pickup time
 *   src/data/faq.json        questions tagged services ["marquee-letters"]
 *
 * FAQ answers carry tokens instead of numbers, filled at build time:
 *   {price:<package or add-on id>}   e.g. {price:marquee-love} gives $381.25
 *   {minPrice}                       the smallest package price
 *   {freeZone} {torontoAreas} {askFirst} {pickupBy}
 *   {askFirstExamples}               a few ask first towns, joined with "or"
 * An unknown token fails the build rather than shipping a gap, and so does an
 * example town that is no longer in the ask first list.
 *
 * Plain ES module (no TypeScript) so scripts/generate-ai-files.mjs can import
 * it in Node without a build step. It takes data as arguments and imports
 * nothing, so both callers pass the JSON they already loaded.
 */

export const MARQUEE_CATEGORY = 'Marquee Letters';
export const MARQUEE_SERVICE = 'marquee-letters';

/** "$251.25", always two decimals, as every KashKlicks price ends in .25. */
export const money = (n) =>
  `$${Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** ["a", "b", "c"] gives "a, b and c", or "a, b or c" with word "or". No serial comma, matching the page copy. */
export const listJoin = (items, word = 'and') =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`;

/**
 * Everything the marquee copy needs, resolved once.
 * @param {{ packages: any[], addOns: any[], zone: { freeZone: string[], torontoAreas: string[], askFirst: string[], askFirstExamples?: string[], pickupBy: string } }} data
 */
export function marqueeContext({ packages, addOns, zone }) {
  const pkgs = packages
    .filter((p) => p.category === MARQUEE_CATEGORY)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const extras = addOns.filter((a) => Array.isArray(a.categories) && a.categories.includes(MARQUEE_CATEGORY));
  const priceOf = new Map([...pkgs.map((p) => [p.id, p.price]), ...extras.map((a) => [a.id, a.price])]);
  const prices = pkgs.map((p) => p.price).filter((n) => typeof n === 'number');
  return {
    packages: pkgs,
    extras,
    zone,
    priceOf,
    minPrice: prices.length ? Math.min(...prices) : null,
  };
}

const TOKEN = /\{([a-zA-Z]+(?::[a-z0-9-]+)?)\}/g;

/**
 * Fill the FAQ tokens. Throws on a token it does not know, or a price id that
 * has no number, so a typo in faq.json can never reach the page.
 * @param {string} text
 * @param {ReturnType<typeof marqueeContext>} ctx
 */
export function fillTokens(text, ctx) {
  return String(text).replace(TOKEN, (match, key) => {
    if (key.startsWith('price:')) {
      const value = ctx.priceOf.get(key.slice('price:'.length));
      if (typeof value !== 'number') throw new Error(`marquee: no price for token ${match}`);
      return money(value);
    }
    switch (key) {
      case 'minPrice':
        if (typeof ctx.minPrice !== 'number') throw new Error('marquee: no package prices for {minPrice}');
        return money(ctx.minPrice);
      case 'freeZone':
        return listJoin(ctx.zone.freeZone);
      case 'torontoAreas':
        return listJoin(ctx.zone.torontoAreas);
      case 'askFirst':
        return listJoin(ctx.zone.askFirst);
      case 'askFirstExamples': {
        // A town moved into the free zone must not stay named as "past the zone".
        const examples = ctx.zone.askFirstExamples ?? [];
        const stray = examples.filter((town) => !ctx.zone.askFirst.includes(town));
        if (!examples.length || stray.length) {
          throw new Error(
            `marquee: askFirstExamples must list towns from askFirst (${stray.join(', ') || 'none set'})`
          );
        }
        return listJoin(examples, 'or');
      }
      case 'pickupBy':
        return ctx.zone.pickupBy;
      default:
        throw new Error(`marquee: unknown token ${match}`);
    }
  });
}

/**
 * The FAQ as the page shows it and FAQPage schema states it, tokens filled.
 * @param {Array<{question: string, answer: string, services?: string[]}>} faq
 * @param {ReturnType<typeof marqueeContext>} ctx
 */
export function marqueeFaq(faq, ctx) {
  return faq
    .filter((q) => Array.isArray(q.services) && q.services.includes(MARQUEE_SERVICE))
    .map((q) => ({ question: fillTokens(q.question, ctx), answer: fillTokens(q.answer, ctx) }));
}
