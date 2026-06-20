// ============================================================================
// intelligence.js — CoinDex Pro market intelligence dashboard
// Read-only aggregation of the Phase 3 endpoints. Every panel renders from a
// real response; unbound/empty systems render honest empty states (never faked).
// Auto-refreshes every 30s.
// ============================================================================
(() => {
  const $ = id => document.getElementById(id);
  let BASE = '', timer = null;
  try { BASE = localStorage.getItem('cdx.intel.base') || ''; } catch (e) {}
  if (BASE) $('baseUrl').value = BASE;

  $('connect').onclick = () => {
    BASE = ($('baseUrl').value || '').trim().replace(/\/$/, '');
    if (!BASE) { $('gateErr').textContent = 'Base URL required.'; return; }
    try { localStorage.setItem('cdx.intel.base', BASE); } catch (e) {}
    $('gate').classList.add('hide'); $('app').classList.remove('hide');
    start();
  };
  $('logout').onclick = () => { if (timer) clearInterval(timer); $('app').classList.add('hide'); $('gate').classList.remove('hide'); };
  $('refresh').onclick = () => poll();
  function start() { poll(); if (timer) clearInterval(timer); timer = setInterval(poll, 30000); }

  async function get(path) {
    try { const r = await fetch(BASE + path); const body = await r.json().catch(() => ({})); return { ok: r.ok, body }; }
    catch (e) { return { ok: false, body: { error: String(e) } }; }
  }

  async function poll() {
    $('appErr').textContent = '';
    const [metrics, top, vol, breadth, flows, trend] = await Promise.all([
      get('/api/metrics'), get('/api/analytics/top'), get('/api/analytics/volatility'),
      get('/api/analytics/breadth'), get('/api/flows?limit=20'), get('/api/search/trending'),
    ]);
    $('lastUpdate').textContent = 'updated ' + new Date().toLocaleTimeString();

    // ---- Market heat: breadth-weighted advancers share (0..100). ----
    const sectors = (breadth.body && breadth.body.sectors) || [];
    let heat = null;
    if (sectors.length) {
      let adv = 0, tot = 0;
      for (const s of sectors) { adv += (s.advancers || 0); tot += (s.total || 0); }
      heat = tot ? (adv / tot) * 100 : null;
    } else if (top.body && Array.isArray(top.body.gainers7d) && top.body.gainers7d.length) {
      // fallback heat proxy: share of tracked tokens with positive 7d (real data).
      const g = top.body.gainers7d; const up = g.filter(r => r.gain7d > 0).length;
      heat = g.length ? (up / g.length) * 100 : null;
    }
    if (heat != null) {
      $('heatVal').textContent = Math.round(heat) + ' / 100';
      $('heatVal').style.color = heat >= 60 ? 'var(--up)' : heat >= 40 ? 'var(--warn)' : 'var(--down)';
      $('heatMark').style.left = Math.max(0, Math.min(100, heat)) + '%';
      $('heatSub').textContent = sectors.length ? 'breadth-weighted advancers' : 'share of movers positive (7d)';
    } else {
      $('heatVal').textContent = '—'; $('heatSub').textContent = 'no breadth/movers data yet';
    }

    // ---- System metrics ----
    const M = metrics.body || {};
    if (M.totalTokensTracked != null || M.dbBound) {
      $('metricsBox').innerHTML = row('Tokens tracked', M.totalTokensTracked ?? '—')
        + row('Historical candles', M.totalHistoricalCandles ?? '—')
        + row('Active anomalies (24h)', M.activeAnomalies24h ?? '—')
        + row('Avg provider reliability', M.avgProviderReliability != null ? (M.avgProviderReliability * 100).toFixed(0) + '%' : '—')
        + row('Indexed search terms', M.indexedSearchTerms ?? '—');
    } else { $('metricsBox').innerHTML = `<div class="empty">${esc((M && M.reason) || 'metrics unavailable')}</div>`; }

    // ---- Top movers ----
    fill('#moversTable', (top.body && top.body.gainers7d) || [], r =>
      `<td>${esc(r.token_id)}</td><td class="num ${r.gain7d >= 0 ? 'up' : 'down'}">${pct(r.gain7d)}</td><td class="num mut">${pct(r.gain30d)}</td>`,
      (top.body && !top.body.available) ? (top.body.reason || 'no data') : 'no data', 3);

    // ---- Volatility ----
    fill('#volTable', (vol.body && vol.body.leaderboard) || [], r =>
      `<td>${esc(r.token_id)}</td><td class="num">${r.volatility != null ? r.volatility.toFixed(2) + '%' : '—'}</td>`,
      (vol.body && vol.body.reason) || 'no data', 2);

    // ---- Sector breadth ----
    if (sectors.length) {
      $('breadthBox').innerHTML = sectors.slice(0, 8).map(s => {
        const b = s.breadth != null ? Math.round(s.breadth * 100) : 0;
        const col = b >= 60 ? 'var(--up)' : b >= 40 ? 'var(--warn)' : 'var(--down)';
        return `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:11px"><span>${esc(s.sector)}</span><span class="num" style="color:${col}">${b}%</span></div>
          <div style="height:5px;background:var(--panel2);border-radius:3px;overflow:hidden"><div style="height:100%;width:${b}%;background:${col}"></div></div></div>`;
      }).join('');
    } else { $('breadthBox').innerHTML = `<div class="empty">${esc((breadth.body && breadth.body.reason) || 'no sector data')}</div>`; }

    // ---- Flow anomalies ----
    fill('#flowTable', (flows.body && flows.body.flows) || [], r =>
      `<td class="num mut">${time(r.created_at)}</td><td>${esc(r.token_id)}</td><td><span class="pill ${r.severity === 'critical' ? 'bad' : 'warn'}">${esc(r.type)}</span></td>`,
      (flows.body && flows.body.reason) || 'none', 3);

    // ---- Trending searches ----
    fill('#trendTable', (trend.body && trend.body.trending) || [], r =>
      `<td>${esc(r.term)}</td><td class="num">${typeof r.count === 'number' ? r.count.toFixed(1) : r.count}</td>`,
      'none yet', 2);
  }

  function fill(sel, rows, rowHtml, emptyMsg, cols) {
    const tb = document.querySelector(sel + ' tbody'); if (!tb) return;
    tb.innerHTML = '';
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="${cols}" class="empty">${esc(emptyMsg)}</td></tr>`; return; }
    for (const r of rows.slice(0, 12)) tb.insertAdjacentHTML('beforeend', '<tr>' + rowHtml(r) + '</tr>');
  }
  function row(label, val) { return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line);font-size:12px"><span class="mut">${esc(label)}</span><span class="num">${esc(val)}</span></div>`; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function pct(v) { return v != null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—'; }
  function time(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleTimeString(); } catch (e) { return '—'; } }
})();
