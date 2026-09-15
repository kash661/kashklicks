# Design brief: the inquiry section on /contact/

Self-contained brief. Written before any markup, per the roadmap gate. Scope is the
`#inquiry` section only. The hero, the FAQ and the closing social-proof band are not touched.

```
Hallmark · macrostructure: Editorial spread · genre: editorial
theme: locked (Digital Curator, defers to .claude/CLAUDE.md)
enrichment: one image card · motion: 2 primitives
system-managed project: diversification is inverted, the page shares the system
differs from last 3 log entries: pricing-configurator, coming-soon teaser, portfolio-category
```

Audience: a couple who scrolled the hero, liked the work, and now wants to know what it costs
or wants to talk to a person. They have asked nothing yet and owe nothing yet.
Use case: two doors, both one tap. Build a package, or send a message.
Tone: editorial, plain spoken, first person. Warm, never salesy.

## What changes and why

The section used to end in a nine-field inquiry form. A form is the highest-friction thing on
the page and it asks before it gives. The same lesson that shaped the configurator applies here:
75 paid Instagram sessions produced 0 leads with a form as the terminal action.

So the form comes out. In its place the right column offers exactly two paths:

1. **Build your package** at `/pricing/`, where the couple sees a price before anyone asks for
   an email. This is the primary action and it gets the visual weight.
2. **Message me** on Instagram or WhatsApp, for the couple who would rather type a sentence than
   answer six questions. Akash answers DMs daily and rarely checks email, so this is a real path,
   not a courtesy link.

Nothing on this page collects an address any more. The page gives on every line.

## Structure

The two-column editorial grid survives untouched, because the page's shape is the page's identity.
Left column is columns 1 to 5, right column is 7 to 12, and the mobile order flips so the right
column leads.

**Left column** keeps the brand statement, What Happens Next and Studio Notes. One line of copy
changes, because it promised a form that no longer exists. Step I of What Happens Next changes
for the same reason: "you send the note" described a form field.

**Right column**, top to bottom:

| Element | Role |
|---|---|
| `Start here` eyebrow | the page's existing eyebrow pattern, unchanged |
| Image card linking to `/pricing/` | the hero of this column, one tap target |
| Review strip | proof directly under the primary action |
| `Rather talk first?` | a plain line of wayfinding, not a heading |
| Instagram, then WhatsApp | the two message doors, in reply-speed order |
| Featured testimonial | unchanged |
| Book a call | unchanged text link, still secondary |

## The image card

One `<a>`, one tap target, four things inside it: the photograph, a heading, one line of body copy,
and a full-width dark button rendered as a `<span>` so a link never contains a button.

Josie and Nelson under the veil carries this card. It is the warmest frame in the homepage set and
it has to do the emotional work the removed h3 used to do.

- 4/5 on mobile, 3/2 on desktop. `avif`, quality 70, lazy.
- Heading `text-heading-lg` with "two minutes" in serif italic, so the promise is the emphasised half.
- Body copy `text-body-lg text-on-surface-variant`. It names the cost of the action and the fact
  that identity is not asked until the end.
- Button uses the site's primary dark button verbatim, plus `w-full`. No new button style enters
  the system for this.

**No border radius anywhere.** Square edges are the house rule and the card is the most tempting
place to break it.

## Typography

Site rule is typography by intent. The heading is the only emotional line in the column, so it is
the only display-weight thing there. Everything below the heading is sans and informational.

| Element | Class |
|---|---|
| `Start here` | `text-label-md text-on-surface-muted eyebrow-rule` |
| Card heading | `text-heading-lg`, serif italic on "two minutes" only |
| Card body | `text-body-lg text-on-surface-variant` |
| Button label | `font-sans text-label-md` |
| `Rather talk first?` | `text-label-sm text-on-surface-muted` |

## Motion

Two primitives, nothing more.

1. **Section entrance.** The existing `reveal-right` on the block. Untouched.
2. **Image scale on hover.** `scale(1.03)`, `var(--duration-deliberate)` with `--ease-gallery`,
   `transform` only. Matches the free-session page card, so no new curve enters the system.

Hover is enhancement. The card works identically without it. Everything is off under
`prefers-reduced-motion: reduce`.

## State ladder, the image card

| State | Treatment |
|---|---|
| Rest | image at scale 1, button `surface-dark` on `on-dark` text |
| Hover | image to `scale(1.03)` anywhere on the card, button background to `primary-hover` when the pointer is on the button itself |
| Focus visible | `2px solid var(--color-on-surface)` outline on the link, 4px offset. One ring for the whole card, since it is one target. |
| Pressed | no transform. The navigation is the feedback. |
| Reduced motion | no scale, hover is colour only |

## Copy rules applied to every line

No dashes and no hyphens in anything a couple reads. Two sentences instead of one joined clause.
First person, "I" and "me", as the rest of the page. No prices and no delivery promises appear in
this section. The configurator owns the numbers.

## What is deliberately not here

No second CTA competing with the button. No form, no field, no email capture. No eyebrow above the
`h2`, beyond the eyebrow pattern this page already carries. No gold, no rounded corners, no accent bar.
