---
name: dev
description: "Full development lifecycle for the AD Photography (kashklicks) website. Orchestrates context gathering, brainstorming, research, planning, subagent implementation, code review, simplification, and testing into one workflow. Use this skill whenever the user asks to build a feature, fix a bug, redesign a page, add a component, implement something, or do any development work on the site. Trigger phrases: 'build this', 'implement', 'add a feature', 'fix this', 'develop', 'make this work', 'redesign', 'create a page', 'wire this up'. Even if the user just describes something they want changed on the site without saying 'develop', this skill applies."
---

# Dev: Full Development Lifecycle

An orchestration skill that takes a development task from idea to done. Each phase has a clear gate before moving to the next. The skill coordinates existing tools and skills rather than reinventing them.

## Why This Exists

Development tasks on this project follow a predictable pattern: understand the ask, research what's needed, plan, build, review, clean up, test. Skipping steps leads to rework. This skill enforces the full cycle so nothing gets missed, while keeping you (the user) in the loop at every decision point.

## The Flow

```
1. Gather Context
2. Brainstorm (with user)
3. Research (Perplexity + Context7)
4. Write Plan
5. Implement (subagents)
6. Build Verification
7. Code Review
8. Simplify
9. Build + Review Again
10. Test
11. Done
```

Each phase has a gate. You don't move forward until the gate passes. If a gate fails, you fix it before proceeding.

---

## Phase 1: Gather Context

Before asking the user anything, silently gather all available context so you can ask informed questions.

**Read these (in parallel where possible):**
- `CLAUDE.md` (project instructions, design system, constraints)
- Memory index at `~/.claude/projects/-Users-akashdesai-projects-kashklicks/memory/MEMORY.md`
- `git status` and `git log --oneline -10` (what's in progress, recent work)
- Any files the user referenced or that are obviously relevant to their request
- `src/data/site.json` for current site config
- `src/styles/global.css` design tokens if the task involves UI

**What you're looking for:**
- Design constraints (no rounded corners, no gold, no em dashes, etc.)
- Existing patterns the implementation should follow
- Recent changes that might conflict with the new work
- Data structures and component APIs that will be touched

**Gate:** You have enough context to ask smart questions. Do NOT dump what you found back to the user. Use it to inform your brainstorming questions.

---

## Phase 2: Brainstorm

Invoke the `superpowers:brainstorming` skill. This is a conversation with the user to nail down requirements.

**Key behaviors:**
- Ask one question at a time
- Prefer multiple choice when possible
- Don't assume, confirm. Even if context from Phase 1 seems obvious.
- The brainstorming skill will write a spec to `docs/superpowers/specs/`

**Gate:** User has approved the spec.

---

## Phase 3: Research

Only research what you actually need. If the task is straightforward (e.g., "add a new section to the about page" using existing patterns), skip this phase.

**When to research:**
- Using a library or API you're not confident about
- The task involves a pattern not already in the codebase
- The user explicitly asked for a specific technology or approach

**How to research:**

For **library/framework docs** (Astro, Tailwind, etc.):
1. Use Context7 MCP: first `resolve-library-id` to find the library, then `query-docs` for the specific topic
2. This gives you current, accurate API docs

For **broader questions** (best practices, comparisons, "how do others solve X"):
1. Use the Perplexity MCP: `perplexity_ask` for quick answers, `perplexity_research` for deeper investigation
2. The user specifically prefers Perplexity over generic web search

**Gate:** You have the technical knowledge needed to write a solid plan. Share key findings with the user if they affect the approach.

---

## Phase 4: Write Plan

Invoke the `superpowers:writing-plans` skill. This creates a detailed, task-by-task implementation plan saved to `docs/superpowers/plans/`.

**Key behaviors:**
- The plan should reference the spec from Phase 2
- Each task should be small enough for a single subagent (2-5 minutes of work)
- Include exact file paths, code blocks, and build commands
- Follow TDD where tests exist

**Gate:** Plan is written and user has chosen an execution approach (subagent-driven is default).

---

## Phase 5: Implement

Invoke the `superpowers:subagent-driven-development` skill. This dispatches a fresh subagent per task from the plan.

**Key behaviors:**
- Subagents get full task text, not file references
- Use sonnet for mechanical tasks, opus for judgment-heavy ones
- Independent tasks can run in parallel
- Each subagent commits its own work
- Track progress with TaskCreate/TaskUpdate

**Gate:** All tasks from the plan are complete and committed.

---

## Phase 6: Build Verification

Before any review, make sure the code compiles.

```bash
cd /Users/akashdesai/projects/kashklicks && pnpm build
```

**Gate:** Build passes with zero errors. If it fails, fix the build errors before proceeding. Do not move to review with broken code.

---

## Phase 7: Code Review

Review the implementation against the spec.

**What to check:**
- Does the implementation match every requirement in the spec?
- Are there design constraint violations? (check CLAUDE.md hard rules)
- Are there any missing sections, broken links, or incomplete features?
- Does the code follow existing patterns in the codebase?

**Gate:** No spec violations found, or violations have been fixed and build re-verified.

---

## Phase 8: Simplify

Invoke the `simplify` skill. This reviews the changed code for:
- Reuse opportunities (did we duplicate something that already exists?)
- Code quality (unnecessary complexity, dead code)
- Efficiency (could be done in fewer lines without losing clarity)

The simplifier may make edits. That's expected.

**Gate:** Simplifier has run and any changes it made are committed.

---

## Phase 9: Build + Review Again

The simplifier may have introduced issues. Verify again.

```bash
cd /Users/akashdesai/projects/kashklicks && pnpm build
```

Then do a quick review of the simplifier's changes. If the simplifier broke something or made the code worse, revert those specific changes.

**Gate:** Build passes. Simplified code is correct.

---

## Phase 10: Test

Start the dev server and verify the feature works.

```bash
cd /Users/akashdesai/projects/kashklicks && pnpm dev
```

**Test checklist:**
- [ ] The feature works as described in the spec (golden path)
- [ ] Mobile viewport (375px) looks correct
- [ ] No console errors in the browser
- [ ] Navigation to/from the changed pages works
- [ ] Existing pages aren't broken (spot check 2-3 other pages)
- [ ] Build still passes after any test-driven fixes

**Important:** If the task involves UI changes, tell the user to check `localhost:4321` in their browser. Do not claim UI features work without either testing them or being explicit that you haven't tested them.

**Gate:** All checks pass, or you've told the user exactly what you couldn't verify.

---

## Phase 11: Done

Summarize what was built:
- List the commits (with SHAs)
- List the files changed
- Note anything the user should manually verify
- Note any known limitations or follow-up work

Do not over-summarize. Keep it concise.

---

## Skipping Phases

Not every task needs every phase. Use judgment:

| Task Type | Skip |
|---|---|
| Tiny fix (typo, config change) | Phases 2-4 (brainstorm, research, plan). Just do it. |
| Bug fix with clear cause | Phase 2 (brainstorm). Research if needed, plan if multi-step. |
| Feature using existing patterns | Phase 3 (research). You already know how. |
| Pure content update | Phases 3, 5, 7, 8 (research, subagents, review, simplify). |

When skipping, say which phases you're skipping and why. The user can override.

---

## Error Recovery

**Build fails after implementation:** Read the error, fix it inline, rebuild. Don't dispatch a new subagent for simple build errors.

**Subagent gets stuck:** Provide more context and re-dispatch, or escalate to a more capable model. Don't let a stuck subagent block the whole flow.

**Simplifier makes things worse:** `git diff` the simplifier's changes, revert the bad ones, keep the good ones.

**User changes their mind mid-flow:** That's fine. Go back to the relevant phase. If requirements changed, go back to Phase 2. If approach changed, go back to Phase 4.
