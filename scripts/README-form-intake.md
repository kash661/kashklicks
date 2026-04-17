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

## Daily check from Claude Code

Any session:
> "Check my inquiries sheet for anything new."

Claude uses the Google Drive MCP to read the sheet and summarize rows with `Status = new` (or received since your last check). No extra auth needed — the Drive MCP is already connected.

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
