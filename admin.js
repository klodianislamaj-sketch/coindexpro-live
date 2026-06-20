// ============================================================================
// admin.js — CoinDex Pro admin monitor
// Polls the worker endpoints every 30s. ADMIN_KEY is sent as x-admin-key on
// requests that require it. No fabricated data — every panel reflects a real
// response, and missing/unbound systems render honestly.
// ============================================================================
(() => {
  const $ = id => document.getElementById(id);
  let BASE = '', KEY = '', timer = null;

  // restore prior session (localStorage is fine here: standalone Pages file)
  try { BASE = localStorage.getItem('cdx.admin.base') || ''; KEY = localStorage.getItem('cdx.admin.key') || ''; } catch (e) {}
  if (BASE) $('baseUrl').value = BASE;
  if (KEY) $('adminKey').value = KEY;

  $('connect').onclick = () => {
    BASE = ($('baseUrl').value || '').trim().replace(/\/$/, '');
    KEY = ($('adminKey').value || '').trim();
    if (!BASE) { $('gateErr').textContent = 'Base URL required.'; return; }
    try { localStorage.setItem('cdx.admin.base', BASE); localStorage.setItem('cdx.admin.key', KEY); } catch (e) {}
    $('gate').classList.add('hide'); $('app').classList.remove('hide');
    startPolling();
  };
  $('logout').onclick = () => {
    if (timer) clearInterval(timer);
    try { localStorage.removeItem('cdx.admin.key'); } catch (e) {}
    $('app').classList.add('hide'); $('gate').classList.remove('hide');
  };
  $('refresh').onclick = () => poll();

  function startPolling() { poll(); if (timer) clearInterval(timer); timer = setInterval(poll, 30000); }

  async function get(path, withKey) {
    const headers = {};
    if (withKey && KEY) headers['x-admin-key'] = KEY;
    const t0 = Date.now();
    try {
      const r = await fetch(BASE + path, { headers });
      const body = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, body, latency: Date.now() - t0 };
    } catch (e) { return { ok: false, status: 0, body: { error: String(e) }, latency: Date.now() - t0 }; }
  }

  function dot(el, state) { el.className = 'dot ' + (state === true ? 'ok' : state === false ? 'bad' : 'unk'); }
  function fmtTime(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleTimeString(); } catch (e) { return '—'; } }

  async function poll() {
    $('appErr').textContent = '';
    const [root, db, cache, prov, anom, bf] = await Promise.all([
      get('/'), get('/api/health/db'), get('/api/health/cache'),
      get('/api/providers/health'), get('/api/anomalies?limit=50'), get('/api/backfill/status'),
    ]);
    // new Phase 3C panels — these may live on separate workers; failures render honestly.
    const [topA, volA, flows, trend, metrics, insights, conviction, execution, allocation, learning, strategy] = await Promise.all([
      get('/api/analytics/top'), get('/api/analytics/volatility'),
      get('/api/flows?limit=20'), get('/api/search/trending'),
      get('/api/metrics'), get('/api/search/insights'), get('/api/conviction?limit=300'),
      get('/api/execution?limit=300'), get('/api/allocation?limit=300'), get('/api/learning'),
      get('/api/strategy?limit=300'),
    ]);
    $('lastUpdate').textContent = 'updated ' + new Date().toLocaleTimeString();

    // ---- Phase 3D metrics summary ----
    const M = metrics.body || {};
    $('mTokens').textContent = M.totalTokensTracked != null ? M.totalTokensTracked : '—';
    $('mCandles').textContent = M.totalHistoricalCandles != null ? M.totalHistoricalCandles + ' candles' : '';
    $('mAnom24').textContent = M.activeAnomalies24h != null ? M.activeAnomalies24h : '—';
    $('mRel').textContent = M.avgProviderReliability != null ? (M.avgProviderReliability * 100).toFixed(0) + '%' : '—';
    $('mTerms').textContent = M.indexedSearchTerms != null ? M.indexedSearchTerms + ' search terms' : '';

    // ---- API / ingest ----
    const apiUp = root.ok && root.body && root.body.ok;
    dot($('d-api'), apiUp);
    $('ingestState').textContent = apiUp ? 'Online' : 'Down';
    $('ingestState').style.color = apiUp ? 'var(--up)' : 'var(--down)';
    $('ingestSub').textContent = root.body && root.body.upstreams ? (root.body.upstreams.length + ' upstreams') : '';

    // ---- DB ----
    const dbOk = db.body && db.body.ok, dbBound = db.body && db.body.bound;
    dot($('d-db'), dbBound ? dbOk : null);
    $('dbState').textContent = !dbBound ? 'Unbound' : dbOk ? 'Healthy' : 'Error';
    $('dbState').style.color = !dbBound ? 'var(--mut)' : dbOk ? 'var(--up)' : 'var(--down)';
    $('dbSub').textContent = db.body && db.body.note ? db.body.note : '';

    // ---- Cache ----
    const cOk = cache.body && cache.body.ok, cBound = cache.body && cache.body.bound;
    dot($('d-cache'), cBound ? cOk : null);
    $('cacheState').textContent = !cBound ? 'Unbound' : cOk ? 'Healthy' : 'Error';
    $('cacheState').style.color = !cBound ? 'var(--mut)' : cOk ? 'var(--up)' : 'var(--down)';
    $('cacheSub').textContent = cache.body && cache.body.note ? cache.body.note : '';

    // ---- Providers ----
    const ptb = document.querySelector('#provTable tbody'); ptb.innerHTML = '';
    const providers = (prov.body && prov.body.providers) || [];
    if (!providers.length) ptb.innerHTML = '<tr><td colspan="6" class="mut">' + ((prov.body && prov.body.reason) || 'no data yet') + '</td></tr>';
    for (const p of providers) {
      const rel = p.reliability != null ? p.reliability : 0;
      const cls = rel >= 0.8 ? 'ok' : rel >= 0.5 ? 'warn' : 'bad';
      ptb.insertAdjacentHTML('beforeend',
        `<tr><td>${esc(p.provider)}</td>
         <td class="num">${pct(p.success_rate)}</td>
         <td class="num">${p.avg_latency != null ? Math.round(p.avg_latency) + 'ms' : '—'}</td>
         <td class="num">${p.rate_limit_hits ?? 0}</td>
         <td class="num">${pct(p.integrity_score)}</td>
         <td><span class="pill ${cls}">${(rel * 100).toFixed(0)}%</span></td></tr>`);
    }

    // ---- Anomalies ----
    const anomalies = (anom.body && anom.body.anomalies) || [];
    $('anomCount').textContent = anomalies.length;
    const atb = document.querySelector('#anomTable tbody'); atb.innerHTML = '';
    if (!anomalies.length) atb.innerHTML = '<tr><td colspan="4" class="mut">' + ((anom.body && anom.body.reason) || 'none') + '</td></tr>';
    for (const a of anomalies.slice(0, 30)) {
      const sevCls = a.severity === 'critical' ? 'bad' : a.severity === 'warn' ? 'warn' : 'ok';
      atb.insertAdjacentHTML('beforeend',
        `<tr><td class="num mut">${fmtTime(a.created_at)}</td>
         <td>${esc(a.token_id || '—')}</td>
         <td>${esc(a.type)}</td>
         <td><span class="pill ${sevCls}">${esc(a.severity)}</span></td></tr>`);
    }

    // ---- Backfill ----
    if (bf.body && bf.body.totalTokens != null) {
      const done = bf.body.processedTokens || 0, total = bf.body.totalTokens || 0;
      const pctDone = total ? Math.round(done / total * 100) : 0;
      $('bfPct').textContent = pctDone + '%';
      $('bfSub').textContent = `${done}/${total} tokens · ${bf.body.candleRows != null ? bf.body.candleRows + ' candle rows' : ''}${bf.body.enabled ? '' : ' · disabled'}`;
    } else {
      $('bfPct').textContent = '—';
      $('bfSub').textContent = (bf.body && bf.body.reason) || 'no status';
    }

    // ---- Top gainers ----
    fillTable('#gainersTable', (topA.body && topA.body.gainers7d) || [], r =>
      `<td>${esc(r.token_id)}</td><td class="num ${r.gain7d >= 0 ? '' : ''}" style="color:${r.gain7d >= 0 ? 'var(--up)' : 'var(--down)'}">${fmtPct(r.gain7d)}</td><td class="num mut">${fmtPct(r.gain30d)}</td>`,
      (topA.body && !topA.body.available) ? (topA.body.reason || 'no data') : 'no data', 3);

    // ---- Volatility ----
    fillTable('#volTable', (volA.body && volA.body.leaderboard) || [], r =>
      `<td>${esc(r.token_id)}</td><td class="num">${r.volatility != null ? r.volatility.toFixed(2) + '%' : '—'}</td>`,
      (volA.body && volA.body.reason) || 'no data', 2);

    // ---- Flow alerts ----
    fillTable('#flowTable', (flows.body && flows.body.flows) || [], r =>
      `<td class="num mut">${fmtTime(r.created_at)}</td><td>${esc(r.token_id)}</td><td>${esc(r.type)}</td>`,
      (flows.body && flows.body.reason) || 'none', 3);

    // ---- Trending searches ----
    fillTable('#trendTable', (trend.body && trend.body.trending) || [], r =>
      `<td>${esc(r.term)}</td><td class="num">${typeof r.count === 'number' ? r.count.toFixed(1) : r.count}</td>`,
      'none yet', 2);

    // ---- Provider drift (from anomalies, subtype provider_drift) ----
    const driftRows = ((anom.body && anom.body.anomalies) || []).filter(a => a.type === 'provider_drift');
    fillTable('#driftTable', driftRows, r => {
      const d = r.details || {};
      return `<td class="num mut">${fmtTime(r.created_at)}</td><td>${esc(d.provider || '—')}</td><td class="num" style="color:var(--down)">${d.drop != null ? '-' + (d.drop * 100).toFixed(0) + '%' : '—'}</td>`;
    }, 'none', 3);

    // ---- Search insights ----
    fillTable('#risingTable', (insights.body && insights.body.fastestRising) || [], r =>
      `<td>${esc(r.term)}</td><td class="num" style="color:var(--up)">+${typeof r.delta === 'number' ? r.delta.toFixed(1) : r.delta}</td>`,
      (insights.body && insights.body.reason) || 'none', 2);
    fillTable('#deadTable', ((insights.body && insights.body.deadSearches) || []).map(t => ({ term: t })), r =>
      `<td class="mut">${esc(r.term)}</td>`, 'none', 1);

    // ---- Phase 4A polish: worker latency summary + uptime + stale-cache warning ----
    const lat = [
      ['API', root.latency, root.ok], ['DB', db.latency, db.body && db.body.bound],
      ['Cache', cache.latency, cache.body && cache.body.bound], ['Providers', prov.latency, prov.ok],
      ['Analytics', topA.latency, topA.ok], ['Flows', flows.latency, flows.ok],
    ];
    $('latencyBox').innerHTML = lat.map(([name, ms, up]) => {
      const cls = ms == null ? 'unk' : ms < 400 ? 'ok' : ms < 1200 ? 'warn' : 'bad';
      const dotc = up ? 'ok' : 'bad';
      return `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:12px">
        <span><span class="dot ${dotc}"></span>${name}</span>
        <span class="num"><span class="pill ${cls}">${ms != null ? ms + 'ms' : '—'}</span></span></div>`;
    }).join('');

    // stale-cache warning: metrics/analytics carry a generatedAt — flag if old.
    const genAt = (topA.body && topA.body.generatedAt) || (M && M.generatedAt);
    if (genAt && (Date.now() - genAt) > 600000) {
      $('cacheSub').textContent = 'WARNING: cached data >10min old';
      $('cacheState').style.color = 'var(--warn)';
    }

    // provider drift badges: mark providers with a recent provider_drift anomaly.
    const driftProviders = new Set(((anom.body && anom.body.anomalies) || [])
      .filter(a => a.type === 'provider_drift').map(a => (a.details && a.details.provider) || null).filter(Boolean));
    document.querySelectorAll('#provTable tbody tr').forEach(tr => {
      const name = tr.firstElementChild && tr.firstElementChild.textContent;
      if (name && driftProviders.has(name) && !tr.querySelector('.drift-badge')) {
        tr.firstElementChild.insertAdjacentHTML('beforeend', ' <span class="pill bad drift-badge">drift</span>');
      }
    });

    // ---- Phase 5B: conviction distribution + movers + decay alerts ----
    const cScores = (conviction.body && conviction.body.scores) || [];
    if (conviction.body && conviction.body.available === false) {
      $('convDist').innerHTML = '<div class="mut">conviction worker unavailable</div>';
    } else if (!cScores.length) {
      $('convDist').innerHTML = '<div class="mut">no conviction data yet</div>';
    } else {
      // distribution buckets 0-39 / 40-69 / 70-100
      const buckets = [0, 0, 0];
      cScores.forEach(s => { buckets[s.score >= 70 ? 2 : s.score >= 40 ? 1 : 0]++; });
      const tot = cScores.length;
      const bar = (label, n, col) => `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:11px"><span>${label}</span><span class="num">${n}</span></div>
        <div style="height:6px;background:var(--panel2);border-radius:3px;overflow:hidden"><div style="height:100%;width:${tot ? (n / tot * 100) : 0}%;background:${col}"></div></div></div>`;
      $('convDist').innerHTML = bar('Low (0–39)', buckets[0], 'var(--down)') + bar('Mid (40–69)', buckets[1], 'var(--warn)') + bar('High (70–100)', buckets[2], 'var(--up)');
    }
    fillTable('#convMovers', [...cScores].sort((a, b) => b.score - a.score).slice(0, 12), s =>
      `<td>${esc(s.token_id)}</td><td class="num" style="color:${s.score >= 70 ? 'var(--up)' : s.score >= 40 ? 'var(--warn)' : 'var(--down)'}">${s.score}</td>`,
      (conviction.body && conviction.body.reason) || 'no data', 2);
    // decay alerts from existing anomalies table (subtype conviction_decay)
    const decayRows = ((anom.body && anom.body.anomalies) || []).filter(a => a.type === 'conviction_decay');
    fillTable('#convDecay', decayRows, r => { const d = r.details || {};
      return `<td class="num mut">${fmtTime(r.created_at)}</td><td>${esc(r.token_id)}</td><td class="num" style="color:var(--down)">-${d.drop != null ? d.drop : '—'}</td>`;
    }, 'none', 3);

    // ---- Phase 5C: execution action distribution + best R:R + failed plans ----
    const ePlans = (execution.body && execution.body.plans) || [];
    if (execution.body && execution.body.available === false) {
      $('execDist').innerHTML = '<div class="mut">execution worker unavailable</div>';
    } else if (!ePlans.length) {
      $('execDist').innerHTML = '<div class="mut">no execution plans yet</div>';
    } else {
      const acts = { BUY: 0, WATCH: 0, REDUCE: 0, EXIT: 0 };
      ePlans.forEach(p => { const a = (p.plan || p).action; if (a in acts) acts[a]++; });
      const tot = ePlans.length;
      const colOf = { BUY: 'var(--up)', WATCH: 'var(--acc)', REDUCE: 'var(--warn)', EXIT: 'var(--down)' };
      $('execDist').innerHTML = Object.entries(acts).map(([a, n]) =>
        `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:11px"><span>${a}</span><span class="num">${n}</span></div>
        <div style="height:6px;background:var(--panel2);border-radius:3px;overflow:hidden"><div style="height:100%;width:${tot ? (n / tot * 100) : 0}%;background:${colOf[a]}"></div></div></div>`).join('');
    }
    fillTable('#execRR', [...ePlans].map(p => ({ p, pl: p.plan || p })).filter(x => x.pl.risk_reward != null).sort((a, b) => b.pl.risk_reward - a.pl.risk_reward).slice(0, 12), x =>
      `<td>${esc(x.p.token_id)}</td><td>${esc(x.pl.action)}</td><td class="num" style="color:var(--up)">1:${x.pl.risk_reward}</td>`,
      (execution.body && execution.body.reason) || 'no data', 3);
    // failed plans from anomalies (subtype execution_fail)
    const failRows = ((anom.body && anom.body.anomalies) || []).filter(a => a.type === 'execution_fail');
    fillTable('#execFail', failRows, r => { const d = r.details || {};
      return `<td class="num mut">${fmtTime(r.created_at)}</td><td>${esc(r.token_id)}</td><td class="mut">${esc(d.reason || 'invalidated before T1')}</td>`;
    }, 'none', 3);

    // ---- Phase 6: allocation distribution + capital + risk concentration + heat ----
    const aPlans = ((allocation.body && allocation.body.allocations) || []).map(a => ({ token_id: a.token_id, created_at: a.created_at, ...(a.allocation || a) }));
    if (allocation.body && allocation.body.available === false) {
      $('allocDist').innerHTML = '<div class="mut">allocation worker unavailable</div>';
      $('allocCap').innerHTML = '<div class="mut">unavailable</div>';
    } else if (!aPlans.length) {
      $('allocDist').innerHTML = '<div class="mut">no allocations yet</div>';
      $('allocCap').innerHTML = '<div class="mut">no allocations yet</div>';
    } else {
      const acts = { ALLOCATE: 0, HOLD: 0, SCALE_DOWN: 0, CLOSE: 0 };
      aPlans.forEach(a => { if (a.action in acts) acts[a.action]++; });
      const tot = aPlans.length;
      const colOf = { ALLOCATE: 'var(--up)', HOLD: 'var(--acc)', SCALE_DOWN: 'var(--warn)', CLOSE: 'var(--down)' };
      $('allocDist').innerHTML = Object.entries(acts).map(([a, n]) =>
        `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:11px"><span>${a}</span><span class="num">${n}</span></div>
        <div style="height:6px;background:var(--panel2);border-radius:3px;overflow:hidden"><div style="height:100%;width:${tot ? (n / tot * 100) : 0}%;background:${colOf[a]}"></div></div></div>`).join('');
      const totalCap = aPlans.reduce((s, a) => s + (a.capital || 0), 0);
      const totalRisk = aPlans.reduce((s, a) => s + (a.risk_percent || 0), 0);
      $('allocCap').innerHTML = `<div class="row"><span class="mut">Total capital</span><span class="num">$${Math.round(totalCap).toLocaleString()}</span></div>
        <div class="row"><span class="mut">Total open risk</span><span class="num" style="color:${totalRisk > 20 ? 'var(--down)' : 'var(--up)'}">${totalRisk.toFixed(1)}%</span></div>
        <div class="row"><span class="mut">Avg heat</span><span class="num">${Math.round(aPlans.reduce((s, a) => s + (a.heat_score || 0), 0) / aPlans.length)}</span></div>`;
    }
    fillTable('#allocRisk', [...aPlans].sort((a, b) => (b.position_size || 0) - (a.position_size || 0)).slice(0, 12), a =>
      `<td>${esc(a.token_id)}</td><td class="num">${a.position_size != null ? a.position_size + '%' : '—'}</td><td class="num" style="color:${a.heat_score >= 70 ? 'var(--down)' : a.heat_score >= 40 ? 'var(--warn)' : 'var(--up)'}">${a.heat_score ?? '—'}</td>`,
      (allocation.body && allocation.body.reason) || 'no data', 3);
    // heat anomalies from anomalies table (subtype allocation_fail)
    const heatRows = ((anom.body && anom.body.anomalies) || []).filter(a => a.type === 'allocation_fail');
    fillTable('#allocHeat', heatRows, r => { const d = r.details || {};
      return `<td class="num mut">${fmtTime(r.created_at)}</td><td>${esc(r.token_id)}</td><td class="mut">${esc(d.reason || 'heat/risk breach')}</td>`;
    }, 'none', 3);

    // ---- Phase 7: learning performance + best/worst setups + failure clusters ----
    const L = learning.body || {};
    if (L.available === false) { $('learnPerf').innerHTML = '<div class="mut">learning worker unavailable</div>'; }
    else if (L.empty || !L.sample) { $('learnPerf').innerHTML = '<div class="mut">no trade history yet</div>'; }
    else {
      $('learnPerf').innerHTML = `<div class="row"><span class="mut">Overall win rate</span><span class="num" style="color:${L.overall_win_rate >= 55 ? 'var(--up)' : 'var(--warn)'}">${L.overall_win_rate != null ? L.overall_win_rate + '%' : '—'}</span></div>
        <div class="row"><span class="mut">Sample</span><span class="num">${L.sample}</span></div>
        <div class="row"><span class="mut">Avg R:R</span><span class="num">${L.rr_avg != null ? L.rr_avg : '—'}</span></div>
        <div class="row"><span class="mut">Avg MAE / MFE</span><span class="num">${L.mae_avg != null ? L.mae_avg + '%' : '—'} / ${L.mfe_avg != null ? L.mfe_avg + '%' : '—'}</span></div>`;
    }
    const sigEntries = Object.entries((L && L.signal_win_rates) || {}).filter(([, v]) => v.sample >= 1);
    fillTable('#learnBest', [...sigEntries].sort((a, b) => (b[1].win_rate || 0) - (a[1].win_rate || 0)).slice(0, 10), e =>
      `<td>${esc(e[0])}</td><td class="num" style="color:var(--up)">${e[1].win_rate}% <span class="mut">n${e[1].sample}</span></td>`,
      (L && L.reason) || 'no data', 2);
    fillTable('#learnWorst', [...sigEntries].sort((a, b) => (a[1].win_rate || 0) - (b[1].win_rate || 0)).slice(0, 10), e =>
      `<td>${esc(e[0])}</td><td class="num" style="color:var(--down)">${e[1].win_rate}% <span class="mut">n${e[1].sample}</span></td>`,
      (L && L.reason) || 'no data', 2);
    // failure clusters from anomalies (subtype learning_fail)
    const lfRows = ((anom.body && anom.body.anomalies) || []).filter(a => a.type === 'learning_fail');
    fillTable('#learnFail', lfRows, r => { const d = r.details || {};
      return `<td class="num mut">${fmtTime(r.created_at)}</td><td>${esc(r.token_id)}</td><td class="mut">${esc(d.reason || 'cluster')}</td>`;
    }, 'none', 3);

    // ---- Phase 8: strategy distribution + best/worst + capital + failures ----
    const sDetails = ((strategy.body && strategy.body.strategies) || []).map(s => s.detail || s);
    if (strategy.body && strategy.body.available === false) { $('stratDist').innerHTML = '<div class="mut">strategy worker unavailable</div>'; }
    else if (!sDetails.length) { $('stratDist').innerHTML = '<div class="mut">no strategies yet</div>'; }
    else {
      const byName = {};
      sDetails.forEach(s => { const p = byName[s.strategy] = byName[s.strategy] || { count: 0, capital: 0, scoreSum: 0 }; p.count++; p.capital += (s.capital || 0); p.scoreSum += (s.score || 0); });
      const tot = sDetails.length;
      const cols = ['var(--up)', 'var(--acc)', 'var(--warn)', 'var(--purple)', 'var(--down)'];
      $('stratDist').innerHTML = Object.entries(byName).sort((a, b) => b[1].count - a[1].count).map(([n, v], i) =>
        `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:11px"><span>${esc(n)}</span><span class="num">${v.count}</span></div>
        <div style="height:6px;background:var(--panel2);border-radius:3px;overflow:hidden"><div style="height:100%;width:${tot ? (v.count / tot * 100) : 0}%;background:${cols[i % cols.length]}"></div></div></div>`).join('');
      const ranked = Object.entries(byName).map(([n, v]) => ({ name: n, avg: Math.round(v.scoreSum / v.count), capital: v.capital }));
      fillTable('#stratBest', [...ranked].sort((a, b) => b.avg - a.avg).slice(0, 10), r => `<td>${esc(r.name)}</td><td class="num" style="color:var(--up)">${r.avg}</td>`, 'no data', 2);
      fillTable('#stratWorst', [...ranked].sort((a, b) => a.avg - b.avg).slice(0, 10), r => `<td>${esc(r.name)}</td><td class="num" style="color:var(--down)">${r.avg}</td>`, 'no data', 2);
      fillTable('#stratCap', [...ranked].sort((a, b) => b.capital - a.capital).slice(0, 10), r => `<td>${esc(r.name)}</td><td class="num">$${Math.round(r.capital).toLocaleString()}</td>`, 'no data', 2);
    }
    // strategy failures from anomalies (subtype strategy_fail)
    const sfRows = ((anom.body && anom.body.anomalies) || []).filter(a => a.type === 'strategy_fail');
    fillTable('#stratFail', sfRows, r => { const d = r.details || {};
      return `<td class="num mut">${fmtTime(r.created_at)}</td><td>${esc(r.token_id)}</td><td class="mut">${esc(d.reason || 'strategy failure')}</td>`;
    }, 'none', 3);
  }

  function fillTable(sel, rows, rowHtml, emptyMsg, cols) {
    const tb = document.querySelector(sel + ' tbody'); if (!tb) return;
    tb.innerHTML = '';
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="${cols}" class="mut">${esc(emptyMsg)}</td></tr>`; return; }
    for (const r of rows.slice(0, 15)) tb.insertAdjacentHTML('beforeend', '<tr>' + rowHtml(r) + '</tr>');
  }
  function fmtPct(v) { return v != null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—'; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function pct(v) { return v != null ? (v * 100).toFixed(0) + '%' : '—'; }
})();
