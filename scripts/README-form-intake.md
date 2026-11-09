# Form intake — Google Sheet inbox

## One-time setup (5 minutes)

1. Create a blank Google Sheet. Name it `Form Intake` (or whatever you like).
2. In the sheet: **Extensions → Apps Script**. This creates a script that is **bound** to this one sheet — critical for the narrow permission scope below.
3. Delete the boilerplate in `Code.gs` and paste the full contents of `scripts/google-apps-script.gs`.
4. Edit `NOTIFY_EMAIL` at the top to your email if different from `info@kashklicks.ca`.
5. **Lock the script to only this sheet** (so it can't touch your other Sheets):
   - Click the gear icon (**Project Settings**) in the left sidebar.
   - Check **"Show 'appsscript.json' manifest file in editor"**.
   - Go back to the **Editor**. A new `appsscript.json` file appears.
   - Open it, delete the contents, and paste the contents of `scripts/appsscript.json` from this repo.
   - Save.

   This replaces the default broad `See, edit, create, and delete all your Google Sheets spreadsheets` scope with the narrow `spreadsheets.currentonly` scope — the script can only read/write the one sheet it's bound to.
6. Save (⌘S). Name the project if prompted.
7. **Deploy → New deployment**.
   - Click the gear next to "Select type" → **Web app**.
   - Execute as: **Me**.
   - Who has access: **Anyone**.
   - Click **Deploy**.
8. First time: authorize. Now the consent screen should ask for:
   - **"See, edit, create, and delete only the specific Google Drive files you use with this app"** (narrow — only the one sheet), and
   - **"Send email as you"** (for notification emails).

   Google will still warn "Google hasn't verified this app" — normal for personal scripts. Click **Advanced → Go to (your project name) (unsafe) → Allow**.
9. Copy the **Web app URL**. Should look like:
   `https://script.google.com/macros/s/AKfycbz.../exec`
10. Paste it back into Claude, or put it in your `.env` / site config and wire forms to it.

## Scope reference

The manifest requests only two scopes:

- `https://www.googleapis.com/auth/spreadsheets.currentonly` — access the bound spreadsheet only, not your other Sheets.
- `https://www.googleapis.com/auth/script.send_mail` — send notification emails from your account.

If you ever want to disable the email notifications, remove `MailApp.sendEmail(...)` from `google-apps-script.gs` and remove the second scope from `appsscript.json`.

## What the endpoint does on every POST

- Appends a row to the `Inquiries` tab (auto-created on first submission).
- Emails you a plain-text notification with all fields.
- Returns `{ ok: true }` JSON so the site can show inline success without redirecting.

## Columns the sheet tracks

Received · Source · Name · Email · Phone · Event Type · Event Date · Location · Guest Count · Message · Referral · List · Status · Raw

`Status` is pre-filled with `new`. Edit it in the sheet as you work through leads (`replied`, `booked`, `declined`, etc.). You can add filters / views in the sheet however you like.

## Pipeline setup (one-time, after the form-intake setup above)

The Apps Script also exposes admin endpoints used by the `forms` skill in `.claude/skills/forms/`. Two extra steps to enable them:

1. **Create an admin token.** In a terminal:
   ```bash
   openssl rand -hex 24 > ~/.claude/projects/-Users-akashdesai-projects-kashklicks/forms-admin-token
   chmod 600 ~/.claude/projects/-Users-akashdesai-projects-kashklicks/forms-admin-token
   ```
2. **Tell Apps Script the same token.** In the Apps Script editor:
   - Project Settings (gear icon) → **Script Properties** → **Add script property**.
   - Name: `ADMIN_TOKEN`. Value: paste the same token.
   - Save.
3. **Re-deploy the web app** so the new code is live: Deploy → Manage deployments → pencil icon → Version: New version → Deploy. The URL stays the same.
4. **Smoke test** from the project root:
   ```bash
   TOKEN=$(cat ~/.claude/projects/-Users-akashdesai-projects-kashklicks/forms-admin-token)
   curl -sX POST 'https://script.google.com/macros/s/AKfycbw5c2bxZOPov3y9XUgSWZdTmAhwZM9k2E5BBr9AJDiWGp2rDded_RYYrsVaq-HWm7VepQ/exec' \
     -d "action=setup" -d "token=$TOKEN"
   ```
   Expect `{"ok":true,"tabs":["Inquiries","Pipeline","Booked"]}`. The two new tabs will appear in the sheet.

## Daily check from Claude Code

Any session:
> "/forms"  — or "check forms", "any new inquiries", "show me the pipeline"

The `forms` skill (`.claude/skills/forms/SKILL.md`) hits the admin endpoints via the same web app URL. It reads inbox + pipeline, presents a triage table, applies your decisions (promote/ignore, status changes, notes, mark booked) by writing back through the API.

## If you want to migrate later

Since form fields are normalized and stored in their own columns (plus a `Raw` JSON column), you can export to CSV and import into Airtable / Notion / Linear / a real CRM at any point without losing anything.

## Sending a test

```bash
curl -X POST 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec' \
  -d 'source=test' \
  -d 'name=Test Person' \
  -d 'email=test@example.com' \
  -d 'message=Does this work?'
```

Expect a JSON `{"ok":true}` response and a new row in the sheet + an email in your inbox.

## Client shoot brief (onboarding form)

A hidden page for booked couples, filled in before their pre wedding shoot:

`https://kashklicks.ca/welcome/brief-s7vhr67r7keg/`

It is not linked anywhere, has a `noindex` meta and header, and is blocked in
`robots.txt`. The path lives in `src/data/onboarding-fields.json` (`meta.path`).

### Personal link template

Send each couple their own link so the basics are filled in for them:

```
https://kashklicks.ca/welcome/brief-s7vhr67r7keg/?b=<BOOKING_ID>&p=<PACKAGE_ID>&n1=<NAME_1>&n2=<NAME_2>&d=<YYYY-MM-DD>
```

| Param | Fills | Notes |
|---|---|---|
| `b` | hidden booking id | Letters, digits, `-` and `_` only. Becomes part of the storage key. |
| `p` | Your package | Must be one of `love-story-mini-film`, `love-story-film`, `pre-wedding-full`, otherwise ignored. |
| `n1` | Your name | |
| `n2` | Your partner's name | |
| `d` | Shoot date | Only `YYYY-MM-DD`, otherwise ignored. |

Every value is capped at 80 characters and URL encoded (a space is `%20`).
Pre-fill only fills empty fields, so a couple's own answers are never
overwritten. The page removes these params from the address bar right after
reading them, so names do not end up in analytics.

Example:

```
https://kashklicks.ca/welcome/brief-s7vhr67r7keg/?b=KK-2027-014&p=love-story-film&n1=Priya&n2=Arjun&d=2027-05-16
```

### Where submissions go

1. The page posts JSON to `/r/onboarding` (worker).
2. The worker validates with the same schema as the page, saves the record to
   the `ONBOARDING_KV` namespace (`onb:v1:<booking>:<submission>`, kept two
   years), then forwards `form=onboarding` + a plain text summary to Apps Script.
3. Apps Script appends a row to the `Onboarding` tab and emails the brief.

If Apps Script is down, the couple still sees the thank you screen and the
record stays in KV marked `notified:false`. To list stored briefs:

```bash
npx wrangler kv key list --binding ONBOARDING_KV --remote --prefix onb:v1: > /tmp/kv.log 2>&1; cat /tmp/kv.log
```

### Location keys in the payload

The form no longer shows a list of places. Couples describe what they want,
and the brief carries these keys (values are option ids from
`src/data/onboarding-fields.json`):

| Key | Type | Example |
|---|---|---|
| `location_features` | array, at least one OR `locations_own` | `["water", "fall"]` |
| `location_areas` | array | `["downtown", "east"]` |
| `walking_level` | `easy`, `some` or `hike` | `"easy"` |
| `locations_own` | text | `"Our first date spot, Trinity Bellwoods"` |
| `time_of_day`, `locations_count`, `locations_meaningful`, `permits_known` | unchanged | |

The worker also sends Apps Script readable labels as `location_wishes`,
`wish_features`, `wish_areas`, `wish_walking` and `wish_own`.

### Turning wishes into three proposed places

`node scripts/match-locations.mjs brief.json` ranks `src/data/locations.json` against a saved brief (the payload or the KV record).
Or pass the answers directly: `node scripts/match-locations.mjs --features water,fall --areas downtown,east --walking easy --limit 8`.

### Reading briefs from KV

`node scripts/list-briefs.mjs` lists every stored brief (couple, email, booking id, date), newest first, straight from Cloudflare KV.
`--get <key>` (or `--get latest`) prints one brief as the same plain text summary the email carries, `--json` prints raw data.
This works before the Apps Script update is deployed, because the worker saves to KV first.

### A/B pricing columns

The setup action (`action=setup`, see "Pipeline setup" above) also appends **Price variant** (`A portfolio discount` / `B privacy fee`)
and **Sharing allowed** (`yes` / `no`) to the end of the Pipeline and Booked tabs, with dropdowns. Existing columns never move,
re-running is safe, and booking a client copies both values from Pipeline to Booked.

The Apps Script side needs a one time update, see
`scripts/APPS-SCRIPT-PATCH-onboarding.md`.
