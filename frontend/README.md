# BioTicker frontend

Next.js 14 (App Router) + Tailwind CSS.

## Run locally

From the `frontend/` folder, in a separate terminal from the backend:

```powershell
# 1) Install dependencies (first time only — takes a minute)
npm install

# 2) Copy the example env file
copy .env.example .env.local

# 3) Start the dev server
npm run dev
```

Then open `http://localhost:3000`.

The frontend expects the backend to be running at
`NEXT_PUBLIC_API_URL` (default `http://localhost:8000`). Start the backend
before loading any `/company/...` page or you&apos;ll see the
"Backend unreachable" state.
