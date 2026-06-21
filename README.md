# Roster Hub

A live, searchable NFL roster page styled after the Flight School project — but instead of a static `data.js` file, it pulls player data directly from your Google Sheet every time someone loads the page.

## How it works

The sheet **`Madden Data`** tab is read client-side using Google's public "gviz" JSON endpoint — no API key, no backend server, and no Apps Script needed. As long as the sheet is shared as **"Anyone with the link can view,"** the page will fetch it live, parse it, and render the roster grid.

It auto-refreshes every 5 minutes, and there's a manual refresh button in the top right.

## Files

- `index.html` — page structure
- `styles.css` — all styling (dark/light theme, toggle in the top right)
- `app.js` — fetches the sheet, parses rows into player objects, handles search/filter/sort and the player modal

## Sheet column mapping

The app reads the **`Madden Data`** tab using these fixed column positions (A → O):

| Col | Field | Notes |
|---|---|---|
| A | PGID | unique player id, used as the card's key |
| B | TGID | team id (not currently used for display — Team name is used instead) |
| C | POVR | Madden overall rating |
| D | PPOS | (unused) |
| E | Player Name | required — rows with no name are skipped |
| F | Jersey # | |
| G | Status | `ACT`, `PUP`, `IR`, etc. — mapped to a readable badge |
| H | Height | in inches, converted to `6'6"` format |
| I | Weight | lbs |
| J | Age | |
| K | College | |
| L | Salary | currently blank/`TDB` in your sheet — shows "Add salary" until you fill in real numbers. Once you add numeric values, it'll auto-format as `$9.88M` / `$850K` |
| M | Position | used for the Offense/Defense/Special Teams filter |
| N | Team | populates the team switcher dropdown |
| O | ESPN ID | builds the headshot image URL. Tries the NFL headshot first, falls back to the college-football headshot if that 404s, then falls back to an initials avatar if both fail. Leave blank for a player to skip straight to initials |

If you reorder or rename columns, update the index numbers in `rowsToPlayers()` in `app.js` (look for the comment `// Column order in the "Madden Data" tab`).

## Status badge mapping

`STATUS_LABELS` and `statusTier()` near the top of `app.js` control how status codes are displayed and color-coded:

- **Green** — `ACT` (Active) only
- **Amber** — `IPP` only
- **Red** — everything else (`IR`, `INJ`, `PUP`, `NFI`, `SUS`, `EXE`, or any unrecognized code)
- **No badge** — players on the **Free Agents** team always have their status treated as blank/null, regardless of what's in the sheet, so that area of the card is just empty. They're also excluded from the "Inactive" filter (and naturally don't match "Active" or "IPP" either).

`IR` and `INJ` both display as **"IR"**. Unrecognized codes fall back to showing the raw code as-is (still colored red).

The status filter chips above the grid (Any Status / Active / IPP / Inactive) follow these same rules — "Inactive" means anything that isn't `ACT` or `IPP` *and* isn't blank/Free Agent.

## Team-color card borders

Each player card gets a 3px solid border in the team's primary color (and the hover accent bar on the left edge matches too). The colors live in `TEAM_COLORS` near the top of `app.js` (built from the colors you provided) — edit that object if a team's colors ever need adjusting, or to add a team that's missing.

Free Agents (and any team not found in `TEAM_COLORS`) just get the normal neutral border.

## Filters

In addition to search, there's a **Team** dropdown, a **Position** dropdown (ordered QB, RB, FB, WR, TE, C, G, T, DT, EDGE, LB, CB, S, K, P, LS — with any other position values appended afterward alphabetically), an Offense/Defense/Special Teams group toggle, a status toggle, and a **Sort** dropdown (defaults to Jersey #). All of these combine — you can search within a position within a team, etc.

## Changing the sheet or tab

Open `app.js` and edit these two lines near the top:

```js
const SHEET_ID = '1lQapVF5-hK9l5MUoJOZJW6cDOttKazZQCRfifQhYJnQ';
const SHEET_TAB = 'Madden Data';
```

`SHEET_ID` is the long string in your sheet's URL between `/d/` and `/edit`.

## Running locally

Because the page fetches from `docs.google.com`, opening `index.html` directly by double-clicking it (a `file://` URL) can sometimes be blocked by the browser. Easiest fix — serve it locally:

```bash
cd roster-hub
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Hosting it for real

Any static host works — drag the folder into Netlify/Vercel, or push it to a GitHub repo and turn on GitHub Pages. No build step, no server, no environment variables.

## If the page shows "Couldn't load the sheet"

99% of the time this means the sheet's sharing setting isn't "Anyone with the link can view." Open the sheet → **Share** → change **General access** to **Anyone with the link** (Viewer). Then hit the refresh button on the page.
