/* Dialogs, signature registration and e-signature steps. */
'use strict';
// ---------- modal ----------
function modal({ title, html, ok = 'OK', okClass = 'primary', wide = false, cancel = 'Cancel', onOk, onMount }) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    root.innerHTML = `<div class="backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">${esc(title)}</h2>
      <form class="stack" novalidate>${html}<div class="error" role="alert"></div>
      <div class="actions">${cancel ? `<button type="button" class="btn" data-x>${esc(cancel)}</button>` : ''}${ok ? `<button class="btn ${okClass}">${esc(ok)}</button>` : ''}</div></form></div></div>`;
    const form = $('form', root), err = $('.error', root);
    const close = (v) => { root.innerHTML = ''; resolve(v); };
    $('[data-x]', root)?.addEventListener('click', () => close(null));
    root.querySelector('.backdrop').addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = ''; const btn = form.querySelector('.actions .btn:last-child'); btn.disabled = true;
      try { const v = onOk ? await onOk(form) : true; close(v === undefined ? true : v); } catch (x) { err.textContent = x.message; btn.disabled = false; }
    });
    onMount && onMount(form);
    (form.querySelector('input:not([readonly]),select,textarea') || form.querySelector('.btn'))?.focus();
  });
}
const val = (form, name) => (form.elements[name] ? form.elements[name].value : '').trim();

async function ensureEsigAccepted() {
  if (ME.esigAccepted) return true;
  toast('Register your signature before you sign for the first time.');
  return registerSignature();
}
// Signature registration by the signed-in employee: initials, handwritten specimen (drawn), statement, password
async function registerSignature() {
  const ok = await modal({
    title: 'Register my signature', ok: 'Register signature', wide: true,
    html: `<p class="muted small">Register of signatures (JRS/SOP/QAS/009). Only you can register your signature. It is renewed every 5 years.</p>
      <div class="grid"><div><label class="f">Name</label><input type="text" value="${esc(ME.fullname)}" readonly></div><div><label class="f">Initials <span class="req">*</span></label><input type="text" name="initials" maxlength="6" style="text-transform:uppercase" value="${esc((USERS.find(u => u.username === ME.username) || {}).initials || '')}"></div></div>
      <div><label class="f">Signature specimen – sign in the box with the mouse, pen or finger <span class="req">*</span></label><canvas id="sigpad" class="sigpad" width="560" height="160" aria-label="Signature pad"></canvas>
      <button type="button" class="btn" id="sigclear">Clear</button></div>
      <label class="row"><input type="checkbox" name="accept"> I certify that my electronic signature in this system is the legally binding equivalent of my handwritten signature (21 CFR 11.100). I will not share my password, and I am accountable for actions initiated under my electronic signature.</label>
      <div><label class="f">Password (confirms it is you) <span class="req">*</span></label><input type="password" name="password" autocomplete="current-password"></div>`,
    onMount: (f) => {
      const c = $('#sigpad', f), g = c.getContext('2d'); let down = false, drawn = false;
      g.lineWidth = 2.2; g.lineCap = 'round'; g.strokeStyle = '#0b2a6b';
      const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
      c.addEventListener('pointerdown', (e) => { down = true; c.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pos(e)); });
      c.addEventListener('pointermove', (e) => { if (!down) return; g.lineTo(...pos(e)); g.stroke(); drawn = true; });
      ['pointerup', 'pointerleave'].forEach(ev => c.addEventListener(ev, () => { down = false; }));
      $('#sigclear', f).addEventListener('click', () => { g.clearRect(0, 0, c.width, c.height); drawn = false; });
      f._drawn = () => drawn;
    },
    onOk: async (f) => {
      if (!f._drawn()) throw new Error('Draw your signature in the box.');
      await api('POST', '/api/signature/register', { initials: val(f, 'initials'), signature: $('#sigpad', f).toDataURL('image/png'), accept: f.accept.checked, password: f.password.value });
    }
  });
  if (ok) { ME.esigAccepted = true; toast('Signature registered'); }
  return !!ok;
}
/** Dialog for a workflow step. Collects reason, extra fields and the e-signature, then calls perform(values). */
async function stepDialog({ title, meaning, reason, extra = '', perform }) {
  if (meaning && !(await ensureEsigAccepted())) return null;
  return modal({
    title, ok: meaning ? 'Sign' : 'Confirm', okClass: meaning ? 'primary sign' : 'primary',
    html: `${extra}${reason ? `<div><label class="f">Reason / comment <span class="req">*</span></label><textarea name="reason" rows="3" required></textarea></div>` : ''}
      ${meaning ? `<div class="sig-statement">By signing you apply your electronic signature with the meaning <b>${esc(meaning)}</b>. Date and time are recorded by the server (${esc(tz)}).</div>
      <div class="grid"><div><label class="f">User ID</label><input type="text" name="sigUsername" value="${esc(ME.username)}" autocomplete="username"></div>
      <div><label class="f">Password</label><input type="password" name="password" autocomplete="current-password" required></div></div>` : ''}`,
    onOk: async (f) => {
      const v = Object.fromEntries(new FormData(f));
      if (reason && !String(v.reason || '').trim()) throw new Error('Enter a reason.');
      if (meaning && !v.password) throw new Error('Enter your password to sign.');
      return perform(v);
    }
  });
}

// environment banner (APP_ENV_LABEL), e.g. on the shared test system
const envBanner = () => HEALTH.envLabel ? `<div class="env-banner" role="note">${esc(HEALTH.envLabel)}</div>` : '';

