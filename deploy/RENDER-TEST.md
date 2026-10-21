# Free DEMO environment on Render (from GitHub)

A public link (`https://jrs-eqms-test.onrender.com` or similar) for showing and trying QualiSuite eQMS.
Every page shows a "FREE DEMO SYSTEM" banner. Do not enter real GxP records, patient data or confidential client documents.

## What "free" means here

- **Data is not kept.** The free plan has no persistent disk: everything entered is wiped when the app sleeps
  (about 15 minutes without visitors), restarts or redeploys. The demo users are created again each time.
- **First page after sleeping is slow** (about 30–60 seconds while it wakes up).
- Good for a demo session; for testing over several days use the paid Starter plan with a disk (see `render.yaml`).

## One-time set-up

1. Keep the GitHub repository **private** (GitHub → repository → Settings → General → Danger zone → Change visibility).
2. Sign in to [render.com](https://render.com) with your GitHub account.
3. **+ New** → **Blueprint** (or open `https://dashboard.render.com/select-repo?type=blueprint`).
4. Connect **jrsinc/eQMS** (if it is not listed: **Configure GitHub** → organization **jrsinc** → only **eQMS**). Branch **main**.
5. Render shows one web service on the **Free** plan → **Apply**. No payment card is needed for the free plan.
6. When the service shows **Live**, open its URL.
7. Passwords: service → **Environment** → reveal `DEMO_PASSWORD` (all demo users) and `ADMIN_INITIAL_PASSWORD` (user `admin`).
   Share the link with the team and the demo password **separately**.

Demo users: qa.lead, qa.reviewer, author1, cs.manager, stat1, rp1, trainer1, operator1, hod.ops, pm1, director1, inspector1, docctrl1.

## Before a demo

- Open the link a minute early so the app is awake.
- Prepare any example records at the start of the session: they disappear after the app sleeps.
- After a reset, `admin` signs in with `ADMIN_INITIAL_PASSWORD` again and is asked for a new password again.

## Day to day

- Every push to `main` redeploys automatically (and resets the data).
- Logs: service → **Logs**.
- Remove: service → **Settings** → **Delete web service**.
