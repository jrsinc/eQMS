/* SharePoint. */
'use strict';
// ---------- SharePoint ----------
function spView() {
  const docs = ALL.filter(r => r.type === 'documents' && r.status === 'Effective');
  shell('sharepoint', `<h1>SharePoint integration</h1>
    <div class="panel"><p>Status: ${HEALTH.sharepoint ? '<span class="pill done">Configured</span>' : '<span class="pill warn">Not configured</span>'}</p>
    <p class="muted">Effective documents are published as read-only HTML renditions, with their signatures, to the configured SharePoint library through Microsoft Graph. The eQMS stays the system of record: status, approvals and audit trail live here.</p>
    ${HEALTH.sharepoint ? '' : `<h3>Set-up</h3><ol class="small"><li>In Microsoft Entra ID, register an application and add the Microsoft Graph application permission <b>Sites.Selected</b>; grant admin consent.</li>
    <li>Grant the app write access to your QMS site only (Graph: POST /sites/{site-id}/permissions with role “write”).</li>
    <li>Find the site ID: GET https://graph.microsoft.com/v1.0/sites/{tenant}.sharepoint.com:/sites/{site-name}</li>
    <li>Set SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET, SP_SITE_ID and SP_FOLDER in the server's .env file and restart.</li></ol>`}</div>
    <h2 style="margin-top:1.5rem">Effective documents</h2>${table(docs, ['number', 'title', 'version', 'sharepointUrl', 'status'], 'No effective documents.')}`);
  bindRows();
}

