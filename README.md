# Gym Tracker

A personal PWA for progressive overload (double progression) and calorie/macro tracking.
It works offline, and all data stays on your phone. See [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

## Run on this PC
```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```
Then open http://localhost:8080.

## Put it on your phone (free, ~2 minutes)
The service worker needs HTTPS, so host the folder on a free static host:

**Option A: Netlify Drop (no account needed to try)**
1. Go to https://app.netlify.com/drop and drag the `gym-tracker` folder onto the page.
2. Open the URL it gives you on your phone. Claim the site with a free account, or it expires.

**Option B: GitHub Pages**
1. Create a repo, push this folder's contents to it.
2. Repo → Settings → Pages → Deploy from branch `main` / root.
3. Open `https://<you>.github.io/<repo>/` on your phone.

Then add it to your home screen:
- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ → *Install app* / *Add to Home screen*

## Updating
After you change any file, bump `VERSION` in `sw.js` (e.g. `gym-v2`) and redeploy. The phone picks up the new version on the next launch while online.

## Backups
Data lives only in that phone's browser storage. Use **Settings → Export backup** now and then, and keep the file somewhere safe.
Note that the URL is part of the storage: if you move to a different host or URL, export first and import there.

## How the suggestions work
Each exercise has a rep range (e.g. 8–12), a number of sets, and a weight step.
- Hit the **top of the range on every set** → next time: **+step**, reps reset to the bottom.
- Otherwise → **same weight, +1 rep per set** (capped at the top).
- Tap ✓ on an empty set to log the suggested numbers as they are.
