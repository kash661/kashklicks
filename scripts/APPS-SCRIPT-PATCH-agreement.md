# Apps Script update for signed agreements

Clients will soon sign their service agreement on the website. After they
sign, the website asks your Google Apps Script to do three things:

- turn the signed agreement into a PDF,
- email the PDF to the client (you get a copy), and
- add one row to a new **Contracts** tab in your sheet.

The script needs one update so it knows how to do this. It is the same
script you already use for the contact form.

Time needed: about 5 minutes.

## Good to know first

- **No new permissions.** Google will not ask you to allow anything new. The
  script only uses the email and sheet tools it already has.
- **The manifest is not touched.** Do not change `appsscript.json`. Only
  `Code.gs` changes.
- **Nothing old changes.** The contact form, the shoot brief and the pipeline
  work exactly as before. The new parts are only added.

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

## Step 3. Publish the new version (important)

Saving is not enough. The website only talks to the **deployed** version.

1. Click **Deploy** (blue button, top right), then **Manage deployments**.
2. Pick the deployment whose ID starts with `AKfycbw5`. That is the one the
   website uses.
3. Click the **pencil icon** to edit it.
4. Under **Version**, choose **New version**.
5. Click **Deploy**. The web address stays the same, so the website keeps
   working.

## What you will see later

- The first time a client signs, a new tab called **Contracts** appears. Each
  signed agreement gets one row.
- When Claude runs a practice signing, the row goes to a separate tab called
  **Contracts TEST**, and the email goes only to you. Its subject starts with
  `[TEST]`. You can delete that tab any time.
- If an email could not be sent, the row says `copy failed` in the
  **Status** column. It is sent again when the client opens their agreement
  page again, or when you ask Claude to resend it. The same row is then
  updated to `signed`.

## Step 4. Tell Claude

Tell Claude it is done. Claude checks it with a ping.
