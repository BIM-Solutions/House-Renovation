# Our Renovation

A phone-first planner for the house renovation: every room, every job, who's doing it,
what it'll cost and what needs buying. Built so the two of you always see the same list.

It's a **Progressive Web App (PWA)**: a website that installs onto an Android (or iPhone) home
screen, opens full-screen like a normal app, works offline, and needs no app store. There is no
build step and no server of our own to run — it's plain HTML, CSS and JavaScript hosted for free
on GitHub Pages, with optional free Google Firebase sync so both phones share one live list.

## What it does

- **Rooms** – one card per room with progress and who still has jobs there.
- **Tasks** – title, room, who (you / partner / both / tradesperson), status, priority, due date,
  estimated cost, notes.
- **Materials & tools** per task, with "already bought" ticks.
- **Shopping list** – every unbought item across all open jobs, grouped by room and job.
  Tick things off in the shop, or copy/share the whole list as text.
- **Filters** – "just my jobs", overdue, in progress, done.
- **Offline** – open it in the loft with no signal; changes sync when you're back online.
- **Backup** – export/import everything as a JSON file.

## Two ways to run it

| Mode | Shared between you? | Setup |
|---|---|---|
| **Local** (default) | No, each phone keeps its own list | None. Just open the site. Good for a quick try. |
| **Shared sync** | Yes, live on both phones | ~15 minutes, one-off, free. See below. |

## 1. Put it online (GitHub Pages)

1. Merge this into `main`.
2. In the GitHub repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` now publishes automatically (see `.github/workflows/pages.yml`).
   The site lives at `https://<your-github-user-or-org>.github.io/House-Renovation/`.

Note: the repository must be public for free GitHub Pages, or you need a GitHub Pro/Team plan.
Nothing sensitive is in the repo — the Firebase config is safe to commit (access is controlled
by the rules, not the config).

## 2. Install it on your phones

- **Android (Chrome):** open the site → ⋮ menu → **Add to Home screen** / **Install app**.
- **iPhone (Safari):** open the site → Share → **Add to Home Screen**.

## 3. Turning on shared sync

This uses Google Firebase (Firestore database + Google sign-in). The free tier is far more than
a household will ever use. Both of you sign in with the Google account already on your Android
phone, and only the two emails you list are allowed in.

1. Go to <https://console.firebase.google.com>, **Add project** (any name, e.g. `house-renovation`).
   Google Analytics can be turned off.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**, save.
   Then under **Authentication → Settings → Authorized domains**, add your GitHub Pages domain
   (e.g. `your-user.github.io`).
3. **Build → Firestore Database → Create database → Start in production mode**, pick the
   nearest region (e.g. `europe-west2` London).
4. Open **Firestore → Rules**, paste the contents of [`firestore.rules`](firestore.rules),
   **replace the two example emails with your Gmail addresses**, and **Publish**.
5. **Project settings (gear icon) → General → Your apps → Web app (`</>`)**, register it
   (no hosting needed) and copy the `firebaseConfig` block it shows.
6. Paste that block into [`js/firebase-config.js`](js/firebase-config.js) in place of
   `export const firebaseConfig = null;`, commit and push to `main`.
7. Open the app on each phone, tap **Sign in with Google**. If either phone already had tasks
   in local mode, the app offers to upload them the first time it sees an empty shared list.

If sign-in says the account isn't allowed, the email isn't in the rules from step 4.

## Updating the app

Edit the files and push to `main`. Phones pick up the new version on their next open; bump
`CACHE` in `sw.js` when you change files so offline copies refresh promptly.

## Developing locally

Any static file server works, for example:

```sh
npx http-server . -p 8080
```

then open <http://localhost:8080>. Local mode needs no accounts or internet.

## Files

```
index.html              app shell and the task / room editor sheets
css/app.css             styling (light + dark, phone-first)
js/app.js               views, navigation, editors
js/store.js             data layer: local storage or Firestore, same API
js/firebase-config.js   fill in to enable shared sync
sw.js                   offline cache
manifest.webmanifest    makes it installable
icons/                  app icon
firestore.rules         who is allowed to read/write the shared data
.github/workflows/      publishes to GitHub Pages on push to main
```
