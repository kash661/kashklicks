# Apps Script update for the shoot brief

The new shoot brief page sends answers to your Google Sheet through the same
Apps Script you already use for the contact form. The script needs one update
so it knows what to do with a brief. Until you do this, briefs are still saved
safely in Cloudflare (the `ONBOARDING_KV` store), but no sheet row or email
appears.

Time needed: about 10 minutes.

## Step 1. Open the script

1. Open the Google Sheet that holds your **Inquiries** tab.
2. In the top menu, click **Extensions**, then **Apps Script**.
3. A new tab opens with the code editor. You will see a file called `Code.gs`.

## Step 2. Paste the new code

1. On your Mac, open `scripts/google-apps-script.gs` from this repo.
2. Select everything in it and copy it.
3. In the Apps Script tab, click inside `Code.gs`, select everything, and paste.
   This replaces the old code with the new code.
4. Press **Cmd + S** to save.

Nothing else in the old code was changed. The new parts are the `Onboarding`
tab, the email, and an optional Google Doc copy.

## Step 3. Publish the new version (important)

Saving is not enough. The website only talks to the **deployed** version.

1. Click **Deploy** (blue button, top right), then **Manage deployments**.
2. You may see more than one deployment. Pick the one whose ID starts with
   `AKfycbw5`. That is the one the website uses (see Step 4 to check).
3. Click the **pencil icon** to edit it.
4. Under **Version**, choose **New version**.
5. Click **Deploy**. The URL stays the same, so the website keeps working.

## Step 4. Check you edited the right deployment

The website sends to this address:

```
https://script.google.com/macros/s/AKfycbw5c2bxZOPov3y9XUgSWZdTmAhwZM9k2E5BBr9AJDiWGp2rDded_RYYrsVaq-HWm7VepQ/exec
```

In **Manage deployments**, click the deployment you just edited and look at
its **Web app URL**. It must match the address above exactly. If it does not,
repeat Step 3 on the deployment that does match.

Why this matters: an older note says the forms tool sometimes reads a
different deployment (ID starting `AKfycbxX`). If you edit that one by
mistake, briefs go to a sheet nobody checks.

## Step 5. Test it

Ask Claude to send a test brief, or fill in the page yourself with the booking
id `TEST`. Within a minute you should see:

- a new **Onboarding** tab in the sheet with one row (the **Location wishes**
  column shows what they want around them, the areas and the walking level), and
- an email titled `[AD Photography] Shoot brief: <names> (<booking id>)`.

You can delete the test row afterwards.

## Optional. Auto create a storyline doc for each couple

The script can copy a Google Doc template for every brief and fill in the
couple's details. This is off until you turn it on, because it needs Google to
grant two extra permissions (edit Docs, and make copies in Drive).

1. Make a Google Doc to use as your template, for example your run of show.
   Put these placeholders where you want the details to appear:
   `{{COUPLE}}`, `{{BOOKING_ID}}`, `{{PACKAGE}}`, `{{SHOOT_DATE}}`,
   `{{BACKUP_DATE}}`, `{{LOCATIONS}}`, `{{SONGS}}`, `{{MUST_HAVES}}`,
   `{{SUMMARY}}`.
2. Copy the Doc's id. It is the long code in the Doc's address, between
   `/d/` and `/edit`.
3. In Apps Script, click the **gear icon** (Project Settings) on the left.
4. Scroll to **Script Properties**, click **Add script property**.
   Name: `ONBOARDING_DOC_TEMPLATE_ID`. Value: the id you copied. Save.
5. Still in Project Settings, make sure **Show "appsscript.json" manifest file
   in editor** is ticked. Go back to the editor and open `appsscript.json`.
6. Replace its contents with `scripts/appsscript.onboarding-docs.json` from
   this repo. The only difference is two extra lines for Docs and Drive.
7. Save, then do Step 3 again (New version, Deploy).
8. Google will ask you to authorize again. Click **Advanced**, then
   **Go to (project name)**, then **Allow**.

Couples no longer pick places from a list. They tell you what they want
around them, how far they will travel, and how much walking is okay. So
`{{LOCATIONS}}` is filled with their wishes, for example
`Wishes: Beach and water, Fall colours; areas: Downtown Toronto; walking: Easy, short walks; their own ideas: none`.
Replace it with the places you choose once you have matched them.

Each new brief now gets a Doc called `Storyline and run-of-show, <names>`,
and its link appears in the **Doc Link** column and in the email.

If you skip this part, everything else still works. The **Doc Link** column
just stays empty.

## If something goes wrong

- **No row, no email:** you probably edited the wrong deployment. Redo Steps 3
  and 4.
- **Email arrives but no Doc link:** the template id is missing, or the extra
  permissions in the optional part were not granted.
- **Need a brief that never reached the sheet:** it is still in Cloudflare.
  Ask Claude to list the `ONBOARDING_KV` keys and read the record.
