// Shared engine for every game: room, players, realtime, join screen, lobby, reset.
import { supabase, ensureRoom, joinRoom, subscribeRoom, patchRoom, roomCodeFromUrl } from "./supabase.js";
export { supabase, patchRoom };
export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const shuffle = (arr, rnd = Math.random) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export function seeded(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }

const AV = ["🦊","🐼","🐸","🦄","🐙","🦁","🐯","🐵","🐧","🦉","🐢","🐳","🦋","🐝","🦖","👾"];
const TXT = {
  en: { join: 'Join room', scan: 'Scan the QR or go to:', players: 'Players', name: 'Your name', avatar: 'Your avatar', go: 'Join', host: "I'm the host (projector)", nobody: 'Nobody yet…', reset: '↺ Reset game', resetQ: 'Reset the whole game? Scores and answers will be deleted and everyone goes back to the lobby.', clear: '🧽 Clear names', clearQ: 'Remove all players and return to the lobby?', fail: 'Could not open the room.', db: 'Database not ready: run setup_database.sql. ' },
  es: { join: 'Entrar a la sala', scan: 'Escanea el QR o entra a:', players: 'Jugadores', name: 'Tu nombre', avatar: 'Tu avatar', go: 'Entrar', host: 'Soy el profesor (proyector)', nobody: 'Nadie todavía…', reset: '↺ Reiniciar juego', resetQ: '¿Reiniciar todo el juego? Se borrarán puntajes y respuestas y todos vuelven al lobby.', clear: '🧽 Limpiar nombres', clearQ: '¿Quitar a todos los jugadores y volver al lobby?', fail: 'No se pudo abrir la sala.', db: 'Base de datos no lista: ejecuta setup_database.sql. ' }
};

export async function boot(cfg) {
  const T = TXT[cfg.ui || 'en'], g = cfg.game;
  const K = { CODE: roomCodeFromUrl(cfg.room), S: { room: null, players: [], items: [] }, me: null, host: false, skew: 0, av: AV[0], cat: cfg.cat0, T };
  try { K.sid = localStorage.getItem(g + '_sid'); if (!K.sid) { K.sid = crypto.randomUUID(); localStorage.setItem(g + '_sid', K.sid); } } catch { K.sid = crypto.randomUUID(); }
  try { K.host = localStorage.getItem(g + '_host_' + K.CODE) === '1' || new URLSearchParams(location.search).get('host') === '1'; } catch {}
  K.st = () => K.S.room?.state || {};
  K.pTag = p => p ? `${esc(p.avatar || '🙂')} ${esc(p.name)}` : '?';
  K.remaining = () => { const e = K.st().ends_at; return e ? Math.max(0, Math.ceil((new Date(e).getTime() - (Date.now() + K.skew)) / 1000)) : 0; };
  K.fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  K.err = e => { const t = $('#err'); if (!e) { t.style.display = 'none'; return; } const m = e.message || String(e); t.textContent = (/hub_|relation|schema|42P01|42501|PGRST|foreign key/.test(m + (e.code || '')) ? T.db : '') + m; t.style.display = 'block'; };
  K.rank = extra => [...K.S.players].sort((a, b) => b.score - a.score || new Date(a.joined_at) - new Date(b.joined_at))
    .map((p, i) => `<div class="rank ${K.me && p.id === K.me.id ? 'me' : ''}"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'}</span><span>${K.pTag(p)}</span><span class="s">${p.score} pts${extra ? extra(p) : ''}</span></div>`).join('') || '<p class="muted">—</p>';
  K.clearBtn = `<button data-act="clearnames">${T.clear}</button>`;
  K.lobbyTop = () => { const link = location.origin + location.pathname + '?room=' + encodeURIComponent(K.CODE); return `<div class="box"><h2>${T.join} <code>${esc(K.CODE)}</code></h2><p class="muted">${T.scan}<br><b>${esc(link)}</b></p><div class="qr" id="qr"></div><h2>${T.players}</h2><div class="chips" id="plist"></div></div>`; };

  let lastKey = '', prev = null, deb;
  const blank = { ends_at: null, scored: false, ...(cfg.blank || {}) };
  const joinView = () => `<div class="box"><h2>${T.join} <code>${esc(K.CODE)}</code></h2><label for="nm"><b>${T.name}</b></label><input id="nm" type="text" maxlength="30" autocomplete="off"><p><b>${T.avatar}</b></p><div class="avs">${AV.map(a => `<button type="button" class="av ${a === K.av ? 'on' : ''}" data-av="${a}" aria-label="${a}">${a}</button>`).join('')}</div><button class="main" data-act="join">${T.go}</button></div><p><button data-act="host">${T.host}</button></p>`;
  const view = s => K.host ? cfg.host(K, s) + `<button class="fab" data-act="reset">${T.reset}</button>` : K.me ? cfg.player(K, s) : joinView();

  function qr() {
    const el = $('#qr'); if (!el || el.dataset.done) return;
    if (!window.QRCode) { el.textContent = '(QR no disponible / unavailable)'; return; }
    el.dataset.done = '1';
    new QRCode(el, { text: location.origin + location.pathname + '?room=' + encodeURIComponent(K.CODE), width: 230, height: 230, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  }
  function tick() { const t = $('#timer'); if (t) t.textContent = K.fmt(K.remaining()); cfg.tick?.(K); }
  function light() {
    const pl = $('#plist'); if (pl) pl.innerHTML = K.S.players.map(p => `<span class="chip">${K.pTag(p)}${K.host ? ` <button class="x" data-kick="${p.id}" aria-label="x">✕</button>` : ''}</span>`).join('') || `<i class="muted">${T.nobody}</i>`;
    const sg = $('#startgame'); if (sg) sg.disabled = K.S.players.length < 1;
    cfg.light?.(K); tick();
  }
  function render() {
    const R = K.S.room, app = $('#app');
    if (!R) { app.innerHTML = `<p class="muted">${T.fail}</p>`; return; }
    document.body.dataset.phase = R.status;
    const k = [R.status, K.host, K.me && K.me.id, K.st().ends_at, cfg.key ? cfg.key(K) : ''].join('|');
    if (k !== lastKey) { cfg.leave?.(K, prev, R.status); lastKey = k; prev = R.status; app.innerHTML = view(R.status); qr(); }
    light();
  }
  K.refresh = async () => {
    const [r, p, i] = await Promise.all([
      supabase.from('hub_rooms').select('*').eq('code', K.CODE).maybeSingle(),
      supabase.from('hub_players').select('*').eq('room_code', K.CODE).order('joined_at'),
      cfg.items ? supabase.from('hub_items').select('*').eq('room_code', K.CODE) : {}
    ]);
    const e = r.error || p.error || i.error; if (e) return K.err(e);
    K.err(null);
    K.S = { room: r.data, players: p.data || [], items: i.data || [] };
    K.me = K.S.players.find(x => x.session_id === K.sid) || null;
    render();
  };
  const soon = () => { clearTimeout(deb); deb = setTimeout(K.refresh, 150); };

  const A = {
    host() { try { localStorage.setItem(g + '_host_' + K.CODE, '1'); } catch {} K.host = true; lastKey = ''; render(); },
    async join() { const n = $('#nm').value.trim(); if (!n) { $('#nm').focus(); return; } const { error } = await joinRoom(K.CODE, K.sid, n, { avatar: K.av, status: 'joined' }); if (error) return K.err(error); K.refresh(); },
    async clearnames() { if (!confirm(T.clearQ)) return; const { error } = await supabase.from('hub_players').delete().eq('room_code', K.CODE); if (error) return K.err(error); await patchRoom(K.CODE, { status: 'lobby', ...blank }); K.refresh(); },
    async reset() { if (!confirm(T.resetQ)) return; await supabase.from('hub_items').delete().eq('room_code', K.CODE); await supabase.from('hub_players').update({ score: 0, data: {}, status: 'joined' }).eq('room_code', K.CODE); await patchRoom(K.CODE, { status: 'lobby', ...blank }); K.refresh(); },
    ...(cfg.actions ? cfg.actions(K) : {})
  };
  document.addEventListener('click', async e => {
    const av = e.target.closest('[data-av]'); if (av) { K.av = av.dataset.av; document.querySelectorAll('.av').forEach(b => b.classList.toggle('on', b === av)); return; }
    const ct = e.target.closest('[data-cat]'); if (ct) { K.cat = ct.dataset.cat; document.querySelectorAll('.tile').forEach(b => b.classList.toggle('on', b === ct)); return; }
    const kk = e.target.closest('[data-kick]'); if (kk) { kk.disabled = true; const { error } = await supabase.from('hub_players').delete().eq('id', kk.dataset.kick); if (error) K.err(error); K.refresh(); return; }
    if (cfg.click && await cfg.click(e, K)) return;
    const a = e.target.closest('[data-act]');
    if (a && A[a.dataset.act]) { a.disabled = true; try { await A[a.dataset.act](a); } finally { a.disabled = false; } }
  });

  try { const t0 = Date.now(); const { data } = await supabase.rpc('hub_now'); if (data) K.skew = new Date(data).getTime() - (t0 + Date.now()) / 2; } catch {}
  await ensureRoom(K.CODE, g, 'lobby', cfg.init || {});
  await K.refresh();
  subscribeRoom(K.CODE, { rooms: soon, players: soon, ...(cfg.items ? { items: soon } : {}) });
  setInterval(K.refresh, 4000);
  setInterval(tick, 500);
  return K;
}
