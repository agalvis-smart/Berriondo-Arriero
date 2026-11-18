// Shared engine for every game: class, rooms, players, realtime, cumulative scores across games.
import { supabase, ensureRoom, joinRoom, subscribeRoom, patchRoom } from "./supabase.js";
export { supabase, patchRoom };
export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const shuffle = (arr, rnd = Math.random) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export function seeded(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }

const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
const AV = ["🦊","🐼","🐸","🦄","🐙","🦁","🐯","🐵","🐧","🦉","🐢","🐳","🦋","🐝","🦖","👾"];
const T = {
  join: 'Join the class game', scan: 'Scan the QR or go to:', players: 'Players', name: 'Your name', avatar: 'Your avatar', go: 'Join',
  host: "I'm the teacher (projector)", nobody: 'Nobody yet…', reset: '↺ Reset this game',
  resetQ: "Reset this game? This round's scores and answers will be deleted (including its points in the class total) and everyone goes back to the lobby.",
  clear: '🧽 Clear names', clearQ: 'Remove all players from this game and return to the lobby?', fail: 'Could not open the room.',
  db: 'Database not ready: run setup_database.sql. ', totals: '🏅 Class total (all games)'
};

export async function boot(cfg) {
  const g = cfg.game;
  const CLASS = new URLSearchParams(location.search).get('class') || ls('hub_class') || 'CLASS-2001';
  ls('hub_class', CLASS);
  const K = { CLASS, CODE: CLASS + '-' + g.toUpperCase(), S: { room: null, players: [], items: [] }, me: null, totals: [], host: false, skew: 0, av: ls('hub_av') || AV[0], cat: cfg.cat0, T };
  K.sid = ls('hub_sid'); if (!K.sid) { K.sid = crypto.randomUUID(); ls('hub_sid', K.sid); }
  K.host = ls('hub_host_' + CLASS) === '1' || new URLSearchParams(location.search).get('host') === '1';
  const back = document.querySelector('.back'); if (back) back.href = './?class=' + encodeURIComponent(CLASS);
  const setPointer = () => supabase.from('hub_classes').upsert([{ code: CLASS, current_game: g, updated_at: new Date().toISOString() }]);

  K.st = () => K.S.room?.state || {};
  K.pTag = p => p ? `${esc(p.avatar || '🙂')} ${esc(p.name)}` : '?';
  K.remaining = () => { const e = K.st().ends_at; return e ? Math.max(0, Math.ceil((new Date(e).getTime() - (Date.now() + K.skew)) / 1000)) : 0; };
  K.fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  K.err = e => { const t = $('#err'); if (!e) { t.style.display = 'none'; return; } const m = e.message || String(e); t.textContent = (/hub_|relation|schema|42P01|42501|PGRST|foreign key/.test(m + (e.code || '')) ? T.db : '') + m; t.style.display = 'block'; };
  K.rank = extra => [...K.S.players].sort((a, b) => b.score - a.score || new Date(a.joined_at) - new Date(b.joined_at))
    .map((p, i) => `<div class="rank ${K.me && p.id === K.me.id ? 'me' : ''}"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'}</span><span>${K.pTag(p)}</span><span class="s">${p.score} pts${extra ? extra(p) : ''}</span></div>`).join('') || '<p class="muted">—</p>';
  K.clearBtn = `<button data-act="clearnames">${T.clear}</button>`;
  K.lobbyTop = () => { const link = location.origin + location.pathname + '?class=' + encodeURIComponent(CLASS); return `<div class="box"><h2>${T.join} <code>${esc(CLASS)}</code></h2><p class="muted">${T.scan}<br><b>${esc(link)}</b></p><div class="qr" id="qr"></div><h2>${T.players}</h2><div class="chips" id="plist"></div></div>`; };
  const tot = r => Object.values(r.results || {}).reduce((a, b) => a + b, 0);
  K.totalsBox = () => `<div class="box"><h2>${T.totals}</h2>${[...K.totals].sort((a, b) => tot(b) - tot(a)).map((r, i) => `<div class="rank"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'}</span><span>${esc(r.avatar || '🙂')} ${esc(r.name)}</span><span class="s">${tot(r)} pts</span></div>`).join('')}</div>`;

  let lastKey = '', prev = null, deb;
  const blank = { ends_at: null, scored: false, ...(cfg.blank || {}) };
  const joinView = () => `<div class="box"><h2>${T.join} <code>${esc(CLASS)}</code></h2><label for="nm"><b>${T.name}</b></label><input id="nm" type="text" maxlength="30" autocomplete="off" value="${esc(ls('hub_name') || '')}"><p><b>${T.avatar}</b></p><div class="avs">${AV.map(a => `<button type="button" class="av ${a === K.av ? 'on' : ''}" data-av="${a}" aria-label="${a}">${a}</button>`).join('')}</div><button class="main" data-act="join">${T.go}</button></div><p><button data-act="host">${T.host}</button></p>`;
  const view = s => {
    const body = K.host ? cfg.host(K, s) : K.me ? cfg.player(K, s) : joinView();
    const showTot = (K.host || K.me) && K.totals.length && (s === 'podium' || s === 'lobby');
    return body + (showTot ? K.totalsBox() : '') + (K.host ? `<button class="fab" data-act="reset">${T.reset}</button>` : '');
  };

  function qr() {
    const el = $('#qr'); if (!el || el.dataset.done) return;
    if (!window.QRCode) { el.textContent = '(QR unavailable: use the link)'; return; }
    el.dataset.done = '1';
    new QRCode(el, { text: location.origin + location.pathname + '?class=' + encodeURIComponent(CLASS), width: 230, height: 230, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  }
  function tick() { const t = $('#timer'); if (t) t.textContent = K.fmt(K.remaining()); cfg.tick?.(K); }
  function light() {
    const pl = $('#plist'); if (pl) pl.innerHTML = K.S.players.map(p => `<span class="chip">${K.pTag(p)}${K.host ? ` <button class="x" data-kick="${p.id}" aria-label="Remove">✕</button>` : ''}</span>`).join('') || `<i class="muted">${T.nobody}</i>`;
    const sg = $('#startgame'); if (sg) sg.disabled = K.S.players.length < 1;
    cfg.light?.(K); tick();
  }
  // Host only: when the podium is up, bank this round's scores into the class total (safe to repeat: same key = overwrite)
  async function bank() {
    const sig = K.S.players.map(p => p.id + ':' + p.score).join();
    if (sig === K.sig || !K.S.players.length) return;
    K.sig = sig;
    const { error } = await supabase.rpc('hub_bank', { p_class: CLASS, p_key: g + ':' + (K.st().ends_at || K.CODE), p_rows: K.S.players.map(p => ({ session_id: p.session_id, name: p.name, avatar: p.avatar, score: p.score })) });
    if (error) return K.err(error);
    K.refresh();
  }
  function render() {
    const R = K.S.room, app = $('#app');
    if (!R) { app.innerHTML = `<p class="muted">${T.fail}</p>`; return; }
    document.body.dataset.phase = R.status;
    const totSig = (R.status === 'podium' || R.status === 'lobby') ? K.totals.map(r => r.session_id + ':' + Object.values(r.results || {}).join('/')).join() : '';
    const k = [R.status, K.host, K.me && K.me.id, K.st().ends_at, totSig, cfg.key ? cfg.key(K) : ''].join('|');
    if (k !== lastKey) { cfg.leave?.(K, prev, R.status); lastKey = k; prev = R.status; app.innerHTML = view(R.status); qr(); }
    light();
    if (R.status === 'podium' && K.host) bank();
  }
  K.refresh = async () => {
    const [r, p, i, sc, cl] = await Promise.all([
      supabase.from('hub_rooms').select('*').eq('code', K.CODE).maybeSingle(),
      supabase.from('hub_players').select('*').eq('room_code', K.CODE).order('joined_at'),
      cfg.items ? supabase.from('hub_items').select('*').eq('room_code', K.CODE) : {},
      supabase.from('hub_scores').select('*').eq('class_code', CLASS),
      supabase.from('hub_classes').select('*').eq('code', CLASS).maybeSingle()
    ]);
    const e = r.error || p.error || i.error; if (e) return K.err(e);
    K.err(null);
    K.totals = sc.data || [];
    const cur = cl.data?.current_game;   // students follow the game the teacher opened
    if (!K.host && cur && cur !== g) { location.replace(`./${cur}.html?class=${encodeURIComponent(CLASS)}`); return; }
    K.S = { room: r.data, players: p.data || [], items: i.data || [] };
    K.me = K.S.players.find(x => x.session_id === K.sid) || null;
    if (!K.host && !K.me && K.S.room && !K.tried && ls('hub_name')) {   // returning student: join automatically
      K.tried = true;
      const { error } = await joinRoom(K.CODE, K.sid, ls('hub_name'), { avatar: ls('hub_av') || AV[0], status: 'joined' });
      if (error) return K.err(error);
      return K.refresh();
    }
    render();
  };
  const soon = () => { clearTimeout(deb); deb = setTimeout(K.refresh, 150); };

  const A = {
    async host() { ls('hub_host_' + CLASS, '1'); K.host = true; await setPointer(); lastKey = ''; K.refresh(); },
    async join() { const n = $('#nm').value.trim(); if (!n) { $('#nm').focus(); return; } ls('hub_name', n); ls('hub_av', K.av); const { error } = await joinRoom(K.CODE, K.sid, n, { avatar: K.av, status: 'joined' }); if (error) return K.err(error); K.refresh(); },
    async clearnames() { if (!confirm(T.clearQ)) return; const { error } = await supabase.from('hub_players').delete().eq('room_code', K.CODE); if (error) return K.err(error); await patchRoom(K.CODE, { status: 'lobby', ...blank }); K.sig = null; K.refresh(); },
    async reset() {
      if (!confirm(T.resetQ)) return;
      const e = K.st().ends_at; if (e) await supabase.rpc('hub_unbank', { p_class: CLASS, p_key: g + ':' + e });
      await supabase.from('hub_items').delete().eq('room_code', K.CODE);
      await supabase.from('hub_players').update({ score: 0, data: {}, status: 'joined' }).eq('room_code', K.CODE);
      await patchRoom(K.CODE, { status: 'lobby', ...blank }); K.sig = null; K.refresh();
    },
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
  if (K.host) await setPointer();
  await ensureRoom(K.CODE, g, 'lobby', cfg.init || {});
  await K.refresh();
  subscribeRoom(K.CODE, { rooms: soon, players: soon, ...(cfg.items ? { items: soon } : {}) });
  setInterval(K.refresh, 4000);
  setInterval(tick, 500);
  return K;
}
