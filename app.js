/* =========================================================
   ROSTER HUB — App Logic
   Pulls live data from a public Google Sheet (gviz JSON endpoint)
   ========================================================= */
(function () {
  'use strict';

  // ---- CONFIGURE THIS ----
  // Your Google Sheet ID (from the sheet's URL) and tab name.
  const SHEET_ID = '1lQapVF5-hK9l5MUoJOZJW6cDOttKazZQCRfifQhYJnQ';
  const SHEET_TAB = 'Madden Data';
  // -------------------------

  const REFRESH_MS = 5 * 60 * 1000; // auto-refresh every 5 minutes

  let ROSTER = [];
  let state = { search: '', group: 'all', status: 'all', team: 'all', sort: 'overall' };

  // -------- Theme toggle --------
  (function () {
    const html = document.documentElement;
    const btn = document.querySelector('[data-theme-toggle]');
    let theme = 'dark';
    try {
      if (window.matchMedia && !window.matchMedia('(prefers-color-scheme: dark)').matches) theme = 'light';
    } catch (_) {}
    html.setAttribute('data-theme', theme);
    if (!btn) return;
    btn.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', theme);
    });
  })();

  // -------- Helpers --------
  function escape(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function initials(name) {
    if (!name) return '';
    return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  }
  function ovrTier(o) {
    if (o == null || isNaN(o)) return 'avg';
    if (o >= 95) return 'elite';
    if (o >= 87) return 'star';
    if (o >= 78) return 'good';
    return 'avg';
  }
  function heightLabel(inches) {
    const n = Number(inches);
    if (!n || isNaN(n)) return '';
    const ft = Math.floor(n / 12);
    const inch = Math.round(n % 12);
    return `${ft}'${inch}"`;
  }
  // Parses a salary cell. Until you fill in real numbers, this will be blank/"TDB" -> shows a placeholder.
  function parseSalary(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || /^tbd$/i.test(s) || /^tdb$/i.test(s) || /^n\/?a$/i.test(s)) return null;
    const cleaned = s.replace(/[^0-9.]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return null;
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 10e6 ? 1 : 2) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + n.toLocaleString('en-US');
  }

  const OFFENSE_POS = new Set(['QB','HB','RB','FB','WR','TE','T','LT','RT','G','LG','RG','C','OL']);
  const DEFENSE_POS = new Set(['DE','DT','EDGE','LB','MLB','OLB','ROLB','LOLB','CB','S','FS','SS','DB','NT']);
  const SPECIAL_POS = new Set(['K','P','LS','KR','PR']);
  function positionGroup(pos) {
    const p = (pos || '').toUpperCase();
    if (SPECIAL_POS.has(p)) return 'Special Teams';
    if (DEFENSE_POS.has(p)) return 'Defense';
    if (OFFENSE_POS.has(p)) return 'Offense';
    return 'Offense';
  }

  const STATUS_LABELS = {
    ACT: 'Active', PRA: 'Practice Squad', PS: 'Practice Squad', DEV: 'Practice Squad',
    PUP: 'PUP', NFI: 'NFI', IR: 'Injured Reserve', INJ: 'Injured',
    SUS: 'Suspended', EXE: 'Exempt', RES: 'Reserved', FA: 'Free Agent', '': 'Free Agent',
  };
  const STATUS_TIER = {
    ACT: 'ACT',
    PUP: 'WARN', NFI: 'WARN', IPP: 'WARN',
    IR: 'OUT', INJ: 'OUT', SUS: 'OUT', EXE: 'OUT',
  };
  function statusLabel(code) {
    const c = (code || '').trim().toUpperCase();
    return STATUS_LABELS[c] || c || 'Free Agent';
  }
  function statusTier(code) {
    const c = (code || '').trim().toUpperCase();
    return STATUS_TIER[c] || (c ? 'NEUTRAL' : 'NEUTRAL');
  }

  function headshotUrl(espnId) {
    if (!espnId) return null;
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  }

  // -------- Google Sheets fetch (gviz JSON, no API key / backend needed) --------
  async function fetchSheet() {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_TAB)}&_=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
    if (!match) throw new Error('Unexpected response from Google Sheets');
    const json = JSON.parse(match[1]);
    if (json.status === 'error') {
      const msg = (json.errors && json.errors[0] && json.errors[0].detailed_message) || 'Sheet returned an error';
      throw new Error(msg);
    }
    return json.table;
  }

  // Column order in the "Madden Data" tab:
  // A:PGID B:TGID C:POVR D:PPOS E:Player Name F:Jersey# G:Status H:Height I:Weight J:Age K:College L:Salary M:Position N:Team O:ESPN ID
  function rowsToPlayers(table) {
    const rows = table.rows || [];
    const cellVal = (row, i) => (row.c && row.c[i] && row.c[i].v != null) ? row.c[i].v : null;
    return rows
      .map((row) => {
        const name = cellVal(row, 4);
        if (!name) return null;
        return {
          pgid: cellVal(row, 0),
          tgid: cellVal(row, 1),
          overall: Number(cellVal(row, 2)) || null,
          ppos: cellVal(row, 3),
          name: String(name).trim(),
          jersey: cellVal(row, 5),
          status: cellVal(row, 6) || '',
          height: cellVal(row, 7),
          weight: cellVal(row, 8),
          age: cellVal(row, 9),
          college: cellVal(row, 10) || '',
          salaryRaw: cellVal(row, 11),
          position: cellVal(row, 12) || '',
          team: cellVal(row, 13) || 'Free Agents',
          espnId: cellVal(row, 14),
        };
      })
      .filter(Boolean);
  }

  // -------- Sync / boot --------
  async function loadData(isManual) {
    const pill = document.getElementById('syncPill');
    const label = document.getElementById('syncLabel');
    const refreshBtn = document.getElementById('refreshBtn');
    const errBanner = document.getElementById('errorBanner');
    const skeleton = document.getElementById('rosterSkeleton');
    const grid = document.getElementById('rosterGrid');

    refreshBtn.classList.add('spinning');
    pill.className = 'live-pill';
    label.textContent = 'SYNCING';
    if (isManual) { errBanner.hidden = true; }
    if (!ROSTER.length) { skeleton.style.display = 'grid'; grid.style.display = 'none'; }

    try {
      const table = await fetchSheet();
      ROSTER = rowsToPlayers(table);
      pill.className = 'live-pill is-live';
      label.textContent = 'LIVE';
      errBanner.hidden = true;
      document.getElementById('lastSynced').textContent = 'Last synced ' + new Date().toLocaleTimeString();
      populateTeamSelect();
      fillStats();
      renderRoster();
    } catch (err) {
      console.error('Roster Hub sync error:', err);
      pill.className = 'live-pill is-error';
      label.textContent = 'OFFLINE';
      document.getElementById('errorDetail').textContent =
        'Make sure the sheet is shared as "Anyone with the link can view," then hit refresh. (' + err.message + ')';
      errBanner.hidden = false;
    } finally {
      refreshBtn.classList.remove('spinning');
      skeleton.style.display = 'none';
      grid.style.display = 'grid';
    }
  }

  function fillStats() {
    document.getElementById('statPlayers').textContent = ROSTER.length.toLocaleString();
    const teams = new Set(ROSTER.map((p) => p.team).filter((t) => t && t !== 'Free Agents'));
    document.getElementById('statTeams').textContent = teams.size || '—';
    const active = ROSTER.filter((p) => (p.status || '').toUpperCase() === 'ACT').length;
    document.getElementById('statActive').textContent = active.toLocaleString();
    const top = ROSTER.reduce((m, p) => (p.overall && p.overall > m ? p.overall : m), 0);
    document.getElementById('statTop').textContent = top || '—';
    document.getElementById('rosterSub').textContent =
      `${ROSTER.length.toLocaleString()} players across ${teams.size} teams · Click any card for full bio.`;
  }

  function populateTeamSelect() {
    const sel = document.getElementById('teamSelect');
    const current = sel.value || 'all';
    const teams = Array.from(new Set(ROSTER.map((p) => p.team).filter(Boolean))).sort((a, b) => {
      if (a === 'Free Agents') return 1;
      if (b === 'Free Agents') return -1;
      return a.localeCompare(b);
    });
    sel.innerHTML = '<option value="all">All Teams</option>' +
      teams.map((t) => `<option value="${escape(t)}">${escape(t)}</option>`).join('');
    if (teams.includes(current) || current === 'all') sel.value = current;
    state.team = sel.value;
  }

  // -------- Filter / sort --------
  function filterAndSortRoster() {
    let list = ROSTER.slice();
    if (state.team !== 'all') list = list.filter((p) => p.team === state.team);
    if (state.group !== 'all') list = list.filter((p) => positionGroup(p.position) === state.group);
    if (state.status === 'ACT') list = list.filter((p) => (p.status || '').toUpperCase() === 'ACT');
    if (state.status === 'OTHER') list = list.filter((p) => (p.status || '').toUpperCase() !== 'ACT');
    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.college || '').toLowerCase().includes(q) ||
          (p.position || '').toLowerCase().includes(q) ||
          (p.team || '').toLowerCase().includes(q) ||
          String(p.jersey || '').includes(q)
      );
    }
    const sortFns = {
      overall: (a, b) => (b.overall || 0) - (a.overall || 0),
      age_asc: (a, b) => (a.age || 0) - (b.age || 0),
      age_desc: (a, b) => (b.age || 0) - (a.age || 0),
      jersey: (a, b) => (a.jersey || 999) - (b.jersey || 999),
      name: (a, b) => a.name.localeCompare(b.name),
      team: (a, b) => (a.team || '').localeCompare(b.team || ''),
    };
    list.sort(sortFns[state.sort] || sortFns.overall);
    return list;
  }

  function renderRoster() {
    const grid = document.getElementById('rosterGrid');
    const empty = document.getElementById('rosterEmpty');
    const list = filterAndSortRoster();
    grid.innerHTML = list.map(playerCardHTML).join('');
    empty.hidden = list.length > 0;

    grid.querySelectorAll('.player-card').forEach((el) => {
      el.addEventListener('click', () => openModal(el.dataset.pgid));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(el.dataset.pgid); } });
    });
  }

  function playerCardHTML(p) {
    const tier = ovrTier(p.overall);
    const ovrLabel = p.overall ? p.overall + ' OVR' : 'NR';
    const shot = headshotUrl(p.espnId);
    const avatarInner = shot
      ? `<img src="${escape(shot)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<span class=&quot;initials&quot;>${escape(initials(p.name))}</span>'" />`
      : `<span class="initials">${escape(initials(p.name))}</span>`;
    const sTier = statusTier(p.status);
    const salary = fmtMoney(parseSalary(p.salaryRaw));
    return `
      <article class="player-card" data-pgid="${escape(p.pgid)}" tabindex="0" role="button" aria-label="${escape(p.name)} details">
        <div class="pc-top">
          <div class="pc-avatar">${avatarInner}</div>
          <div class="pc-jersey">${p.jersey ? '#' + p.jersey : ''}</div>
          <div class="pc-headinfo">
            <span class="pc-pos">${escape(p.position || '—')}</span>
            <span class="status-badge status-${sTier}">${escape(statusLabel(p.status))}</span>
          </div>
        </div>
        <div>
          <div class="pc-name">${escape(p.name)}</div>
          <div class="pc-team">${escape(p.team)}</div>
          <div class="pc-meta">
            <span>${p.age ? p.age + 'y' : ''}</span>
            <span>${heightLabel(p.height)}</span>
            <span>${p.weight ? p.weight + ' lb' : ''}</span>
            <span>${escape(p.college || '')}</span>
          </div>
        </div>
        <div class="pc-stats">
          <div>
            <div class="pc-stat-label">Madden</div>
            <div class="pc-stat-val"><span class="pc-ovr ovr-${tier}">${ovrLabel}</span></div>
          </div>
          <div>
            <div class="pc-stat-label">Salary</div>
            <div class="pc-stat-val ${salary ? '' : 'pc-cap empty'}">${salary || 'Add salary'}</div>
          </div>
        </div>
      </article>
    `;
  }

  // -------- Modal --------
  function openModal(pgid) {
    const p = ROSTER.find((x) => String(x.pgid) === String(pgid));
    if (!p) return;
    document.getElementById('modalBody').innerHTML = modalHTML(p);
    const modal = document.getElementById('playerModal');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    document.getElementById('playerModal').hidden = true;
    document.body.style.overflow = '';
  }
  document.addEventListener('click', (e) => { if (e.target.matches('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  function modalHTML(p) {
    const tier = ovrTier(p.overall);
    const shot = headshotUrl(p.espnId);
    const headshotInner = shot
      ? `<img src="${escape(shot)}" alt="${escape(p.name)}" onerror="this.parentElement.innerHTML='<span class=&quot;initials&quot;>${escape(initials(p.name))}</span>'" />`
      : `<span class="initials">${escape(initials(p.name))}</span>`;
    const sTier = statusTier(p.status);
    const salary = fmtMoney(parseSalary(p.salaryRaw));

    return `
      <div class="modal-hero">
        <div class="mh-headshot">${headshotInner}</div>
        <div class="mh-text">
          <span class="mh-pos">${escape(p.position || '—')} · ${escape(p.team)}</span>
          <div class="mh-name">${escape(p.name)}</div>
          <div class="mh-meta">
            <span>${p.age ? p.age + ' years old' : ''}</span>
            <span>${heightLabel(p.height)}${p.weight ? ' · ' + p.weight + ' lb' : ''}</span>
            <span>${escape(p.college || '')}</span>
          </div>
        </div>
        <div class="mh-jersey">${p.jersey ? '#' + p.jersey : ''}</div>
      </div>
      <div class="modal-ovr-row">
        <div class="mob-overall ${tier}">${p.overall || '—'}</div>
        <div>
          <div class="mob-label">Madden Overall</div>
          <span class="status-badge status-${sTier}" style="margin-top:6px;display:inline-block;">${escape(statusLabel(p.status))}</span>
        </div>
      </div>
      <div class="mb-grid">
        <div class="mb-box">
          <div class="mb-box-label">Team</div>
          <div class="mb-box-val">${escape(p.team)}</div>
        </div>
        <div class="mb-box">
          <div class="mb-box-label">College</div>
          <div class="mb-box-val">${escape(p.college || '—')}</div>
        </div>
        <div class="mb-box">
          <div class="mb-box-label">Salary</div>
          <div class="mb-box-val ${salary ? '' : 'empty'}">${salary || 'Not entered yet'}</div>
        </div>
        <div class="mb-box">
          <div class="mb-box-label">Jersey #</div>
          <div class="mb-box-val">${p.jersey ? '#' + p.jersey : '—'}</div>
        </div>
      </div>
    `;
  }

  // -------- Filters wiring --------
  function wireFilters() {
    document.getElementById('search').addEventListener('input', (e) => { state.search = e.target.value; renderRoster(); });
    document.getElementById('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderRoster(); });
    document.getElementById('teamSelect').addEventListener('change', (e) => { state.team = e.target.value; renderRoster(); });

    document.getElementById('groupFilter').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      document.querySelectorAll('#groupFilter .chip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      state.group = b.dataset.group;
      renderRoster();
    });
    document.getElementById('statusFilter').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      document.querySelectorAll('#statusFilter .chip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      state.status = b.dataset.status;
      renderRoster();
    });
    document.getElementById('retryBtn').addEventListener('click', () => loadData(true));
    document.getElementById('refreshBtn').addEventListener('click', () => loadData(true));
  }

  function boot() {
    wireFilters();
    loadData(false);
    setInterval(() => loadData(false), REFRESH_MS);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
