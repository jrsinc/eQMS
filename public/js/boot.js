/* Start-up. */
'use strict';
// ---------- boot ----------
(async function boot() {
  try { HEALTH = await api('GET', '/api/health'); } catch { HEALTH = {}; }
  try { ME = await api('GET', '/api/me'); await afterLogin(); } catch { renderLogin(); }
})();
