# BioRadar setup guide

This walks you from an empty folder to a live URL. Windows-first. All commands
go in **PowerShell** (not the old Command Prompt). You can open PowerShell
inside VS Code with **Ctrl+\`** (backtick).

---

## Part 1 — Put the project on your computer

1. Copy this entire `bioradar-starter` folder into `C:\Projects\`.
2. Rename it to `bioradar` so the path is `C:\Projects\bioradar\`.
3. Open VS Code → **File → Open Folder** → select `C:\Projects\bioradar`.
4. Open a PowerShell terminal inside VS Code (**Ctrl+\`**).

---

## Part 2 — Run the backend locally

In the VS Code terminal:

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --reload --port 8000
```

You should see `Uvicorn running on http://127.0.0.1:8000`.

Sanity check: open http://localhost:8000/docs in your browser — you'll see
the auto-generated API docs. Try the `/api/company/CRSP` endpoint.

**Leave this terminal running.** Open a second terminal for the frontend
(click the `+` in the VS Code terminal pane, or **Ctrl+Shift+\`**).

---

## Part 3 — Run the frontend locally

In the **second** terminal:

```powershell
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

First `npm install` takes 1–2 minutes. After it finishes, `npm run dev`
should say `Local: http://localhost:3000`. Open that in your browser.

You should see the BioRadar landing page. Click any example ticker
(CRSP, SRPT, etc.) and it should load a company page with real data from
your backend.

**Stop the servers any time with Ctrl+C in each terminal.**

---

## Part 4 — Push to GitHub

If it's not already initialized as a Git repo:

```powershell
cd C:\Projects\bioradar
git init
git add .
git commit -m "Initial BioRadar scaffold"
```

Go to https://github.com/new and create a new empty repo called
`bioradar`. **Don't** check any of the "initialize with..." boxes.

GitHub will show you instructions. Run the "push an existing repository"
commands it gives you, which will look like:

```powershell
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bioradar.git
git push -u origin main
```

Refresh your GitHub repo page — your code should be there.

---

## Part 5 — Deploy the backend to Render

1. Go to https://dashboard.render.com → **New +** → **Web Service**.
2. **Connect a repository** → authorize Render to access GitHub if needed,
   then select your `bioradar` repo.
3. Fill in the form:
   - **Name:** `bioradar-backend` (this becomes part of your URL)
   - **Region:** Oregon (or whichever is closest to you)
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** **Free**
4. Scroll down to **Environment Variables**. Add one:
   - Key: `FRONTEND_URL`
   - Value: `http://localhost:3000` _(we'll update this after Vercel deploys)_
5. Click **Create Web Service**. First build takes ~3 minutes.
6. Once live, copy your backend URL — something like
   `https://bioradar-backend.onrender.com`. Visit `/api/health` on it
   (`https://bioradar-backend.onrender.com/api/health`) — you should get
   `{"status":"ok"}`.

> **Render free tier:** the backend spins down after 15 minutes of
> inactivity and takes ~30 seconds to cold-start. Fine for a portfolio
> project — just know the first request after a while is slow.

---

## Part 6 — Deploy the frontend to Vercel

1. Go to https://vercel.com/new and import your GitHub `bioradar` repo.
2. In the configure screen:
   - **Framework Preset:** Next.js (auto-detected)
   - **Root Directory:** click **Edit** → select `frontend`
   - Leave the rest as defaults.
3. Expand **Environment Variables** and add:
   - Name: `NEXT_PUBLIC_API_URL`
   - Value: your Render URL from Part 5, e.g.
     `https://bioradar-backend.onrender.com`
4. Click **Deploy**. First build takes ~2 minutes.
5. When it's done, Vercel gives you a URL like
   `https://bioradar-xyz.vercel.app`. Open it — your landing page should
   load. Click a ticker; it should fetch from Render.

---

## Part 7 — Fix CORS (point backend at the real frontend)

The backend allows `*.vercel.app` by default so most things will work
immediately, but to lock it down properly:

1. In Render → your backend service → **Environment**.
2. Edit `FRONTEND_URL` and set it to your Vercel URL from Part 6
   (e.g. `https://bioradar-xyz.vercel.app`).
3. Render auto-redeploys on save (takes ~1 minute).

---

## The development loop going forward

Now that everything is wired up:

```powershell
# Edit code in VS Code
git add .
git commit -m "Describe what changed"
git push
```

That's it. GitHub push → Render rebuilds the backend → Vercel rebuilds the
frontend. You'll see both deployments update automatically within a couple
minutes.

---

## Troubleshooting

**`python` not found** — the Python installer didn't add it to PATH.
Reinstall Python from python.org and check the **"Add Python to PATH"**
box during install.

**`npm install` hangs on "idealTree building"** — probably behind a
corporate proxy. Try `npm config set registry https://registry.npmjs.org`.

**Backend returns CORS error in browser console** — check that
`NEXT_PUBLIC_API_URL` on Vercel matches your Render URL exactly (no
trailing slash), and that `FRONTEND_URL` on Render matches your Vercel
URL exactly.

**Render shows "Build failed"** — open the deploy logs and read the last
error. Most often it's a Python version mismatch; `runtime.txt` pins us
to 3.12.3 to avoid this.

**Anything else** — paste the error in chat and I'll help debug.
