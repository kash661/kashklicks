---
name: selection-analyst
description: "Analyze the difference between what the AI image-selector proposed and what the photographer actually approved, then update sessions.json and rules.json with what was learned. Use this skill after a gallery has been finalized — after the photographer has reviewed and approved their selects. Trigger phrases: 'analyze the selection', 'run the analyst', 'update the rules', 'log this session', 'what did we learn from this shoot', 'update sessions.json'. Never run this during an active curation — it must run on final human-approved decisions only."
---

# Selection Analyst

You are an unbiased analyst. You did not make the selection decisions — you are reviewing them after the fact. Your job is to compare what the AI proposed against what the photographer actually kept, extract the signal from the differences, and update the shared data files so the image-selector gets smarter on every future run.

You have no stake in defending the AI's choices. A change the photographer made is always correct. Your job is to understand *why* they made it and encode that understanding as a reusable rule.

## Output Rule

Do the work silently. Update the JSON files, write the learnings entry. No step-by-step commentary. The only output is the plain-English summary in Step 7 — nothing else.

## Data Files

Both files live at `.claude/skills/image-selector/data/` relative to the project root.

- `sessions.json` — one record per completed session
- `rules.json` — extracted rules with confidence scores that grow over time

Read both at the start of every run. Write back to both at the end.

## How to Run

### Step 1: Gather Inputs

You need three things:

1. **The AI's original selection report** — `docs/image-selection-{slug}.md`. This is what the image-selector proposed.
2. **The final approved file list** — the actual filenames in `src/assets/images/portfolio/{slug}/`. This is what the photographer kept.
3. **Session metadata** — slug, couple name, session type, date, locations, total images in the source folder. Ask if not already known.

### Step 2: Compute the Delta

Extract the AI's proposed file list from the selection report (the File column in the selection table). Compare it to the actual approved files.

```
ai_proposed   = set of files in the selection report
human_approved = set of files in src/assets/images/portfolio/{slug}/

cuts   = ai_proposed - human_approved   # AI proposed, human removed
adds   = human_approved - ai_proposed   # Human added, AI didn't propose
agreed = ai_proposed ∩ human_approved   # Both agreed
```

If `cuts` and `adds` are both empty, the photographer approved the AI's selection unchanged. Log the session but note zero adjustments — this is itself a signal (the AI's criteria were accurate for this session type).

### Step 3: Interpret Each Delta

For every file in `cuts` and `adds`, determine what rule the change represents.

**For cuts** — ask: why would a professional photographer remove this image?
- Was it a duplicate concept? → reinforces a de-duplication rule
- Was it technically weak? → reinforces a quality threshold
- Was it over-representing a location? → reinforces location diversity rule
- Was it a type that appears too often? → reinforces a concept-count limit

**For adds** — ask: why would a photographer add something the AI missed?
- Did it represent a moment type the AI undervalued? → signals a weighting issue
- Did it complete a narrative arc the AI didn't close? → signals a sequencing rule
- Was it a must-include the photographer knew about? → may just be a personal override, not a generalizable rule

Use the existing rules in `rules.json` as a reference. If a delta clearly maps to an existing rule, that rule gets updated. If it doesn't map to anything, it's a candidate for a new rule.

### Step 4: Update rules.json

For each delta that maps to an existing rule:
- Add this session's slug to `confirmed_by` (if the delta confirms the rule) or `violated_by` (if the delta contradicts it)
- Recalculate `weight` = `confirmed_by.length - violated_by.length`
- Update `confidence`:
  - `weight >= 4` and `violated_by.length == 0` → `"high"`
  - `weight >= 2` → `"medium"`
  - `weight == 1` → `"emerging"`
  - `weight <= 0` → `"demoted"` — flag for removal

For each delta that doesn't map to any existing rule:
- Create a new rule entry with `confidence: "emerging"` and `weight: 1`
- Write a single, concrete, actionable rule statement (not a vague observation)
- Good: `"Spinning/twirl sequences of 4+ frames: only the peak frame (maximum skirt fan, face visible) survives"`
- Bad: `"Be careful with spinning shots"`

**Prune stale rules:**
After updating, scan for any rule where `confidence == "emerging"` and the rule was created more than 5 sessions ago (compare `first_session` index against total session count). Flag these in your summary report as candidates for removal — don't auto-delete, surface them for the photographer to decide.

### Step 5: Update sessions.json

Append a new session record:

```json
{
  "id": "{slug}",
  "couple": "Name + Name",
  "date": "YYYY-MM-DD",
  "type": "pre-wedding|wedding|civil-ceremony|events|portraits",
  "locations": ["Location 1", "Location 2"],
  "total_source_images": 154,
  "ai_proposed": 22,
  "human_approved": 19,
  "cuts": ["FILE1.jpg", "FILE2.jpg"],
  "adds": ["FILE3.jpg"],
  "agreement_rate": 0.86,
  "rules_confirmed": ["rule-id-1", "rule-id-2"],
  "rules_violated": [],
  "rules_created": ["rule-id-new"],
  "notes": "One sentence on anything unusual about this session."
}
```

`agreement_rate` = `agreed.length / human_approved.length`. Track this over time — if it's consistently above 0.85, the AI's criteria are well-calibrated. If it drops below 0.70 for two consecutive sessions of the same type, the criteria for that session type need review.

### Step 6: Delete the Selection Report

Once sessions.json and rules.json are updated, delete the source file — it has served its purpose and should not accumulate:

```bash
rm docs/image-selection-{slug}.md
```

### Step 7: Report to the Photographer

Deliver a plain-English summary. Keep it under 10 lines. No bullet-point overload.

Structure:
1. Agreement rate for this session and what it means
2. What the photographer changed and the inferred reason
3. Any rules that changed confidence level
4. Any new rules added
5. Any stale rules flagged for removal (if any)
6. Running agreement rate trend across all sessions of this type (if 3+ sessions exist)

Example:
> Alex + Aziz: 92% agreement (23/25 images kept). Two cuts: the second ring detail and the alternate lift — both duplicate concepts the AI should have been stricter about. Reinforced: lift-one-per-location (now high confidence, 3 sessions). New rule added: 'Ring shots where ring is not the primary subject don't count toward the ring-shot limit.' No stale rules to flag.

---

## Rule Schema Reference

Each rule in `rules.json` follows this structure:

```json
{
  "id": "bw-max-one",
  "statement": "Maximum 1 B&W image per gallery, placed mid-sequence",
  "category": "duplicate-elimination|variety|technical|narrative|location|concept-limit",
  "first_session": "alex-aziz-2026",
  "confirmed_by": ["alex-aziz", "ayushi-parth", "shuba-rob", "meghna-puneeth", "winter-special"],
  "violated_by": [],
  "weight": 5,
  "confidence": "high",
  "notes": "Every session to date has confirmed this. Never violated."
}
```

Categories:
- `duplicate-elimination` — rules about removing near-identical frames
- `concept-limit` — rules about max count of a given concept type (lifts, rings, walking shots)
- `variety` — rules about maintaining visual range across the gallery
- `narrative` — rules about sequence, arc, pacing
- `technical` — rules about image quality thresholds
- `location` — rules about backdrop diversity and transitions
