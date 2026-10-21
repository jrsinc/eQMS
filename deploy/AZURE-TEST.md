# Shared TEST environment on Azure App Service

A public link (`https://<app-name>.azurewebsites.net`) for the team to test QualiSuite eQMS.
This is a **test system**: every page shows a "TEST SYSTEM" banner. Do not enter real GxP records, patient data or confidential client documents.

## What the script creates

| Item | Value |
| --- | --- |
| Resource group | `rg-jrs-eqms-test` |
| App Service plan | Linux, **F1 (free)** by default, or **B1** (about USD 13 / month, always on, faster) |
| Web app | Node 22 LTS, HTTPS only, startup `node server.js` |
| Data | SQLite in `/home/data` (App Service persistent storage; kept across restarts and redeployments) |
| Users | `admin` plus the demo users, with passwords generated for this environment |

F1 limits: the app sleeps after about 20 minutes without use (first page then takes a few seconds), 60 CPU minutes per day, one F1 plan per region. Use `-Sku B1` if the team finds it slow.

## Steps

1. Install the Azure CLI (once): `winget install -e --id Microsoft.AzureCLI`, then open a new terminal.
2. Sign in to the Azure subscription to use: `az login`
3. From the project folder run:
   ```
   powershell -ExecutionPolicy Bypass -File deploy\azure-test-deploy.ps1
   ```
   Options: `-Sku B1`, `-Location eastus` (or `centralindia`, `westeurope` …), `-AppName jrs-eqms-test` (must be unique in Azure).
4. The script prints the link and the path of `deploy\out\credentials-<app>.txt`.
   Share the link with the team, and the demo password **separately** (for example in Teams, not in the same e-mail).
   The admin must change the initial password at first sign-in.

## Updating and removing

- New code: run the same command again; it redeploys to the same app and keeps the test data.
- Logs: `az webapp log tail --name <app-name> --resource-group rg-jrs-eqms-test`
- Remove everything (stops all charges): `az group delete --name rg-jrs-eqms-test`

## Security notes

- Anyone with the link can reach the sign-in page. Accounts lock after 5 failed attempts and sessions end after 15 minutes idle.
- For access limited to JRS staff, add Microsoft Entra sign-in in front of the app (App Service → Authentication → add identity provider → Microsoft, "Require authentication"). This needs no code change.
- `deploy\out\` holds the generated passwords and is excluded from Git; do not commit or share the folder.
