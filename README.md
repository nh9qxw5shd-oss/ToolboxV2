[README.md](https://github.com/user-attachments/files/23289638/README.md)
# HABD WILD EM — GitHub Pages Pack

This folder is structured for **GitHub Pages** hosting.

## Files
- `index.html` — your dashboard (served at `/`).
- `.nojekyll` — disables Jekyll processing so static files are served as-is.
- `404.html` — basic redirect back to `/` if someone hits a bad path.

## Deploy to GitHub Pages
1. Create a new public repository on GitHub (e.g., `habd-wild-em`).
2. Upload these files to the repo **root** (so `index.html` sits at the top level).
3. Go to **Settings → Pages**.
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` / `/ (root)`
   - Click **Save**.
4. Your site will appear at: `https://<your-username>.github.io/<repo-name>/`.

## Data persistence (GitHub Pages is static)
GitHub Pages **cannot** run serverless functions. For saving changes, use one of:
- **Supabase** (recommended): store your `{ assets, faults }` JSON in a table and call it via the JS client.
- **Cloudflare Workers/KV**: host the API endpoint separately and point the dashboard to it.
- **Any REST API** you control.

If your current dashboard sends `GET/PUT` to `/api/state`, update the JS to point to your chosen backend endpoint, e.g.:
```js
const API = 'https://your-worker-or-supabase-endpoint.example.com/api/state';
// GET
const state = await fetch(API).then(r=>r.json());
// PUT
await fetch(API, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(state) });
```

> Tip: If you want me to wire this to Supabase for you, share the anon key + URL and I'll hand back a drop-in HTML.
