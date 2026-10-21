# Shared TEST environment on Render (from GitHub)

A public link (`https://jrs-eqms-test.onrender.com` or similar) for the team to test QualiSuite eQMS.
Every page shows a "TEST SYSTEM" banner. Do not enter real GxP records, patient data or confidential client documents.

## One-time set-up

1. Keep the GitHub repository **private** (GitHub → repository → Settings → General → Danger zone → Change visibility).
2. Sign in to [render.com](https://render.com) with your GitHub account.
3. **New** → **Blueprint** → choose the repository → Render reads `render.yaml` and shows one web service with a 1 GB disk.
4. Confirm **Apply**. Cost: Starter plan about US$7 a month plus the disk (about US$0.25 per GB a month); check Render's pricing page.
5. When the deploy shows **Live**, open the service URL.
6. Passwords: service → **Environment** → copy `DEMO_PASSWORD` (all demo users) and `ADMIN_INITIAL_PASSWORD` (user `admin`, must be changed at first sign-in).
   Share the link with the team and the demo password **separately**.

Demo users: qa.lead, qa.reviewer, author1, cs.manager, stat1, rp1, trainer1, operator1, hod.ops, pm1, director1, inspector1, docctrl1.

## Day to day

- Every push to the connected branch redeploys automatically; the test data on the disk is kept.
- Logs: service → **Logs**.
- Remove everything: service → **Settings** → **Delete web service** (the disk and its data are deleted too).

## Notes

- Changing `DEMO_PASSWORD` later does not change existing demo users; it only applies to users created afterwards.
- Anyone with the link can reach the sign-in page; accounts lock after 5 failed attempts and sessions end after 15 minutes idle.
