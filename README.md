# QualiSuite eQMS

Internal electronic Quality Management System for pharmaceutical manufacturing, wholesale (GDP) and clinical supply.
Requirements: see the URS (URS-QA-eQMS-001). Architecture, security, hosting and backup: see the Technical Design.

**Version 0.1.0 – build for development and validation.** Not for productive GxP use until IQ/OQ/PQ are complete
and the Validation Summary Report is approved.

## Modules in this release

| Area | Modules |
| --- | --- |
| Documents & training | Documents (SOP, WI, policies, forms) with revisions and effectivity · Document issuance with issue stamp, replacement copies and reconciliation · Training records (auto-assigned on effectivity) · Training matrix |
| Quality events | Deviations and complaints (JRS/SOP/QAS/022) · Root cause analysis (5 Whys, fishbone) · CAPA with effectiveness check (JRS/SOP/QAS/006) · Change control with optional departmental approvals (JRS/SOP/QAS/007) · Extension requests (JRS/FRM/QAS/045) · Linked records across all of them |
| Compliance | Self-inspections with annual schedule and qualified-auditor list (JRS/SOP/QAS/004) · External audits and inspections (JRS/SOP/QAS/002, QAS/008) · Risk assessments – FMEA, S×O×D 1–5 (JRS/SOP/QAS/020) · Quarterly management review with data compiled from the eQMS (JRS/SOP/QAS/019) · Inspection readiness dashboard and inspection-pack export |
| Supply chain | Vendors (qualification, risk score) · Customers (GDP bona fides, sanctions check) |
| Clinical supply | Comparator sourcing · Secondary packaging (line clearance, label reconciliation, QP certification) · Label design and controlled printing (PDF, ZPL) · Kit randomization (seeded block lists, blinded/unblinded views, dual approval) |
| System | Users and roles · Hash-chained audit trail with integrity check, filters, CSV and printed report, quarterly audit trail review (QA and admin only) · Version history of every record with comparison · Electronic signatures · SharePoint publishing (Microsoft Graph) |

## Technology

- JavaScript, Node.js 22 LTS (≥ 22.13). **No npm dependencies** – only Node's built-in `http`, `crypto` and `sqlite`.
- Database: SQLite (`data/qms.db`) in this release; PostgreSQL 16 planned for production (release 0.3).
- Front end: HTML, CSS and plain JavaScript single-page app (`public/`). Module, field and workflow configuration in `public/modules.js`.

## Run locally (development)

```bash
git clone <repo-url> qms && cd qms
cp .env.example .env            # set HOST=127.0.0.1, COOKIE_SECURE=false for local http
npm run demo                    # starts with demo users (password Demo-Pass-2026)
# open http://localhost:8080
npm test                        # end-to-end checks: tests/e2e.mjs (core) plus quality-events, compliance, documents-training and audit-trail suites
```

Demo users (development only): `qa.lead`, `qa.reviewer`, `author1`, `cs.manager`, `stat1` (unblinded), `rp1`,
`trainer1`, `operator1`, `hod.ops` (Department Head), `pm1` (Project Manager), `director1` (Management Representative),
`inspector1` (external auditor, read-only). The `admin` account is created on first start; its password is printed once and must be changed at first sign-in.

## Deploy to Azure (internal access through your domain)

Target set-up (Technical Design section 8): private Ubuntu VM (no public IP) published at `https://qms.<your-domain>`
through **Microsoft Entra Application Proxy** (included in Entra ID P1), Conditional Access with MFA, group "eQMS Users".

1. Azure: resource group, virtual network, Ubuntu 24.04 VM without public IP, Windows Server VM for the Entra private network connector.
2. On the Ubuntu VM:
   ```bash
   sudo useradd --system --home /opt/qms --shell /usr/sbin/nologin qms
   sudo git clone <repo-url> /opt/qms && cd /opt/qms && sudo git checkout v0.1.0
   sudo cp .env.example .env && sudo nano .env       # ORG_NAME, ADMIN_INITIAL_PASSWORD, COOKIE_SECURE=true
   sudo mkdir -p data && sudo chown -R qms:qms /opt/qms && sudo chmod 600 .env
   sudo cp deploy/qms.service /etc/systemd/system/ && sudo systemctl enable --now qms
   sudo cp deploy/nginx-qms.conf /etc/nginx/sites-available/qms && sudo ln -s ../sites-available/qms /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. Entra ID: create the Application Proxy app (internal URL = the VM's private HTTPS address, external URL = `qms.<your-domain>`,
   pre-authentication = Microsoft Entra ID), upload the certificate, assign the "eQMS Users" group, enable the Conditional Access policy.
4. DNS: CNAME `qms` → the Application Proxy external URL shown in Entra.
5. Backups: install `scripts/backup.sh` in cron (`0 * * * *`), configure the `offsite` rclone remote and the `qms-backup` GPG key (Technical Design section 9).
6. Execute IQ.

Docker alternative: `docker compose up -d --build` (binds to 127.0.0.1:8080 behind Nginx).

## Git workflow (Technical Design section 10)

- `main` = validated, released code only; protected, changes by pull request with second-person review and `npm test` passing.
- Branch per change control: `cc/CC-2026-0042-short-description`.
- Release = tag (`v0.1.0`); the same tag is deployed Development → Validation → Production.
- Never commit `.env`, `data/` or backups (`.gitignore` covers them).

## Roadmap

| Release | Content |
| --- | --- |
| 0.1 (this) | All modules above on SQLite, local accounts, e-signatures, audit trail, issuance stamp, SharePoint publish |
| 0.2 | Microsoft Entra ID single sign-on (OpenID Connect) and group-to-role mapping; QR code on issue stamp; BarTender print integration |
| 0.3 | PostgreSQL 16 (Azure Flexible Server, private access); attachments to Azure Blob (immutable) |
| 0.4 | Track and trace: EPCIS 1.2/2.0 import, exceptions → deviations, suspect-product and FDA 3911 workflow, export pedigree |
| 0.5 | IRT kit-list export/import, ERP/LIMS/PV interfaces, scheduled reports |

## Known limitations of 0.1

- Sign-in is local accounts (Entra ID protects access at the Application Proxy; SSO into the app comes in 0.2).
- Attachments up to 25 MB, stored in the database.
- The issue stamp shows a verification link; a QR code is added in 0.2.
- Label printing produces PDF/ZPL; BarTender integration comes in 0.2.
