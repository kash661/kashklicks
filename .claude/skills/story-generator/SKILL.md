---
name: story-generator
description: "Generate editorial story copy for a portfolio gallery — headline, body, pull quote, location description, and SEO meta description. Use when the user says 'write the story', 'generate copy', 'write the gallery text', 'write the about section', or when image-selector completes and triggers this skill automatically."
---

# Story Generator

## Output Rule

Write the copy. Don't explain what you're doing. No commentary, no options presented, no "here's a draft." Write it once, write it well, save it. Output one confirmation line when done.

## What This Skill Produces

Four pieces of copy, all written in one pass:

1. **`story.headline`** — the gallery headline (4-7 words)
2. **`story.body`** — 2-paragraph editorial narrative (Akash's first-person voice)
3. **`story.pullQuote`** — a believable client quote
4. **`locationDescription`** — sidebar location context (SEO-optimized)
5. **`pageDescription`** — meta description for the portfolio detail page (SEO)

Items 1-3 go into `portfolio.json` under the `story` object. Item 4 updates `locationDescription` in the same entry. Item 5 is used by `[slug].astro` as the page meta description — update it in the JSON entry as a `metaDescription` field if it exists, or note it in the selection report for the frontend agent.

---

## Inputs

Read these before writing anything:

- The selected images in `src/assets/images/portfolio/{slug}/` — look at them visually
- The portfolio.json entry for this slug (couple, location, category, date, tags)
- The selection report at `docs/image-selection-{slug}.md` — use the concept/description column to understand what moments were captured
- `docs/seo/keyword-map.md` — read this every run. The portfolio detail page targets the keywords listed under `/portfolio/pre-weddings`, `/portfolio/weddings`, or whichever category matches the session. These are the terms to work into the copy naturally.

---

## Voice and Tone

Akash's writing voice is warm, personal, grounded, and cinematic. It reads like a photographer talking to a friend about a session they loved, not a brand writing a testimonial page.

**Always:**
- First person ("We spent the first hour at...", "That's the image that defines this gallery for me.")
- Reference specific visible moments from the images (a gesture, the light, a location detail)
- Let emotion come through action, not adjectives ("she looked at him and the whole frame came alive" not "it was such a beautiful moment")
- Ground it in place — Toronto locations are characters in the story, not just backdrops
- End the body with a single sentence that lands with weight

**Never:**
- Em dashes or en dashes — use commas, periods, or rewrite the sentence
- "Stunning", "breathtaking", "magical", "incredible", "beautiful" as standalone descriptors
- Corporate language ("we are committed to", "our team")
- Passive voice ("photos were taken" → "I shot")
- Filler openers ("On a warm September evening..." "It was a perfect day...")
- Mentioning the camera, gear, or technical process

---

## SEO Rules (baked into every piece of copy)

The story copy doubles as SEO content. Read `docs/seo/keyword-map.md` before writing. Apply the relevant keywords without the reader noticing.

### Keyword targeting by session type

Match the session's `category` field to the keyword-map row, then use those keywords as natural inclusions:

| Session type | Primary keyword to include | Secondary to weave in |
|---|---|---|
| `pre-wedding` | "Toronto pre-wedding photography" | "engagement photographer Toronto", "pre-wedding shoot GTA" |
| `wedding` | "Toronto wedding photographer" | "wedding photography GTA", "wedding day photos Toronto" |
| `civil-ceremony` | "civil ceremony photographer Toronto" | "courthouse wedding photos Toronto" |
| `events` | "Toronto event photographer" | "celebration photography" |
| `portraits` | "Toronto portrait photographer" | "professional portraits GTA" |

Also pull from the **Keyword Gaps** section of the keyword map — if the session is relevant to a gap keyword (e.g. a winter session → "winter engagement photos Toronto"), work it into the locationDescription or body. These are unranked terms actively being targeted.

For venue-specific long-tails not in the keyword map, construct them as: `[full venue name] [session type] photography` and `[venue name] Toronto photographer`. These drive hyper-local discovery.

### locationDescription (sidebar, ~80-120 words)

Structure:
- Sentence 1: Name the location by its full, common-search name
- Sentence 2: What makes it visually distinctive for photography
- Sentence 3: The specific light or architectural detail that makes it work
- Sentence 4 (optional): Connect to the broader Toronto/GTA photography scene

Embed the venue-specific long-tail naturally in sentence 1 or 2. One keyword inclusion is enough — this isn't a keyword dump.

Match the quality of existing entries already on the site:
> "The RC Harris Water Treatment Plant is one of Toronto's most stunning Art Deco landmarks, perched right on the shores of Lake Ontario in Scarborough. Its towering columns, symmetrical facades, and sweeping lakefront views make it a dream location for pre-wedding photography. During golden hour, the warm light bounces off the stone and water in a way that feels almost cinematic. It's no wonder this spot has become one of the GTA's most sought-after shoot locations."

### story.body (gallery narrative, ~200-280 words across 2 paragraphs)

- Paragraph 1: Set the scene, name the locations, describe the session's energy
- Paragraph 2: Zero in on 1-2 specific moments visible in the images. End with the frame that defines the gallery.
- Include the primary keyword for the session type once, naturally, in paragraph 1
- Include the location name + city at least once across both paragraphs
- One or two keyword inclusions total. Never more.

### pageDescription (meta description, exactly 150-160 characters)

Format: `[Session type] photography of [Couple] at [Location]. View the full gallery by KashKlicks Studios, [city] [session type] photographer.`

Example: `Pre-wedding photography of Ayushi + Parth at Toronto Harbour, RC Harris & Guild Park. View the full gallery by KashKlicks Studios, Toronto photographer.`

Count the characters. Must be 150-160. The `[slug].astro` page uses this as `<meta name="description">`.

### story.headline (gallery H1, 4-7 words)

Emotional hook, not a keyword target. Evoke mood and place.

Examples from existing galleries:
- "Golden Light on Lake Ontario"
- "City Hall to Commerce Court"
- "Three Locations, One Golden Afternoon"
- "Snow, Steel, and Stone"

### story.pullQuote (client voice, 1-2 sentences)

Sounds like a text to a friend, not a review. Specific, personal, slightly informal. References something visible in the session. Never generic.

Examples:
- "We didn't even realize you were shooting half the time, and those turned out to be our favourite photos."
- "You made us feel like the coolest versions of ourselves."
- "We showed up in a lehenga in January and you made it look like we planned the whole winter."

---

## Session Type Adjustments

**Pre-wedding:** Focus on the couple's dynamic and the locations as a journey. Body paragraph 2 should land on the most editorial/cinematic frame.

**Wedding day:** Reference the ceremony as the emotional anchor. Mention specific moments (first look, vows, first dance). Body is allowed to be slightly longer (3 short paragraphs).

**Civil ceremony:** Intimate tone. Focus on the people and the city around them, not the production.

**Portraits:** More about the subject's personality than the location. Body paragraph 2 zooms in on character.

---

## Output Format

Write directly to `portfolio.json` — update the entry for this slug:

```json
"story": {
  "headline": "...",
  "body": "Paragraph one.\n\nParagraph two.",
  "pullQuote": "..."
},
"locationDescription": "...",
```

Then output one line:
```
Story written for {slug}. pageDescription: "{meta description text}"
```

The pageDescription line is for the frontend agent to pick up — it doesn't auto-update the Astro page.
