---
name: forms
description: Use when checking inquiries, triaging the inbox, or updating the AD Photography lead pipeline. Triggers on "/forms", "check forms", "any new inquiries", "new leads", "what came in", "check the inbox", "any new bookings", "update Sarah's status", "mark X as contacted", "mark X as booked", "show me the pipeline", "who am I waiting on", "follow-ups due", or any reference to leads/inquiries/pipeline/booked clients on this site. Always invoke when the user asks about form submissions or lead status — never read the sheet via Drive MCP directly.
---

# AD Photography lead pipeline

This skill is the only correct way to read or update inquiries on this site. Don't open the sheet via Drive MCP directly — go through the Apps Script endpoint so writes work and so the inbox/pipeline/booked separation stays consistent.

## Constants (hardcoded — never search Drive)

```
SHEET_ID            = 1Ajqngjk3PbYdT3kLJ_N_DlPkoVCW9fL6VsYHwMz4LvY
SHEET_TITLE         = Form Intake
WEB_APP_URL         = https://script.google.com/macros/s/AKfycbw5c2bxZOPov3y9XUgSWZdTmAhwZM9k2E5BBr9AJDiWGp2rDded_RYYrsVaq-HWm7VepQ/exec
TOKEN_FILE          = /Users/akashdesai/.claude/projects/-Users-akashdesai-projects-kashklicks/forms-admin-token
CALENDLY_TOKEN_FILE = /Users/akashdesai/.claude/projects/-Users-akashdesai-projects-kashklicks/calendly-token
CALENDLY_USER_URI   = https://api.calendly.com/users/6f492223-e58b-4232-9668-78085334330d
```

The token files are single lines, no trailing newline. If either doesn't exist, stop and tell Akash to follow `scripts/README-form-intake.md`. The Calendly token specifically needs `scheduled_events:read` scope (doesn't need `users:read` since the user URI is hardcoded above).

## Tabs

| Tab | What it holds |
|---|---|
| `Inquiries` | Raw form submissions. `Status = new` until triaged, then `promoted` or `ignored`/spam |
| `Pipeline` | Real leads being worked. Status moves: `new → contacted → call-booked → quoted → booked / lost / ghosted` |
| `Booked` | Signed clients. One row per booked event |

Sheet rows are 1-indexed; row 1 is the header. The API uses sheet row numbers everywhere.

## API

All endpoints are POST to `WEB_APP_URL`, form-encoded. Admin actions require `token`.

| Action | Params | Returns |
|---|---|---|
| (none) | form fields | `{ ok: true }` — anonymous form intake |
| `setup` | `token` | creates missing tabs, returns `{ ok, tabs }` |
| `list_inbox` | `token` | `{ ok, rows }` — only rows where Status = new |
| `list_pipeline` | `token` | `{ ok, rows }` — every Pipeline row |
| `list_booked` | `token` | `{ ok, rows }` — every Booked row |
| `promote` | `token`, `inbox_row`, `status?` | copies Inquiries row → Pipeline, marks Inquiries.Status = `promoted` |
| `ignore` | `token`, `inbox_row`, `reason?` | sets Inquiries.Status to reason (default `ignored`) |
| `update` | `token`, `tab` (`inbox`/`pipeline`/`booked`), `row`, `fields` (JSON object of column→value) | patches cells |
| `book` | `token`, `pipeline_row`, `quoted_amount?`, `contract_link?` | copies Pipeline row → Booked, marks Pipeline.Status = `booked` |

Each row in a list response has a `_row` key — that's the sheet row number for `update`/`book`/`ignore`/`promote` calls.

## Standard "check forms" flow

1. Read both tokens: `cat $TOKEN_FILE` and `cat $CALENDLY_TOKEN_FILE`
2. Run three reads in parallel:
   - POST `action=list_inbox`
   - POST `action=list_pipeline`
   - `GET https://api.calendly.com/scheduled_events?user=$CALENDLY_USER_URI&min_start_time=<48h ago ISO>&count=50` with `Authorization: Bearer <calendly-token>`
3. For each Calendly event, fetch invitees: `GET <event.uri>/invitees` (the event's `uri` field ends in `/scheduled_events/<uuid>`). Record invitee email + event start_time + event name.
4. **Auto-reconcile Calendly → Pipeline** (before showing Akash anything):
   - For each invitee email, find a Pipeline row where `Email` matches (case-insensitive).
   - If match and Pipeline row's `Status` is `new` or `contacted` and `Next Action` doesn't already reference this date, POST `action=update` to set:
     - `Status: call-booked`
     - `Last Contact: <today ISO date>`
     - `Next Action: Call <event.start_time as YYYY-MM-DD HH:MM local>`
   - Keep a list of reconciliations to surface as a "📅 Calendly sync" section at the top of the report.
5. Render tables for Akash:

   **New inbox** (only if rows present): row, received, source, name, email, message snippet, suggested action
   - Suggest `ignore` when message ≤ 3 chars, all-placeholder ("asd", "test", "lorem"), or fields are empty
   - Suggest `promote` otherwise

   **Pipeline** (only if rows present): row, name, event, date, status, last contact, next action
   - Flag rows where Status = `contacted` and Last Contact > 5 days ago → "follow-up due"
   - Flag rows where Status = `quoted` and Last Contact > 7 days ago → "nudge or mark ghosted"

4. Wait for Akash to triage in plain English. Examples:
   - "promote 1, ignore 2 as spam" → POST `promote` for row 1, `ignore` for row 2 with reason=spam
   - "promote everyone" → batch
   - "Sarah is contacted, note: prefers Saturdays, next: send package PDF" → find Sarah in Pipeline, POST `update` with `{Status:"contacted", Last Contact:"<today ISO>", Notes:"prefers Saturdays", Next Action:"send package PDF"}`
   - "Sarah is booked, $4500" → POST `book` with `pipeline_row=<Sarah's row>`, `quoted_amount=4500`

5. After every write, read back the affected list and confirm the change.

## Status vocabulary (use exactly these)

`new`, `contacted`, `call-booked`, `quoted`, `booked`, `lost`, `ghosted`

If Akash uses different words, map them: "called" → `contacted`, "scheduled a call" → `call-booked`, "sent quote" → `quoted`, "didn't answer" → `ghosted`, "passed" → `lost`.

## Date handling

When writing `Last Contact` or any date field, use ISO `YYYY-MM-DD` (not full timestamp — easier to read in the sheet). When reading dates back, they're already ISO strings.

## Failure modes

- 401 / `unauthorized` — token is wrong or missing in Script Properties. Tell Akash to verify in Apps Script editor → Project Settings → Script Properties.
- HTTP 200 but `{"ok":false}` — read the `error` field, surface it verbatim.
- Network timeout — retry once, then report.

## Calendly reference

- Base: `https://api.calendly.com`
- Auth: `Authorization: Bearer <token from $CALENDLY_TOKEN_FILE>`
- List events: `GET /scheduled_events?user=$CALENDLY_USER_URI&min_start_time=<ISO8601>&count=50`
  - Pagination via `pagination.next_page_token` if needed (rare for daily polling)
- Get invitees for an event: `GET /scheduled_events/<uuid>/invitees`
  - Usually 1 invitee for 1:1 calls; take `collection[0].email` and `collection[0].name`
- Event object fields of interest: `uri`, `start_time` (ISO8601 UTC), `end_time`, `name`, `status` (`active` / `canceled`)
- **Skip canceled events** — don't reconcile if `status == "canceled"`.

## What this skill does NOT do

- Doesn't email leads — Akash replies from his own inbox.
- Doesn't run on a schedule — Akash invokes daily.
- Doesn't sync from Stripe / contracts — the `book` action is dictated after a contract is signed.
- Doesn't open the sheet in a browser — everything goes through the API.
- Doesn't write to Calendly — read-only sync.
