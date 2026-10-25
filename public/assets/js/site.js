import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';

document.getElementById('year').textContent = new Date().getFullYear();

const form = document.getElementById('waitlist-form');
const msg = document.getElementById('wl-msg');

function showMsg(text, ok) {
  msg.textContent = text;
  msg.className = 'form-msg ' + (ok ? 'ok' : 'err');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const email = String(data.get('email') || '').trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMsg('Unesite ispravnu email adresu.', false);
  if (!data.get('consent')) return showMsg('Potrebna je vaša saglasnost da bismo vam poslali obaveštenje.', false);
  if (!SUPABASE_URL) return showMsg('Lista čekanja još nije povezana sa bazom.', false);

  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ email, platform: data.get('platform'), consent: true }),
    });
    // 409 = email je već na listi, što je za korisnika isto kao uspeh.
    if (!res.ok && res.status !== 409) throw new Error('HTTP ' + res.status);
    form.reset();
    showMsg('Hvala! Javićemo vam čim mobilna aplikacija bude dostupna.', true);
  } catch {
    showMsg('Došlo je do greške. Pokušajte ponovo za nekoliko trenutaka.', false);
  } finally {
    button.disabled = false;
  }
});
