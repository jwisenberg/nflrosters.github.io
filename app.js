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
  let state = { search: '', group: 'all', status: 'all', team: 'all', position: 'all', sort: 'jersey' };

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
  // Jersey #0 is valid and must show "#0"; only truly blank values fall back to "#--".
  function jerseyLabel(jersey) {
    if (jersey === null || jersey === undefined || jersey === '') return '#--';
    return '#' + jersey;
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
  // Preferred ordering for the Position dropdown. Anything not listed here is appended afterward, alphabetically.
  const POSITION_ORDER = ['QB','RB','FB','WR','TE','C','G','T','DT','EDGE','LB','CB','S','K','P','LS'];
  function positionGroup(pos) {
    const p = (pos || '').toUpperCase();
    if (SPECIAL_POS.has(p)) return 'Special Teams';
    if (DEFENSE_POS.has(p)) return 'Defense';
    if (OFFENSE_POS.has(p)) return 'Offense';
    return 'Offense';
  }

  // Team color pairs (primary / secondary) used for the player-card border treatment.
  const TEAM_COLORS = {
    'Arizona Cardinals': { color: '#97233F', color2: '#000000' },
    'Atlanta Falcons': { color: '#A71930', color2: '#000000' },
    'Baltimore Ravens': { color: '#241773', color2: '#9E7C0C' },
    'Buffalo Bills': { color: '#00338D', color2: '#C60C30' },
    'Carolina Panthers': { color: '#0085CA', color2: '#000000' },
    'Chicago Bears': { color: '#0B162A', color2: '#E64100' },
    'Cincinnati Bengals': { color: '#FB4F14', color2: '#000000' },
    'Cleveland Browns': { color: '#FF3C00', color2: '#311D00' },
    'Dallas Cowboys': { color: '#002244', color2: '#B0B7BC' },
    'Denver Broncos': { color: '#002244', color2: '#FB4F14' },
    'Detroit Lions': { color: '#0076B6', color2: '#B0B7BC' },
    'Green Bay Packers': { color: '#203731', color2: '#FFB612' },
    'Houston Texans': { color: '#03202F', color2: '#A71930' },
    'Indianapolis Colts': { color: '#002C5F', color2: '#a5acaf' },
    'Jacksonville Jaguars': { color: '#006778', color2: '#000000' },
    'Kansas City Chiefs': { color: '#E31837', color2: '#FFB612' },
    'Los Angeles Rams': { color: '#003594', color2: '#FFD100' },
    'Los Angeles Chargers': { color: '#007BC7', color2: '#ffc20e' },
    'Las Vegas Raiders': { color: '#000000', color2: '#A5ACAF' },
    'Miami Dolphins': { color: '#008E97', color2: '#F58220' },
    'Minnesota Vikings': { color: '#4F2683', color2: '#FFC62F' },
    'New England Patriots': { color: '#002244', color2: '#C60C30' },
    'New Orleans Saints': { color: '#D3BC8D', color2: '#000000' },
    'New York Giants': { color: '#0B2265', color2: '#A71930' },
    'New York Jets': { color: '#003F2D', color2: '#000000' },
    'Oakland Raiders': { color: '#000000', color2: '#A5ACAF' },
    'Philadelphia Eagles': { color: '#004C54', color2: '#A5ACAF' },
    'Pittsburgh Steelers': { color: '#000000', color2: '#FFB612' },
    'San Diego Chargers': { color: '#007BC7', color2: '#ffc20e' },
    'Seattle Seahawks': { color: '#002244', color2: '#69be28' },
    'San Francisco 49ers': { color: '#AA0000', color2: '#B3995D' },
    'St. Louis Rams': { color: '#003594', color2: '#FFD100' },
    'Tampa Bay Buccaneers': { color: '#A71930', color2: '#322F2B' },
    'Tennessee Titans': { color: '#4495D2', color2: '#D50A0A' },
    'Washington Commanders': { color: '#5A1414', color2: '#FFB612' },
  };
  // Returns a CSS custom-property string for the card border, or '' for Free Agents / unknown teams
  // (in which case the card just keeps the theme's default neutral border).
  function teamBorderStyle(team) {
    const t = TEAM_COLORS[team];
    if (!t || team === 'Free Agents') return '';
    return ` style="--team-primary:${t.color};"`;
  }

  const STATUS_LABELS = {
    ACT: 'Active', PRA: 'Practice Squad', PS: 'Practice Squad', DEV: 'Practice Squad',
    PUP: 'PUP', NFI: 'NFI', IPP: 'IPP', IR: 'IR', INJ: 'IR',
    SUS: 'Suspended', EXE: 'Exempt', RES: 'Reserved', FA: 'Free Agent',
  };
  function statusLabel(code) {
    if (code === null || code === undefined || code === '') return '';
    const c = String(code).trim().toUpperCase();
    if (!c) return '';
    return STATUS_LABELS[c] || c;
  }
  // Only ACT (green) and IPP (amber) get special treatment — everything else is red.
  // Returns null when there's no status to show (e.g. Free Agents) so no badge renders.
  function statusTier(code) {
    if (code === null || code === undefined || code === '') return null;
    const c = String(code).trim().toUpperCase();
    if (!c) return null;
    if (c === 'ACT') return 'ACT';
    if (c === 'IPP') return 'WARN';
    return 'OUT';
  }

  function headshotUrl(espnId) {
    if (!espnId) return null;
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  }
  function collegeHeadshotUrl(espnId) {
    if (!espnId) return null;
    return `https://a.espncdn.com/i/headshots/college-football/players/full/${espnId}.png`;
  }
  // Headshot fallback chain: NFL roster photo -> college photo -> initials.
  // Exposed on window because inline onerror handlers run outside this closure.
  window.__rhImgFallback = function (img) {
    const stage = img.dataset.stage;
    const espnId = img.dataset.espn;
    if (stage === 'nfl' && espnId) {
      img.dataset.stage = 'college';
      img.src = collegeHeadshotUrl(espnId);
      return;
    }
    const span = document.createElement('span');
    span.className = 'initials';
    span.textContent = img.dataset.initials || '';
    const parent = img.parentElement;
    parent.innerHTML = '';
    parent.appendChild(span);
  };

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
        const team = cellVal(row, 13) || 'Free Agents';
        return {
          pgid: cellVal(row, 0),
          tgid: cellVal(row, 1),
          overall: Number(cellVal(row, 2)) || null,
          ppos: cellVal(row, 3),
          name: String(name).trim(),
          jersey: cellVal(row, 5),
          // Free Agents have no real status on a roster — keep it null so the badge area stays blank.
          status: team === 'Free Agents' ? null : (cellVal(row, 6) || ''),
          height: cellVal(row, 7),
          weight: cellVal(row, 8),
          age: cellVal(row, 9),
          college: cellVal(row, 10) || '',
          salaryRaw: cellVal(row, 11),
          position: cellVal(row, 12) || '',
          team: team,
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
      pill.title = 'Synced from Google Sheets — last synced ' + new Date().toLocaleTimeString();
      populateTeamSelect();
      populatePositionSelect();
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

  function populatePositionSelect() {
    const sel = document.getElementById('positionSelect');
    const current = sel.value || 'all';
    const positions = Array.from(new Set(ROSTER.map((p) => p.position).filter(Boolean))).sort((a, b) => {
      const ia = POSITION_ORDER.indexOf(a);
      const ib = POSITION_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    sel.innerHTML = '<option value="all">All Positions</option>' +
      positions.map((pos) => `<option value="${escape(pos)}">${escape(pos)}</option>`).join('');
    if (positions.includes(current) || current === 'all') sel.value = current;
    state.position = sel.value;
  }

  // -------- Filter / sort --------
  function filterAndSortRoster() {
    let list = ROSTER.slice();
    if (state.team !== 'all') list = list.filter((p) => p.team === state.team);
    if (state.position !== 'all') list = list.filter((p) => p.position === state.position);
    if (state.group !== 'all') list = list.filter((p) => positionGroup(p.position) === state.group);
    if (state.status === 'ACT') list = list.filter((p) => (p.status || '').toUpperCase() === 'ACT');
    if (state.status === 'IPP') list = list.filter((p) => (p.status || '').toUpperCase() === 'IPP');
    if (state.status === 'OTHER') list = list.filter((p) => p.status && !['ACT', 'IPP'].includes(String(p.status).toUpperCase()));
    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.college || '').toLowerCase().includes(q) ||
          (p.position || '').toLowerCase().includes(q) ||
          (p.team || '').toLowerCase().includes(q) ||
          String(p.jersey != null ? p.jersey : '').includes(q)
      );
    }
    const sortFns = {
      overall: (a, b) => (b.overall || 0) - (a.overall || 0),
      age_asc: (a, b) => (a.age || 0) - (b.age || 0),
      age_desc: (a, b) => (b.age || 0) - (a.age || 0),
      jersey: (a, b) => (a.jersey === '' || a.jersey == null ? 999 : a.jersey) - (b.jersey === '' || b.jersey == null ? 999 : b.jersey),
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
      ? `<img src="${escape(shot)}" alt="" loading="lazy" data-stage="nfl" data-espn="${escape(p.espnId)}" data-initials="${escape(initials(p.name))}" onerror="window.__rhImgFallback(this)" />`
      : `<span class="initials">${escape(initials(p.name))}</span>`;
    const sTier = statusTier(p.status);
    const statusBadge = sTier ? `<span class="status-badge status-${sTier}">${escape(statusLabel(p.status))}</span>` : '';
    const salary = fmtMoney(parseSalary(p.salaryRaw));
    return `
      <article class="player-card" data-pgid="${escape(p.pgid)}" tabindex="0" role="button" aria-label="${escape(p.name)} details"${teamBorderStyle(p.team)}>
        <div class="pc-top">
          <div class="pc-avatar">${avatarInner}</div>
          <div class="pc-jersey">${jerseyLabel(p.jersey)}</div>
          <div class="pc-headinfo">
            <span class="pc-pos">${escape(p.position || '—')}</span>
            ${statusBadge}
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
      ? `<img src="${escape(shot)}" alt="${escape(p.name)}" data-stage="nfl" data-espn="${escape(p.espnId)}" data-initials="${escape(initials(p.name))}" onerror="window.__rhImgFallback(this)" />`
      : `<span class="initials">${escape(initials(p.name))}</span>`;
    const sTier = statusTier(p.status);
    const statusBadge = sTier ? `<span class="status-badge status-${sTier}" style="margin-top:6px;display:inline-block;">${escape(statusLabel(p.status))}</span>` : '';
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
        <div class="mh-jersey">${jerseyLabel(p.jersey)}</div>
      </div>
      <div class="modal-ovr-row">
        <div class="mob-overall ${tier}">${p.overall || '—'}</div>
        <div>
          <div class="mob-label">Madden Overall</div>
          ${statusBadge}
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
          <div class="mb-box-val">${jerseyLabel(p.jersey)}</div>
        </div>
      </div>
    `;
  }

  // -------- Filters wiring --------
  function wireFilters() {
    document.getElementById('search').addEventListener('input', (e) => { state.search = e.target.value; renderRoster(); });
    document.getElementById('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderRoster(); });
    document.getElementById('teamSelect').addEventListener('change', (e) => { state.team = e.target.value; renderRoster(); });
    document.getElementById('positionSelect').addEventListener('change', (e) => { state.position = e.target.value; renderRoster(); });

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
