# Test Tracker

Testers enter their name, then record Pass / Fail / Blocked for each case, with a conversation ID, notes and screenshots. Everything saves to a Google Sheet:

- **Results** tab: **one row per tester, one column per test case**. Each cell shows the status. The conversation ID and notes are attached as a cell note (hover to read).
- **Details** tab: one row per tester per case, with Status, Conversation ID, Notes, clickable Screenshot links, and Updated.
- **Cases** tab: test cases added, edited or deleted with the tracker's **Add test case** / **Edit case** buttons, plus who changed them and when.
- Screenshots are saved to a Drive folder, **Indosat Micro Receptionist Test Tracker — screenshots**, inside the folder you choose.

The Vercel server signs in to Google as **your** account (with a saved refresh token) and writes through the Google Sheets and Drive APIs. Testers don't sign in to anything; they just enter their name.

A conversation ID is required for every **Fail**. Clicking Fail opens the case and puts the cursor in that field, and Submit is blocked until every failure has one. To change which statuses need one, edit `CONVO_REQUIRED_FOR` in `js/config.js`.

## Project layout

```
index.html                 Name page (the entry point)
tracker.html               The tracker
cases/
  index.json               Page header text ("suite"), plus the areas in display order and which file holds each
  <area>.json              One file per area: an array of test cases
  images/                  Reference screenshots shown on a case
archive/
  2026-11-05-nvidia-ea-web/ A past test set, kept as-is (same layout as cases/). Not deployed.
css/
  styles.css               Original styling (unchanged)
  app.css                  Small additions for the name page
js/
  config.js                Levels, statuses, API path, autosave delay
  dom.js                   DOM helpers
  cases.js                 Loads and validates cases from cases/
  store.js                 Tester name + in-progress results in the browser
  sheets.js                Saves to / loads from the sheet (debounced autosave)
  images.js                Shrinks, uploads and removes screenshots
  tracker.js               Tracker page UI
  login.js                 Name page
api/sheet.js               GET/POST a tester's results
api/cases.js               GET/POST/DELETE case edits made in the tracker
api/upload.js              POST a screenshot / DELETE one (moves it to Drive trash)
api/image.js               Serves a screenshot so thumbnails work without public Drive links
lib/
  google.js                Signs in with the refresh token and calls Google APIs
  sheet.js                 Results + Details tab layout and writes
  drive.js                 Screenshot upload / read / trash in Drive
  http.js                  Request validation and error responses
scripts/get-google-token.mjs  One-time: prints the refresh token for Vercel
```

## Starting a new set of test cases

The live set is whatever is in `cases/`. To swap in a new one:

1. **Archive the current set.** Move everything in `cases/` into a new dated folder, e.g. `archive/2026-11-03-<name>/`.
2. **Fill `cases/` with the new set.**
   - `cases/index.json` holds the page header text and the list of areas:
     ```json
     {
       "suite": {
         "tabTitle": "Name shown on the browser tab",
         "eyebrow": "Personal AI · Pilot name",
         "title": "What this test run covers",
         "lede": "One line for testers about what they're testing.",
         "summaryTitle": "Name used at the top of the copied summary",
         "levels": ["Core", "Use case"]
       },
       "areas": [
         { "name": "Onboarding", "file": "onboarding.json" },
         { "name": "Calling", "file": "calling.json" }
       ]
     }
     ```
   - Add one `cases/<area>.json` per area (format below), plus any reference images in `cases/images/`.
   - Or leave `"areas": []` and add every case from the tracker with **Add test case**.
3. **Point Vercel at a fresh spreadsheet.** Update `SHEET_ID` (and `FOLDER_ID` if screenshots should go somewhere new), then redeploy. The tabs are created on first use. Edits made with the tracker's case editor live in the old sheet's Cases tab, so they don't carry over.
4. **Commit and push.**

To bring an archived set back, copy its files into `cases/`.

## Adding or changing test cases

There are two ways to change cases:

**In the tracker (easiest):** use **Add test case** (next to the filters) or **Edit case** (inside any open case). Changes save to the sheet's **Cases** tab and show for everyone the next time they load the page. **Delete case** hides a case for everyone. A case's ID can't be changed after it's created, because the ID is its column in the sheet.

**In the files:** edit the JSON file for the area, then commit and push (Vercel redeploys automatically).

```json
{
  "code": "ONB-12",
  "title": "What is being tested",
  "pr": 2,
  "level": "MUST",
  "owner": "Miki",
  "dev": "Open",
  "steps": ["First step.", "Second step."],
  "expected": "What should happen.",
  "notes": ["Known issue or context."],
  "attachments": [{ "src": "images/ONB-12-1.png", "caption": "What this screenshot shows", "source": "priorities doc" }]
}
```

- `code` must be unique. It's the case's ID and the key for its sheet column, so **don't rename a code** once people have results for it.
- `level` is one of the set's `suite.levels` (default `MUST`, `SHOULD`, `Checklist`, `Dev fix`). The first level gets its own "… passed" tile. `pr` is a number or `null`.
- `code` can use letters, numbers, `.`, `-` and `_`, so `1.7` works. Codes sort naturally (1.2 before 1.10).
- `attachments` is optional. Put the image in `cases/images/` and reference it as `images/<file>`. Each shows under the case with its caption; `source` is optional and adds "· from <source>".
- A new case gets a new column the first time anyone saves. A changed title updates the header text.
- After removing a case from the files, run `node scripts/renumber-cases.mjs` to close the gap (e.g. G2.4 → G2.3). It renumbers codes like `G2.3` in area order and updates references to them in steps, expected and notes. Only do this before testing starts, since results are stored by code.
- To add a whole new area, create `cases/<area>.json` and add it to `cases/index.json`. Cases added in the tracker can use a new area name directly.
- **Edits made in the tracker take priority over the files.** If a case was edited in the tracker, later changes to its file entry won't show. Edit it in the tracker instead, or delete its row from the **Cases** tab so the file version applies again.

## Google setup (one time, about 15 minutes)

You'll end up with five values for Vercel:

| Vercel variable | What it is |
|---|---|
| `GOOGLE_CLIENT_ID` | From your Google Cloud OAuth client (step 2) |
| `GOOGLE_CLIENT_SECRET` | Same place (step 2) |
| `GOOGLE_REFRESH_TOKEN` | Printed by the sign-in script (step 3) |
| `SHEET_ID` | From the sheet's URL (step 4) |
| `FOLDER_ID` | From the folder's URL (step 4) |

### 1. Create a Google Cloud project and turn on the APIs

1. Go to **https://console.cloud.google.com** signed in with your **work** account.
2. Top bar → project picker → **New project** → name it `EA Test Tracker` → **Create**, then make sure it's selected.
3. Open **https://console.cloud.google.com/apis/library/sheets.googleapis.com** → **Enable**.
4. Open **https://console.cloud.google.com/apis/library/drive.googleapis.com** → **Enable**.

### 2. Create the sign-in client

1. Open **https://console.cloud.google.com/auth/overview** → **Get started**.
   - App name: `EA Test Tracker`, support email: you → **Next**
   - Audience: **Internal** → **Next**. Internal means only your company's accounts can use it, and Google doesn't need to review it.
   - Contact email: you → **Next** → agree → **Create**.
2. Go to **Clients** (left menu) → **Create client**.
   - Application type: **Desktop app**, name: `EA Test Tracker` → **Create**.
   - Copy the **Client ID** and **Client secret**.

### 3. Sign in once to get the refresh token

In Terminal, from this project folder:

```bash
node scripts/get-google-token.mjs "YOUR_CLIENT_ID" "YOUR_CLIENT_SECRET"
```

A browser opens. Sign in with your **work account** and click **Allow**. The terminal prints a long token: that's `GOOGLE_REFRESH_TOKEN`.

### 4. Make the folder and sheet

1. In Google Drive, create the folder everything should go in, e.g. *EA Testing*. Open it and copy the ID from the URL: `drive.google.com/drive/folders/`**`THIS_PART`** → `FOLDER_ID`.
2. Inside that folder, **New → Google Sheets**, and name it, e.g. "Indosat Micro Receptionist test results". Copy the ID from its URL: `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit` → `SHEET_ID`.

The `Results`, `Details` and `Cases` tabs and the screenshots subfolder are created automatically on first use.

```
EA Testing/
├── Indosat Micro Receptionist test results   ← Results + Details tabs
└── Indosat Micro Receptionist Test Tracker — screenshots/
```

### 5. Share with your team

Share the folder with your team (Viewer access, or Editor if they should edit the sheet) so they can open the sheet and the screenshot links. Testers don't need any access to use the tracker itself.

Notes:
- The last column of the `Details` and `Cases` tabs is hidden and holds the data as JSON, which the tracker reads back. Don't edit it, and don't sort the tabs in place (use **Data → Create a filter** instead).
- Everything written to the sheet and Drive shows as done by your account.
- If you remove the app's access (Google Account → Security → Third-party connections), run step 3 again and update `GOOGLE_REFRESH_TOKEN`.

## Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel. Framework preset: **Other**. There's no build command or output directory.
2. **Settings → Environment Variables**: add the five variables from the table above.
3. **Deployments → ⋯ → Redeploy** so the variables take effect.
4. Check it: open `https://YOUR-SITE.vercel.app/api/sheet?name=test`. It should show `{"ok":true,"results":null}`. If it doesn't, the error message says what's missing.

## Local development

```
vercel dev
```

Open http://localhost:3000. Use `vercel dev` rather than opening the HTML file directly: the pages load cases with `fetch` and need `/api/sheet`.

## How saving works

- Results save in the browser as you click and autosave to the sheet about 1.5 s after the last change, so you can watch progress live. A change made right before closing the tab is sent as the tab closes, and anything that still didn't make it is sent the next time the tester opens the tracker.
- **Submit to Google Sheet** saves right away and stamps the *Submitted* column, so you can see who has finished. It's blocked until every Fail has a conversation ID.
- Rows are matched by name (case-insensitive), so the same name always updates the same row.
- On a new computer with no saved local results, the tracker loads that tester's existing results from the sheet.
- If the sheet can't be reached, results stay in the browser and the page says so. Click Submit again to retry.
- Screenshots upload as soon as they're added (button, drag-and-drop, or paste with Cmd/Ctrl+V while a case is open). Images larger than 2400 px are scaled down to fit Vercel's 4.5 MB upload limit. Removing a screenshot, or clearing your results, moves the files to Drive trash.
