// State
let pendingAlerts = 0;
let openIncidents = 0;
let orphanages = [];
let currentFilter = '';
let ws;
let map;
let portalOrphanageId = null;
let facilityLayer;
let stationLayer;
let facilityMarkers = [];
let cachedChildren = [];
let cachedVisitors = [];
let cachedAlerts = [];
let cachedIncidents = [];
let cachedActivities = [];

// WebSocket
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    switch (data.type) {
      case 'zone_update': updateZoneCard(data.zone, data.count); break;
      case 'alert': handleNewAlert(data.alert); break;
      case 'alert_ack': markAlertAcknowledged(data.alertId); break;
      case 'incident': handleNewIncident(data.incident); break;
      case 'risk_update': updateOrphanageRisk(data.orphanage_id, data.risk_level); break;
      case 'visitor_checkin': case 'visitor_checkout': loadVisitors(); loadStats(); break;
      case 'child_added': loadChildren(); loadStats(); break;
      case 'emotion_detection': handleEmotionDetection(data.detection); break;
      case 'notification': handleNewNotification(data.notification); break;
    }
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
  ws.onerror = () => ws.close();
}
connectWS();

// Navigation
function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  if (page === 'map') initMap();
  if (page === 'cameras') initCameras();
  if (page === 'children') loadChildren();
  if (page === 'visitors') loadVisitors();
  if (page === 'alerts') loadAlerts();
  if (page === 'incidents') loadIncidents();
  if (page === 'rankings') loadRankings();
  if (page === 'portal') loadPortal();
  if (page === 'activity') loadActivity();
  if (page === 'analytics') loadAnalytics();
  if (page === 'emotions') loadEmotions();
  if (page === 'anomalies') loadAnomalies();
  if (page === 'briefing') loadBriefing();
}

function viewOrphanage(id) {
  portalOrphanageId = id;
  navigateTo('portal');
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

// Orphanage filter
document.getElementById('orphanage-filter').addEventListener('change', (e) => {
  currentFilter = e.target.value;
  loadStats();
  loadAlerts();
  const activePage = document.querySelector('.page-section.active');
  if (activePage) {
    const id = activePage.id.replace('page-', '');
    if (id === 'children') loadChildren();
    if (id === 'visitors') loadVisitors();
    if (id === 'incidents') loadIncidents();
    if (id === 'activity') loadActivity();
  }
});

// Clock
function updateClock() {
  const el = document.getElementById('live-time');
  if (el) el.textContent = new Date().toLocaleString('en-PK', { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// Query helper
function qs(orphanageId) {
  return orphanageId ? `?orphanage_id=${orphanageId}` : '';
}

// Load orphanages
async function loadOrphanages() {
  try {
    const res = await fetch('/api/orphanages');
    orphanages = await res.json();
    const filter = document.getElementById('orphanage-filter');
    filter.innerHTML = '<option value="">All Orphanages</option>' +
      orphanages.map(o => `<option value="${o.id}">${o.name} - ${o.city}</option>`).join('');
    document.querySelectorAll('.orphanage-select').forEach(sel => {
      sel.innerHTML = orphanages.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
    });
    await loadOrphanageIndicators();
    renderOrphanageGrid();
    updateStatusBar();
  } catch (e) { console.error(e); }
}

function updateStatusBar() {
  const el = document.getElementById('ssb-cameras');
  if (el) el.textContent = 'None connected';
  const onlineEl = document.getElementById('ssb-online-count');
  if (onlineEl) onlineEl.textContent = `${orphanages.length} illustrative map points`;
  const threatEl = document.getElementById('ssb-threat');
  if (threatEl) {
    threatEl.textContent = 'Not assessed';
    threatEl.style.color = 'var(--text-tertiary)';
  }
}

let orphanageAlertCounts = {};
let orphanageIncidentCounts = {};

let orphanageRankings = {};

async function loadOrphanageIndicators() {
  try {
    const [alertsRes, incidentsRes, rankingsRes] = await Promise.all([
      fetch('/api/alerts'), fetch('/api/incidents'), fetch('/api/rankings')
    ]);
    const [alerts, incidents, rankings] = await Promise.all([alertsRes.json(), incidentsRes.json(), rankingsRes.json()]);
    orphanageAlertCounts = {};
    orphanageIncidentCounts = {};
    orphanageRankings = {};
    alerts.filter(a => !a.acknowledged).forEach(a => {
      orphanageAlertCounts[a.orphanage_id] = (orphanageAlertCounts[a.orphanage_id] || 0) + 1;
    });
    incidents.filter(i => !i.reviewed).forEach(i => {
      orphanageIncidentCounts[i.orphanage_id] = (orphanageIncidentCounts[i.orphanage_id] || 0) + 1;
    });
    rankings.forEach(r => { orphanageRankings[r.id] = r; });
  } catch (e) { /* ignore */ }
}

function renderOrphanageGrid(filter) {
  const grid = document.getElementById('orphanage-grid');
  if (!grid) return;
  let list = orphanages;
  if (filter) {
    const q = filter.toLowerCase();
    list = orphanages.filter(o => o.name.toLowerCase().includes(q) || o.city.toLowerCase().includes(q) || o.district.toLowerCase().includes(q));
  }
  grid.innerHTML = list.map(o => {
    const alertCount = orphanageAlertCounts[o.id] || 0;
    const incidentCount = orphanageIncidentCounts[o.id] || 0;
    const rank = orphanageRankings[o.id];
    const gradeColor = rank ? (rank.grade === 'A' ? 'var(--success)' : rank.grade === 'B' ? 'var(--accent)' : rank.grade === 'C' ? 'var(--warning)' : 'var(--danger)') : 'var(--text-secondary)';
    return `
    <div class="orphanage-card" onclick="openOrphanageDetail(${o.id})">
      <div class="oc-header">
        <div>
          <div class="oc-name"><span class="status-dot ${o.status}"></span> ${o.name}</div>
          <div class="oc-city">${o.city}, ${o.district}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="prototype-state">SAMPLE RECORD</span>
        </div>
      </div>
      ${rank ? `<div class="oc-score-row">
        <span class="oc-rank">Demo</span>
        <div class="oc-score-bar"><div class="oc-score-fill" style="width:${rank.score}%;background:${gradeColor}"></div></div>
        <span class="oc-score-text" style="color:${gradeColor}">Data ${rank.score}%</span>
      </div>` : ''}
      ${(alertCount > 0 || incidentCount > 0) ? `<div class="oc-indicators">
        ${alertCount > 0 ? `<span class="oc-indicator alerts"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg> ${alertCount} alert${alertCount > 1 ? 's' : ''}</span>` : ''}
        ${incidentCount > 0 ? `<span class="oc-indicator incidents"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M3.26 19h17.48a1 1 0 0 0 .87-1.5L13.37 3.5a1 1 0 0 0-1.74 0L3.39 17.5a1 1 0 0 0 .87 1.5z"/></svg> ${incidentCount} incident${incidentCount > 1 ? 's' : ''}</span>` : ''}
      </div>` : ''}
      <div class="oc-stats">
        <div class="oc-stat"><div class="oc-stat-val">${o.total_children}</div><div class="oc-stat-label">Sample records</div></div>
        <div class="oc-stat"><div class="oc-stat-val">${o.staff_count}</div><div class="oc-stat-label">Sample staff</div></div>
        <div class="oc-stat"><div class="oc-stat-val">${o.cameras}</div><div class="oc-stat-label">Mock feeds</div></div>
      </div>
    </div>`;
  }).join('');
}

function filterOrphanageGrid(query) {
  renderOrphanageGrid(query);
}

// Orphanage Detail View
let currentDetailOrphanage = null;

async function openOrphanageDetail(id) {
  const o = orphanages.find(x => x.id === id);
  if (!o) return;
  currentDetailOrphanage = o;

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
  document.getElementById('page-detail').classList.add('active');

  document.getElementById('detail-title').textContent = o.name;
  const dot = document.getElementById('detail-status-dot');
  dot.style.background = o.status === 'online' ? 'var(--success)' : 'var(--danger)';
  document.getElementById('detail-status-text').textContent = o.status.toUpperCase();

  document.getElementById('detail-header-info').innerHTML = `
    <div class="detail-info-bar">
      <div class="detail-info-item">
        <div class="dii-icon" style="background:rgba(79,140,255,0.15)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
        <div><div class="dii-label">Location</div><div class="dii-value" style="font-size:14px">${o.address}</div></div>
      </div>
      <div class="detail-info-item">
        <div class="dii-icon" style="background:rgba(52,211,153,0.15)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
        <div><div class="dii-label">Children</div><div class="dii-value" style="color:var(--success)">${o.total_children}</div></div>
      </div>
      <div class="detail-info-item">
        <div class="dii-icon" style="background:rgba(167,139,250,0.15)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
        <div><div class="dii-label">Staff</div><div class="dii-value" style="color:var(--purple)">${o.staff_count}</div></div>
      </div>
      <div class="detail-info-item">
        <div class="dii-icon" style="background:rgba(251,191,36,0.15)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></div>
        <div><div class="dii-label">Cameras</div><div class="dii-value" style="color:var(--warning)">${o.cameras}</div></div>
      </div>
      <div class="detail-info-item">
        <div class="dii-icon" style="background:${o.risk_level === 'high' ? 'rgba(239,68,68,0.15)' : o.risk_level === 'medium' ? 'rgba(251,191,36,0.15)' : 'rgba(52,211,153,0.15)'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${o.risk_level === 'high' ? 'var(--danger)' : o.risk_level === 'medium' ? 'var(--warning)' : 'var(--success)'}" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <div><div class="dii-label">Risk Level</div><div class="dii-value"><span class="risk-badge ${o.risk_level}" style="font-size:13px;padding:4px 12px">${o.risk_level.toUpperCase()}</span></div></div>
      </div>
      <div class="detail-info-item">
        <div class="dii-icon" style="background:rgba(79,140,255,0.15)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg></div>
        <div><div class="dii-label">City / District</div><div class="dii-value" style="font-size:14px">${o.city}, ${o.district}</div></div>
      </div>
    </div>
  `;

  switchDetailTab('overview');
}

function closeDetail() {
  currentDetailOrphanage = null;
  document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
  document.getElementById('page-command').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('.nav-item[data-page="command"]').classList.add('active');
}

async function switchDetailTab(tab) {
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('dtab-' + tab).classList.add('active');

  const o = currentDetailOrphanage;
  if (!o) return;
  const oid = o.id;

  if (tab === 'overview') await loadDetailOverview(oid);
  else if (tab === 'children') await loadDetailChildren(oid);
  else if (tab === 'visitors') await loadDetailVisitors(oid);
  else if (tab === 'zones') await loadDetailZones(oid);
  else if (tab === 'alerts') await loadDetailAlerts(oid);
  else if (tab === 'incidents') await loadDetailIncidents(oid);
  else if (tab === 'activity') await loadDetailActivity(oid);
}

async function loadDetailChildren(oid) {
  const res = await fetch('/api/children?orphanage_id=' + oid);
  const children = await res.json();
  document.getElementById('dtab-children').innerHTML = children.length === 0 ? '<div class="detail-empty">No children registered at this orphanage</div>' : `
    <table class="data-table">
      <thead><tr><th>Name</th><th>Age</th><th>Gender</th><th>Admitted</th><th>Medical Notes</th><th>Actions</th></tr></thead>
      <tbody>${children.map(c => `
        <tr>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="detail-child-avatar">${c.name.charAt(0)}</div><strong>${c.name}</strong></div></td>
          <td>${c.age}</td><td>${c.gender}</td>
          <td>${new Date(c.admitted_date).toLocaleDateString('en-PK')}</td>
          <td>${c.medical_notes || '-'}</td>
          <td><button class="btn btn-outline btn-sm" onclick="viewHealth(${c.id},'${c.name}')">Health</button></td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

async function loadDetailVisitors(oid) {
  const res = await fetch('/api/visitors?orphanage_id=' + oid);
  const visitors = await res.json();
  document.getElementById('dtab-visitors').innerHTML = visitors.length === 0 ? '<div class="detail-empty">No visitor records</div>' : `
    <table class="data-table">
      <thead><tr><th>Name</th><th>CNIC</th><th>Phone</th><th>Purpose</th><th>Check In</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${visitors.map(v => `
        <tr>
          <td><strong>${v.name}</strong></td><td>${v.cnic || '-'}</td><td>${v.phone || '-'}</td><td>${v.purpose}</td>
          <td>${new Date(v.check_in).toLocaleString('en-PK')}</td>
          <td><span class="badge-status ${v.status}">${v.status.replace('_', ' ')}</span></td>
          <td>${v.status === 'checked_in' ? `<button class="btn btn-outline btn-sm" onclick="checkoutVisitor(${v.id});switchDetailTab('visitors')">Check Out</button>` : ''}</td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

async function loadDetailZones(oid) {
  const res = await fetch('/api/zones?orphanage_id=' + oid);
  const zones = await res.json();
  document.getElementById('dtab-zones').innerHTML = zones.length === 0 ? '<div class="detail-empty">No zones configured for this orphanage</div>' : `
    <div class="zone-grid">${zones.map(z => {
      const pct = z.expected_count > 0 ? Math.min(150, (z.current_count / z.expected_count) * 100) : 0;
      const status = pct > 120 ? 'danger' : pct > 90 ? 'warning' : '';
      return `<div class="zone-card">
        <div class="zone-status ${status}"></div>
        <div class="zone-name">${z.name}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">${z.description}</div>
        <div class="zone-count">${z.current_count}</div>
        <div class="zone-expected">Expected: ${z.expected_count}</div>
        <div class="dz-bar" style="margin-top:8px;width:100%"><div class="dz-bar-fill" style="width:${Math.min(pct, 100)}%;background:${pct > 120 ? 'var(--danger)' : pct > 90 ? 'var(--warning)' : 'var(--success)'}"></div></div>
      </div>`;
    }).join('')}</div>
  `;
}

async function loadDetailAlerts(oid) {
  const res = await fetch('/api/alerts?orphanage_id=' + oid);
  const alerts = await res.json();
  document.getElementById('dtab-alerts').innerHTML = alerts.length === 0 ? '<div class="detail-empty">No alerts for this orphanage</div>' :
    `<div class="alerts-list">${alerts.map(renderAlertItem).join('')}</div>`;
}

async function loadDetailIncidents(oid) {
  const res = await fetch('/api/incidents?orphanage_id=' + oid);
  const incidents = await res.json();
  document.getElementById('dtab-incidents').innerHTML = incidents.length === 0 ? '<div class="detail-empty">No AI detections for this orphanage</div>' :
    `<div class="alerts-list">${incidents.map(renderIncidentItem).join('')}</div>`;
}

async function loadDetailActivity(oid) {
  const res = await fetch('/api/activity?orphanage_id=' + oid);
  const activities = await res.json();
  const icons = {
    visitor_entry: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>', bg: 'rgba(79,140,255,0.15)' },
    ai_detection: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><path d="M12 9v4m0 4h.01M3.26 19h17.48a1 1 0 0 0 .87-1.5L13.37 3.5a1 1 0 0 0-1.74 0L3.39 17.5a1 1 0 0 0 .87 1.5z"/></svg>', bg: 'rgba(239,68,68,0.15)' },
    headcount_mismatch: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>', bg: 'rgba(251,191,36,0.15)' },
    restricted_zone: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>', bg: 'rgba(248,113,113,0.15)' },
    perimeter_breach: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>', bg: 'rgba(239,68,68,0.15)' },
    child_missing: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>', bg: 'rgba(239,68,68,0.15)' },
  };
  document.getElementById('dtab-activity').innerHTML = activities.length === 0 ? '<div class="detail-empty">No activity logged</div>' :
    `<div class="activity-feed">${activities.map(a => {
      const cfg = icons[a.event_type] || { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', bg: 'rgba(154,160,166,0.15)' };
      return `<div class="activity-item"><div class="activity-icon" style="background:${cfg.bg}">${cfg.icon}</div><div style="flex:1">${a.description}</div><div class="activity-time">${new Date(a.created_at).toLocaleTimeString('en-PK')}</div></div>`;
    }).join('')}</div>`;
}

function updateOrphanageRisk(id, level) {
  const o = orphanages.find(x => x.id === id);
  if (o) { o.risk_level = level; renderOrphanageGrid(); updateStatusBar(); }
}

// Stats
async function loadStats() {
  try {
    const res = await fetch('/api/stats' + qs(currentFilter));
    const d = await res.json();
    document.getElementById('stat-children').textContent = d.totalChildren;
    document.getElementById('stat-visitors').textContent = d.activeVisitors;
    document.getElementById('stat-alerts').textContent = d.pendingAlerts;
    document.getElementById('stat-incidents').textContent = d.openIncidents;
    document.getElementById('stat-orphanages').textContent = d.totalOrphanages;
    document.getElementById('stat-online').textContent = d.onlineOrphanages;
    pendingAlerts = d.pendingAlerts;
    openIncidents = d.openIncidents;
    updateBadges();
  } catch (e) { console.error(e); }
}

function updateBadges() {
  const ab = document.getElementById('alert-badge');
  ab.style.display = pendingAlerts > 0 ? 'inline' : 'none';
  ab.textContent = pendingAlerts;
  const ib = document.getElementById('incident-badge');
  ib.style.display = openIncidents > 0 ? 'inline' : 'none';
  ib.textContent = openIncidents;
}

// Zone updates
function updateZoneCard(zoneName, count) {
  document.querySelectorAll('.zone-card').forEach(card => {
    if (card.querySelector('.zone-name')?.textContent.trim() === zoneName)
      card.querySelector('.zone-count').textContent = count;
  });
}

// Alerts
function renderAlertItem(a) {
  const time = new Date(a.created_at).toLocaleTimeString('en-PK');
  return `<div class="alert-item ${a.acknowledged ? 'acknowledged' : ''}" id="alert-${a.id}">
    <div class="alert-severity ${a.severity}"></div>
    <div class="alert-content">
      <div class="alert-msg">${a.message}</div>
      <div class="alert-time">${a.type.replace(/_/g, ' ').toUpperCase()} &middot; ${time}</div>
    </div>
    <div class="alert-actions">
      ${!a.acknowledged ? `<button class="btn-ack" onclick="acknowledgeAlert(${a.id})">Acknowledge</button>` : '<span style="color:var(--success);font-size:12px">Resolved</span>'}
    </div>
  </div>`;
}

function handleNewAlert(alert) {
  orphanageAlertCounts[alert.orphanage_id] = (orphanageAlertCounts[alert.orphanage_id] || 0) + 1;
  renderOrphanageGrid();
  if (currentFilter && alert.orphanage_id !== parseInt(currentFilter)) return;
  pendingAlerts++;
  updateBadges();
  document.getElementById('stat-alerts').textContent = pendingAlerts;
  const list = document.getElementById('alerts-list');
  if (list.children.length > 0) list.insertAdjacentHTML('afterbegin', renderAlertItem(alert));
}

async function loadAlerts() {
  try {
    const res = await fetch('/api/alerts' + qs(currentFilter));
    const alerts = await res.json();
    cachedAlerts = alerts;
    document.getElementById('alerts-list').innerHTML = alerts.map(renderAlertItem).join('');
    const searchEl = document.getElementById('alerts-search');
    if (searchEl) searchEl.value = '';
  } catch (e) { console.error(e); }
}

async function acknowledgeAlert(id) {
  await fetch(`/api/alerts/${id}/acknowledge`, { method: 'PUT' });
  pendingAlerts = Math.max(0, pendingAlerts - 1);
  updateBadges();
  document.getElementById('stat-alerts').textContent = pendingAlerts;
}

function markAlertAcknowledged(id) {
  const el = document.getElementById('alert-' + id);
  if (el) { el.classList.add('acknowledged'); const btn = el.querySelector('.btn-ack'); if (btn) btn.outerHTML = '<span style="color:var(--success);font-size:12px">Resolved</span>'; }
}

// Incidents (Violence/Harassment Detection)
const incidentIcons = {
  physical_violence: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M3.26 19h17.48a1 1 0 0 0 .87-1.5L13.37 3.5a1 1 0 0 0-1.74 0L3.39 17.5a1 1 0 0 0 .87 1.5z"/></svg>',
  verbal_abuse: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  harassment: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  bullying: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M3.26 19h17.48a1 1 0 0 0 .87-1.5L13.37 3.5a1 1 0 0 0-1.74 0L3.39 17.5a1 1 0 0 0 .87 1.5z"/></svg>',
  neglect: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  distress: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  rough_handling: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  unauthorized_contact: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>'
};

function renderIncidentItem(i) {
  const time = new Date(i.detected_at).toLocaleString('en-PK');
  const icon = incidentIcons[i.type] || '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M3.26 19h17.48a1 1 0 0 0 .87-1.5L13.37 3.5a1 1 0 0 0-1.74 0L3.39 17.5a1 1 0 0 0 .87 1.5z"/></svg>';
  return `<div class="incident-item ${i.severity} ${i.reviewed ? 'reviewed' : ''}" onclick="viewIncident(${i.id})">
    <div class="incident-icon ${i.severity}">${icon}</div>
    <div class="incident-content">
      <div class="inc-label">${i.label}</div>
      <div class="inc-desc">${i.description}</div>
      <div class="inc-meta">
        <span>${time}</span>
        <span>Scripted sample</span>
        <span>No model output or confidence score</span>
      </div>
    </div>
    <div style="text-align:right">
      <span class="risk-badge ${i.severity}">${i.severity}</span>
      ${i.reviewed ? '<div style="color:var(--success);font-size:11px;margin-top:6px">Reviewed</div>' : '<div style="color:var(--warning);font-size:11px;margin-top:6px">Pending Review</div>'}
    </div>
  </div>`;
}

function handleNewIncident(incident) {
  orphanageIncidentCounts[incident.orphanage_id] = (orphanageIncidentCounts[incident.orphanage_id] || 0) + 1;
  renderOrphanageGrid();
  updateStatusBar();
  if (currentFilter && incident.orphanage_id !== parseInt(currentFilter)) return;
  openIncidents++;
  updateBadges();
  document.getElementById('stat-incidents').textContent = openIncidents;
  const cmdList = document.getElementById('command-incidents');
  if (cmdList) { cmdList.insertAdjacentHTML('afterbegin', renderIncidentItem(incident)); if (cmdList.children.length > 5) cmdList.lastChild.remove(); }
  const list = document.getElementById('incidents-list');
  if (list.children.length > 0) list.insertAdjacentHTML('afterbegin', renderIncidentItem(incident));
  if (incident.severity === 'critical' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('CRITICAL: ' + incident.label, { body: incident.description });
  }
}

async function loadIncidents() {
  try {
      const res = await fetch('/api/incidents' + qs(currentFilter));
    const incidents = await res.json();
    cachedIncidents = incidents;
    document.getElementById('incidents-list').innerHTML = incidents.map(renderIncidentItem).join('') || '<p style="color:var(--text-secondary);padding:20px">No incidents detected yet.</p>';
    document.getElementById('command-incidents').innerHTML = incidents.slice(0, 5).map(renderIncidentItem).join('');
    const searchEl = document.getElementById('incidents-search');
    if (searchEl) searchEl.value = '';

    const types = {};
    incidents.forEach(i => { types[i.type] = (types[i.type] || 0) + 1; });
    const critical = incidents.filter(i => i.severity === 'critical' && !i.reviewed).length;
    const reviewed = incidents.filter(i => i.reviewed).length;
    document.getElementById('detection-stats').innerHTML = `
      <div class="det-stat"><div class="det-val" style="color:var(--accent)">${incidents.length}</div><div class="det-label">Sample scenarios</div></div>
      <div class="det-stat"><div class="det-val" style="color:var(--warning)">${incidents.length - reviewed}</div><div class="det-label">Awaiting demo review</div></div>
      <div class="det-stat"><div class="det-val" style="color:var(--success)">${reviewed}</div><div class="det-label">Reviewed in demo</div></div>
      <div class="det-stat"><div class="det-val" style="color:var(--text-tertiary)">—</div><div class="det-label">No model score</div></div>
    `;
  } catch (e) { console.error(e); }
}

async function viewIncident(id) {
  try {
    const res = await fetch('/api/incidents');
    const incidents = await res.json();
    const i = incidents.find(x => x.id === id);
    if (!i) return;
    document.getElementById('incident-detail').innerHTML = `
      <div style="margin-bottom:16px">
        <span class="risk-badge ${i.severity}" style="font-size:12px">${i.severity.toUpperCase()}</span>
        <span style="margin-left:8px;font-size:11px;color:var(--text-secondary)">${i.reviewed ? 'REVIEWED' : 'PENDING REVIEW'}</span>
      </div>
      <h4 style="margin-bottom:8px">${i.label}</h4>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">${i.description}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
        <div><strong>Source:</strong> Scripted sample scenario</div>
        <div><strong>AI model:</strong> Not connected</div>
        <div><strong>Frames analyzed:</strong> None</div>
        <div><strong>Zone:</strong> ${i.zone || 'N/A'}</div>
        <div><strong>Orphanage:</strong> ${i.orphanage_name || 'N/A'}</div>
        <div><strong>Detected:</strong> ${new Date(i.detected_at).toLocaleString('en-PK')}</div>
      </div>
    `;
    const btn = document.getElementById('btn-review-incident');
    btn.onclick = async () => {
      await fetch(`/api/incidents/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'reviewed', reviewed: true }) });
      closeModal('incident-modal');
      loadIncidents();
      loadStats();
    };
    btn.textContent = i.reviewed ? 'Already Reviewed' : 'Mark as Reviewed';
    btn.disabled = i.reviewed;
    openModal('incident-modal');
  } catch (e) { console.error(e); }
}

// Add Orphanage
async function addOrphanage(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  data.total_children = parseInt(data.total_children) || 0;
  data.staff_count = parseInt(data.staff_count) || 0;
  data.cameras = parseInt(data.cameras) || 0;
  data.lat = parseFloat(data.lat) || 31.5;
  data.lng = parseFloat(data.lng) || 74.3;
  await fetch('/api/orphanages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  form.reset();
  closeModal('orphanage-modal');
  loadOrphanages();
  loadStats();
}

// Children
function renderChildRow(c) {
  const getOrg = (id) => { const o = orphanages.find(x => x.id === id); return o ? o.name : '-'; };
  return `<tr>
    <td><strong>${c.name}</strong></td><td>${c.age}</td><td>${c.gender}</td>
    <td>${getOrg(c.orphanage_id)}</td>
    <td>${new Date(c.admitted_date).toLocaleDateString('en-PK')}</td>
    <td>${c.medical_notes || '-'}</td>
    <td style="display:flex;gap:6px"><button class="btn btn-outline btn-sm" onclick="viewHealth(${c.id},'${c.name}')">Health</button><button class="btn btn-outline btn-sm" style="border-color:var(--accent);color:var(--accent)" onclick="viewGrowth(${c.id},'${c.name}')">Growth</button></td>
  </tr>`;
}

async function loadChildren() {
  try {
    const res = await fetch('/api/children' + qs(currentFilter));
    const children = await res.json();
    cachedChildren = children;
    document.getElementById('children-table').innerHTML = children.map(renderChildRow).join('');
    const searchEl = document.getElementById('children-search');
    if (searchEl) searchEl.value = '';
  } catch (e) { console.error(e); }
}

async function addChild(e) {
  e.preventDefault();
  const form = e.target;
  await fetch('/api/children', { method: 'POST', body: new FormData(form) });
  form.reset(); closeModal('child-modal'); loadChildren(); loadStats();
}

async function viewHealth(childId, name) {
  document.getElementById('health-child-id').value = childId;
  const res = await fetch(`/api/children/${childId}/health`);
  const records = await res.json();
  const modal = document.getElementById('health-modal');
  modal.querySelector('h3').textContent = `Health Records - ${name}`;
  const existing = modal.querySelector('.health-timeline');
  if (existing) existing.remove();
  let html = '<div class="health-timeline">';
  if (!records.length) html += '<p style="color:var(--text-secondary);font-size:13px">No records yet.</p>';
  else html += records.map(r => `<div class="timeline-item"><div class="timeline-date">${new Date(r.record_date).toLocaleDateString('en-PK')}</div><div class="timeline-type">${r.record_type}</div><div class="timeline-desc">${r.description}${r.doctor_name ? ' - Dr. ' + r.doctor_name : ''}</div>${r.next_due ? `<div class="timeline-desc" style="color:var(--warning)">Next: ${new Date(r.next_due).toLocaleDateString('en-PK')}</div>` : ''}</div>`).join('');
  html += '</div>';
  document.getElementById('health-form').insertAdjacentHTML('beforebegin', html);
  openModal('health-modal');
}

async function addHealthRecord(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const childId = data.child_id; delete data.child_id;
  await fetch(`/api/children/${childId}/health`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  closeModal('health-modal'); form.reset();
}

// Visitors
function renderVisitorRow(v) {
  const getOrg = (id) => { const o = orphanages.find(x => x.id === id); return o ? o.name : '-'; };
  return `<tr>
    <td><strong>${v.name}</strong></td><td>${v.cnic || '-'}</td><td>${v.phone || '-'}</td><td>${v.purpose}</td>
    <td>${getOrg(v.orphanage_id)}</td>
    <td>${new Date(v.check_in).toLocaleString('en-PK')}</td>
    <td><span class="badge-status ${v.status}">${v.status.replace('_', ' ')}</span></td>
    <td>${v.status === 'checked_in' ? `<button class="btn btn-outline btn-sm" onclick="checkoutVisitor(${v.id})">Check Out</button>` : ''}</td>
  </tr>`;
}

async function loadVisitors() {
  try {
    const res = await fetch('/api/visitors' + qs(currentFilter));
    const visitors = await res.json();
    cachedVisitors = visitors;
    document.getElementById('visitors-table').innerHTML = visitors.map(renderVisitorRow).join('');
    const searchEl = document.getElementById('visitors-search');
    if (searchEl) searchEl.value = '';
  } catch (e) { console.error(e); }
}

async function addVisitor(e) {
  e.preventDefault();
  const form = e.target;
  await fetch('/api/visitors', { method: 'POST', body: new FormData(form) });
  form.reset(); closeModal('visitor-modal'); loadVisitors(); loadStats();
}

async function checkoutVisitor(id) {
  await fetch(`/api/visitors/${id}/checkout`, { method: 'PUT' });
  loadVisitors(); loadStats();
}

// Activity
const activityIcons = {
  visitor_entry: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>', bg: 'rgba(79,140,255,0.15)' },
  ai_detection: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><path d="M12 9v4m0 4h.01M3.26 19h17.48a1 1 0 0 0 .87-1.5L13.37 3.5a1 1 0 0 0-1.74 0L3.39 17.5a1 1 0 0 0 .87 1.5z"/></svg>', bg: 'rgba(239,68,68,0.15)' },
  headcount_mismatch: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>', bg: 'rgba(251,191,36,0.15)' },
  restricted_zone: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>', bg: 'rgba(248,113,113,0.15)' },
  perimeter_breach: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>', bg: 'rgba(239,68,68,0.15)' },
  child_missing: { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>', bg: 'rgba(239,68,68,0.15)' },
};

function renderActivityItem(a) {
  const cfg = activityIcons[a.event_type] || { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', bg: 'rgba(154,160,166,0.15)' };
  return `<div class="activity-item"><div class="activity-icon" style="background:${cfg.bg}">${cfg.icon}</div><div>${a.description}</div><div class="activity-time">${new Date(a.created_at).toLocaleTimeString('en-PK')}</div></div>`;
}

async function loadActivity() {
  try {
    const res = await fetch('/api/activity' + qs(currentFilter));
    const activities = await res.json();
    cachedActivities = activities;
    document.getElementById('activity-feed').innerHTML = activities.map(renderActivityItem).join('') || '<p style="color:var(--text-secondary);padding:20px">No activity yet.</p>';
    const searchEl = document.getElementById('activity-search');
    if (searchEl) searchEl.value = '';
  } catch (e) { console.error(e); }
}

// Notifications
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();

// ====== PAGE FILTERS ======
function filterChildren(query) {
  const q = query.toLowerCase().trim();
  if (!q) { document.getElementById('children-table').innerHTML = cachedChildren.map(renderChildRow).join(''); return; }
  const getOrg = (id) => { const o = orphanages.find(x => x.id === id); return o ? o.name : '-'; };
  const filtered = cachedChildren.filter(c =>
    c.name.toLowerCase().includes(q) ||
    String(c.age).includes(q) ||
    c.gender.toLowerCase().includes(q) ||
    getOrg(c.orphanage_id).toLowerCase().includes(q) ||
    (c.medical_notes || '').toLowerCase().includes(q)
  );
  document.getElementById('children-table').innerHTML = filtered.map(renderChildRow).join('') ||
    '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:24px">No children match your search</td></tr>';
}

function filterVisitors(query) {
  const q = query.toLowerCase().trim();
  if (!q) { document.getElementById('visitors-table').innerHTML = cachedVisitors.map(renderVisitorRow).join(''); return; }
  const getOrg = (id) => { const o = orphanages.find(x => x.id === id); return o ? o.name : '-'; };
  const filtered = cachedVisitors.filter(v =>
    v.name.toLowerCase().includes(q) ||
    (v.cnic || '').includes(q) ||
    (v.phone || '').includes(q) ||
    v.purpose.toLowerCase().includes(q) ||
    getOrg(v.orphanage_id).toLowerCase().includes(q) ||
    v.status.toLowerCase().includes(q)
  );
  document.getElementById('visitors-table').innerHTML = filtered.map(renderVisitorRow).join('') ||
    '<tr><td colspan="8" style="text-align:center;color:var(--text-tertiary);padding:24px">No visitors match your search</td></tr>';
}

function filterAlerts(query) {
  const q = query.toLowerCase().trim();
  if (!q) { document.getElementById('alerts-list').innerHTML = cachedAlerts.map(renderAlertItem).join(''); return; }
  const filtered = cachedAlerts.filter(a =>
    a.message.toLowerCase().includes(q) ||
    a.type.toLowerCase().includes(q) ||
    a.severity.toLowerCase().includes(q)
  );
  document.getElementById('alerts-list').innerHTML = filtered.map(renderAlertItem).join('') ||
    '<p style="color:var(--text-tertiary);padding:24px;text-align:center">No alerts match your search</p>';
}

function filterIncidents(query) {
  const q = query.toLowerCase().trim();
  if (!q) { document.getElementById('incidents-list').innerHTML = cachedIncidents.map(renderIncidentItem).join(''); return; }
  const filtered = cachedIncidents.filter(i =>
    i.label.toLowerCase().includes(q) ||
    i.description.toLowerCase().includes(q) ||
    i.type.toLowerCase().includes(q) ||
    i.severity.toLowerCase().includes(q) ||
    (i.zone || '').toLowerCase().includes(q) ||
    (i.orphanage_name || '').toLowerCase().includes(q)
  );
  document.getElementById('incidents-list').innerHTML = filtered.map(renderIncidentItem).join('') ||
    '<p style="color:var(--text-tertiary);padding:24px;text-align:center">No incidents match your search</p>';
}

function filterActivity(query) {
  const q = query.toLowerCase().trim();
  if (!q) { document.getElementById('activity-feed').innerHTML = cachedActivities.map(renderActivityItem).join(''); return; }
  const filtered = cachedActivities.filter(a =>
    a.description.toLowerCase().includes(q) ||
    a.event_type.toLowerCase().includes(q)
  );
  document.getElementById('activity-feed').innerHTML = filtered.map(renderActivityItem).join('') ||
    '<p style="color:var(--text-tertiary);padding:24px;text-align:center">No activity matches your search</p>';
}

// ====== GLOBAL SEARCH ======
function openGlobalSearch() {
  document.getElementById('search-overlay').classList.add('active');
  const input = document.getElementById('global-search-input');
  input.value = '';
  input.focus();
  document.getElementById('global-search-results').innerHTML = '<div class="search-empty">Type to search across all data...</div>';
}

function closeGlobalSearch() {
  document.getElementById('search-overlay').classList.remove('active');
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    openGlobalSearch();
  }
  if (e.key === 'Escape' && document.getElementById('search-overlay').classList.contains('active')) {
    closeGlobalSearch();
  }
});

function navigateToPage(page) {
  closeGlobalSearch();
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');
  document.getElementById('page-' + page).classList.add('active');
  if (page === 'map') initMap();
  if (page === 'cameras') initCameras();
  if (page === 'children') loadChildren();
  if (page === 'visitors') loadVisitors();
  if (page === 'alerts') loadAlerts();
  if (page === 'incidents') loadIncidents();
  if (page === 'rankings') loadRankings();
  if (page === 'portal') loadPortal();
  if (page === 'activity') loadActivity();
  if (page === 'analytics') loadAnalytics();
  if (page === 'emotions') loadEmotions();
  if (page === 'anomalies') loadAnomalies();
  if (page === 'briefing') loadBriefing();
}

function highlightMatch(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return text.slice(0, idx) + '<mark style="background:var(--accent);color:#000;border-radius:2px;padding:0 1px">' + text.slice(idx, idx + query.length) + '</mark>' + text.slice(idx + query.length);
}

function runGlobalSearch(query) {
  const q = query.toLowerCase().trim();
  const results = document.getElementById('global-search-results');

  if (!q) {
    results.innerHTML = '<div class="search-empty">Type to search across all data...</div>';
    return;
  }

  let html = '';
  let totalResults = 0;

  // Search orphanages
  const matchedOrphanages = orphanages.filter(o =>
    o.name.toLowerCase().includes(q) ||
    o.city.toLowerCase().includes(q) ||
    o.district.toLowerCase().includes(q) ||
    (o.address || '').toLowerCase().includes(q)
  );
  if (matchedOrphanages.length) {
    html += '<div class="search-category">Orphanages</div>';
    matchedOrphanages.slice(0, 5).forEach(o => {
      const riskColor = 'var(--accent)';
      html += `<div class="search-result-item" onclick="openOrphanageDetail(${o.id})">
        <div class="search-result-icon" style="background:rgba(16,185,129,0.15)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
        <div class="search-result-info">
          <div class="search-result-title">${highlightMatch(o.name, q)}</div>
          <div class="search-result-sub">${highlightMatch(o.city, q)} &middot; Illustrative facility profile</div>
        </div>
        <span class="search-result-badge" style="background:${riskColor}20;color:${riskColor}">SAMPLE</span>
      </div>`;
    });
    totalResults += matchedOrphanages.length;
  }

  // Search children
  const getOrg = (id) => { const o = orphanages.find(x => x.id === id); return o ? o.name : '-'; };
  const matchedChildren = cachedChildren.filter(c =>
    c.name.toLowerCase().includes(q) ||
    String(c.age).includes(q) ||
    getOrg(c.orphanage_id).toLowerCase().includes(q)
  );
  if (matchedChildren.length) {
    html += '<div class="search-category">Children</div>';
    matchedChildren.slice(0, 5).forEach(c => {
      html += `<div class="search-result-item" onclick="navigateToPage('children')">
        <div class="search-result-icon" style="background:rgba(79,140,255,0.15)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
        <div class="search-result-info">
          <div class="search-result-title">${highlightMatch(c.name, q)}</div>
          <div class="search-result-sub">Age ${c.age} &middot; ${c.gender} &middot; ${getOrg(c.orphanage_id)}</div>
        </div>
      </div>`;
    });
    totalResults += matchedChildren.length;
  }

  // Search visitors
  const matchedVisitors = cachedVisitors.filter(v =>
    v.name.toLowerCase().includes(q) ||
    (v.cnic || '').includes(q) ||
    (v.phone || '').includes(q) ||
    v.purpose.toLowerCase().includes(q)
  );
  if (matchedVisitors.length) {
    html += '<div class="search-category">Visitors</div>';
    matchedVisitors.slice(0, 5).forEach(v => {
      const statusColor = v.status === 'checked_in' ? 'var(--success)' : 'var(--text-tertiary)';
      html += `<div class="search-result-item" onclick="navigateToPage('visitors')">
        <div class="search-result-icon" style="background:rgba(139,92,246,0.15)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
        <div class="search-result-info">
          <div class="search-result-title">${highlightMatch(v.name, q)}</div>
          <div class="search-result-sub">${v.purpose} &middot; ${v.cnic || 'No CNIC'}</div>
        </div>
        <span class="search-result-badge" style="background:${statusColor}20;color:${statusColor}">${v.status.replace('_', ' ')}</span>
      </div>`;
    });
    totalResults += matchedVisitors.length;
  }

  // Search alerts
  const matchedAlerts = cachedAlerts.filter(a =>
    a.message.toLowerCase().includes(q) ||
    a.type.toLowerCase().includes(q)
  );
  if (matchedAlerts.length) {
    html += '<div class="search-category">Alerts</div>';
    matchedAlerts.slice(0, 5).forEach(a => {
      const sevColor = a.severity === 'critical' ? 'var(--danger)' : a.severity === 'high' ? 'var(--warning)' : 'var(--accent)';
      html += `<div class="search-result-item" onclick="navigateToPage('alerts')">
        <div class="search-result-icon" style="background:rgba(239,68,68,0.15)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg></div>
        <div class="search-result-info">
          <div class="search-result-title">${highlightMatch(a.message.slice(0, 80), q)}</div>
          <div class="search-result-sub">${a.type.replace(/_/g, ' ')} &middot; ${a.acknowledged ? 'Resolved' : 'Pending'}</div>
        </div>
        <span class="search-result-badge" style="background:${sevColor}20;color:${sevColor}">${a.severity}</span>
      </div>`;
    });
    totalResults += matchedAlerts.length;
  }

  // Search incidents
  const matchedIncidents = cachedIncidents.filter(i =>
    i.label.toLowerCase().includes(q) ||
    i.description.toLowerCase().includes(q) ||
    i.type.toLowerCase().includes(q) ||
    (i.orphanage_name || '').toLowerCase().includes(q)
  );
  if (matchedIncidents.length) {
    html += '<div class="search-category">Scripted Scenarios</div>';
    matchedIncidents.slice(0, 5).forEach(i => {
      const sevColor = i.severity === 'critical' ? 'var(--danger)' : i.severity === 'high' ? 'var(--warning)' : 'var(--accent)';
      html += `<div class="search-result-item" onclick="navigateToPage('incidents')">
        <div class="search-result-icon" style="background:rgba(239,68,68,0.15)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><path d="M12 9v4m0 4h.01M3.26 19h17.48a1 1 0 0 0 .87-1.5L13.37 3.5a1 1 0 0 0-1.74 0L3.39 17.5a1 1 0 0 0 .87 1.5z"/></svg></div>
        <div class="search-result-info">
          <div class="search-result-title">${highlightMatch(i.label, q)}</div>
          <div class="search-result-sub">Scripted sample &middot; no model output &middot; ${i.orphanage_name || ''}</div>
        </div>
        <span class="search-result-badge" style="background:${sevColor}20;color:${sevColor}">DEMO</span>
      </div>`;
    });
    totalResults += matchedIncidents.length;
  }

  if (!totalResults) {
    html = `<div class="search-no-results">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <div>No results for "<strong>${query}</strong>"</div>
      <div style="font-size:12px;margin-top:4px">Try searching by name, city, type, or status</div>
    </div>`;
  }

  results.innerHTML = html;
}

// ====== NOTIFICATION CENTER ======
let notifUnreadCount = 0;

function toggleNotifCenter() {
  document.getElementById('notif-panel').classList.toggle('open');
  if (document.getElementById('notif-panel').classList.contains('open')) loadNotifications();
}

async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications');
    const notifs = await res.json();
    const list = document.getElementById('notif-panel-list');
    if (!notifs.length) {
      list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-tertiary)">No notifications yet</div>';
      return;
    }
    list.innerHTML = notifs.map(n => {
      const time = timeAgo(new Date(n.created_at));
      const icons = { security_alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>', ai_detection: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2"><path d="M12 9v4m0 4h.01M3.26 19h17.48a1 1 0 0 0 .87-1.5L13.37 3.5a1 1 0 0 0-1.74 0L3.39 17.5a1 1 0 0 0 .87 1.5z"/></svg>', emotion_alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>' };
      const icon = icons[n.type] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>';
      const bgColors = { security_alert: 'rgba(239,68,68,0.15)', ai_detection: 'rgba(139,92,246,0.15)', emotion_alert: 'rgba(251,191,36,0.15)' };
      return `<div class="notif-item ${n.read ? '' : 'unread'} ${n.severity || ''}" onclick="markNotifRead(${n.id})">
        <div class="notif-icon" style="background:${bgColors[n.type] || 'rgba(16,185,129,0.15)'}">${icon}</div>
        <div class="notif-info">
          <div class="notif-title">${n.title}</div>
          <div class="notif-msg">${n.message}</div>
          <div class="notif-time">${time}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) { console.error(e); }
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

async function markNotifRead(id) {
  await fetch(`/api/notifications/${id}/read`, { method: 'PUT' });
  loadNotifications();
  updateNotifCount();
}

async function markAllNotifsRead() {
  await fetch('/api/notifications/read-all', { method: 'PUT' });
  loadNotifications();
  updateNotifCount();
}

async function updateNotifCount() {
  try {
    const res = await fetch('/api/notifications/unread-count');
    const { count } = await res.json();
    notifUnreadCount = count;
    const badge = document.getElementById('notif-count');
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  } catch (e) { /* ignore */ }
}

function handleNewNotification(notif) {
  notifUnreadCount++;
  const badge = document.getElementById('notif-count');
  badge.textContent = notifUnreadCount > 99 ? '99+' : notifUnreadCount;
  badge.style.display = 'flex';
  if (document.getElementById('notif-panel').classList.contains('open')) loadNotifications();
}

setInterval(updateNotifCount, 15000);

// ====== ANALYTICS / CHARTS ======
let incidentChart, alertTypeChart, severityChart;

async function loadAnalytics() {
  try {
    const [timelineRes, typesRes, incidentsRes] = await Promise.all([
      fetch('/api/analytics/incidents-timeline' + qs(currentFilter)),
      fetch('/api/analytics/alerts-by-type' + qs(currentFilter)),
      fetch('/api/incidents' + qs(currentFilter)),
    ]);
    const timeline = await timelineRes.json();
    const alertTypes = await typesRes.json();
    const incidents = await incidentsRes.json();

    // Incidents timeline line chart
    const ctx1 = document.getElementById('chart-incidents-timeline');
    if (incidentChart) incidentChart.destroy();
    incidentChart = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: timeline.map(d => d.date.slice(5)),
        datasets: [{
          label: 'Total Incidents',
          data: timeline.map(d => d.total),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#10b981',
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#8a8a9a' } } },
        scales: {
          x: { ticks: { color: '#55555f' }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { color: '#55555f' }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
        }
      }
    });

    // Alerts by type doughnut
    const ctx2 = document.getElementById('chart-alerts-type');
    if (alertTypeChart) alertTypeChart.destroy();
    const colors = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
    alertTypeChart = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: alertTypes.map(a => a.type),
        datasets: [{
          data: alertTypes.map(a => a.count),
          backgroundColor: colors.slice(0, alertTypes.length),
          borderColor: '#111114',
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#8a8a9a', padding: 16, usePointStyle: true } }
        }
      }
    });

    // Severity breakdown bar chart
    const severities = { critical: 0, high: 0, medium: 0, low: 0 };
    incidents.forEach(i => { severities[i.severity] = (severities[i.severity] || 0) + 1; });
    const ctx3 = document.getElementById('chart-severity');
    if (severityChart) severityChart.destroy();
    severityChart = new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low'],
        datasets: [{
          label: 'Count',
          data: [severities.critical, severities.high, severities.medium, severities.low || 0],
          backgroundColor: ['#ef4444', '#f59e0b', '#06b6d4', '#10b981'],
          borderRadius: 6,
          barThickness: 40,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#8a8a9a' }, grid: { display: false } },
          y: { ticks: { color: '#55555f' }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
        }
      }
    });
  } catch (e) { console.error(e); }
}

// ====== CHILD GROWTH TRACKER ======
let growthChart;

async function viewGrowth(childId, name) {
  document.getElementById('growth-child-id').value = childId;
  document.getElementById('growth-modal-title').textContent = `Growth Tracker - ${name}`;
  document.getElementById('growth-form').reset();

  try {
    const res = await fetch(`/api/children/${childId}/growth`);
    const records = await res.json();

    // Render chart
    const ctx = document.getElementById('chart-growth');
    if (growthChart) growthChart.destroy();
    if (records.length > 1) {
      const sorted = [...records].reverse();
      growthChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: sorted.map(r => r.recorded_date),
          datasets: [
            { label: 'Height (cm)', data: sorted.map(r => r.height_cm), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: false, tension: 0.3, yAxisID: 'y' },
            { label: 'Weight (kg)', data: sorted.map(r => r.weight_kg), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.1)', fill: false, tension: 0.3, yAxisID: 'y1' },
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#8a8a9a' } } },
          scales: {
            x: { ticks: { color: '#55555f' }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { type: 'linear', position: 'left', ticks: { color: '#10b981' }, grid: { color: 'rgba(255,255,255,0.04)' }, title: { display: true, text: 'Height (cm)', color: '#10b981' } },
            y1: { type: 'linear', position: 'right', ticks: { color: '#8b5cf6' }, grid: { display: false }, title: { display: true, text: 'Weight (kg)', color: '#8b5cf6' } }
          }
        }
      });
      document.getElementById('growth-chart-container').style.display = 'block';
    } else {
      document.getElementById('growth-chart-container').style.display = records.length ? 'none' : 'none';
    }

    // Render history
    document.getElementById('growth-history').innerHTML = records.length
      ? '<h4 style="margin:16px 0 8px;font-size:13px;color:var(--text-secondary)">History</h4>' + records.map(r => `
        <div class="growth-record">
          <span class="growth-date">${r.recorded_date}</span>
          <span class="growth-val">${r.height_cm} cm</span>
          <span class="growth-val">${r.weight_kg} kg</span>
          <span class="growth-val" style="color:var(--accent)">BMI ${r.bmi}</span>
          <span style="color:var(--text-secondary);font-size:12px">${r.notes || ''}</span>
        </div>`).join('')
      : '<p style="color:var(--text-tertiary);font-size:12px;margin-top:12px">No growth records yet. Add the first one above.</p>';

    openModal('growth-modal');
  } catch (e) { console.error(e); }
}

async function addGrowthRecord(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const childId = data.child_id; delete data.child_id;
  await fetch(`/api/children/${childId}/growth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const name = document.getElementById('growth-modal-title').textContent.replace('Growth Tracker - ', '');
  viewGrowth(childId, name);
}

// ====== ANOMALY DETECTION ======
async function loadAnomalies() {
  try {
    const res = await fetch('/api/analytics/anomalies');
    const anomalies = await res.json();

    document.getElementById('anomaly-list').innerHTML = anomalies.map(a => {
      const changeClass = a.change_percent > 0 ? 'up' : a.change_percent < 0 ? 'down' : 'flat';
      const changeText = a.change_percent > 0 ? `+${a.change_percent}%` : a.change_percent < 0 ? `${a.change_percent}%` : '0%';
      const arrow = a.change_percent > 0 ? '&#9650;' : a.change_percent < 0 ? '&#9660;' : '&#8212;';
      return `<div class="anomaly-card ${a.anomaly_level}">
        <div>
          <div class="anomaly-name">${a.name}</div>
          <div class="anomaly-city">${a.city}</div>
        </div>
        <div class="anomaly-stats">
          <div class="anomaly-stat-item">
            <div class="anomaly-stat-val">${a.incidents_this_week}</div>
            <div class="anomaly-stat-label">This Week</div>
          </div>
          <div class="anomaly-stat-item">
            <div class="anomaly-stat-val" style="color:var(--text-secondary)">${a.incidents_last_week}</div>
            <div class="anomaly-stat-label">Last Week</div>
          </div>
          <div class="anomaly-stat-item">
            <div class="anomaly-stat-val" style="color:var(--danger)">${a.critical_this_week}</div>
            <div class="anomaly-stat-label">Critical</div>
          </div>
          <div class="anomaly-stat-item">
            <div class="anomaly-stat-val" style="color:var(--warning)">${a.unresolved_alerts}</div>
            <div class="anomaly-stat-label">Unresolved</div>
          </div>
        </div>
        <div class="anomaly-change ${changeClass}">${arrow} ${changeText}</div>
      </div>`;
    }).join('') || '<p style="color:var(--text-secondary);padding:20px">No data yet.</p>';
  } catch (e) { console.error(e); }
}

// ====== COMPLAINT PORTAL ======
function showComplaintPortal() {
  const portal = document.getElementById('complaint-portal');
  portal.style.display = '';
  document.getElementById('complaint-form').style.display = '';
  document.getElementById('complaint-success').style.display = 'none';
  const sel = document.getElementById('complaint-orphanage');
  sel.innerHTML = '<option value="">Select orphanage or location</option><option value="other">Other Location (specify below)</option>' +
    orphanages.map(o => `<option value="${o.id}">${o.name} - ${o.city}</option>`).join('');
}

function hideComplaintPortal() {
  document.getElementById('complaint-portal').style.display = 'none';
}

function submitComplaint(e) {
  e.preventDefault();
  const ref = 'CPB-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  document.getElementById('complaint-ref').textContent = ref;
  document.getElementById('complaint-form').style.display = 'none';
  document.getElementById('complaint-success').style.display = '';
}

// Init - load all data so global search works
loadOrphanages();
loadStats();
loadIncidents();
loadAlerts();
loadChildren();
loadVisitors();
loadActivity();
updateNotifCount();

// Local pitch-demo overrides: sample workflows only; no live inference,
// camera access, agency links, or persistent records.
function escapeMapText(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function initMap() {
  const mapNode = document.getElementById('punjab-map');
  if (!mapNode || !window.L) return;
  if (map) { map.invalidateSize(); return; }
  map = L.map(mapNode, { zoomControl: true, scrollWheelZoom: true, preferCanvas: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO', subdomains: 'abcd', maxZoom: 19
  }).addTo(map);
  facilityLayer = window.L.markerClusterGroup
    ? L.markerClusterGroup({ showCoverageOnHover: false, spiderfyOnMaxZoom: true, maxClusterRadius: 46 })
    : L.layerGroup();
  stationLayer = L.layerGroup();
  facilityMarkers = [];
  orphanages.forEach(function (site, index) {
    if (!Number.isFinite(Number(site.lat)) || !Number.isFinite(Number(site.lng))) return;
    const icon = L.divIcon({
      html: '<span class="pitch-map-facility-pin" aria-hidden="true"></span>',
      className: 'pitch-map-pin-wrap', iconSize: [18, 18], iconAnchor: [9, 9]
    });
    const marker = L.marker([Number(site.lat), Number(site.lng)], {
      icon: icon, title: site.name + ' · illustrative sample'
    });
    const sampleNumber = String(index + 1).padStart(2, '0');
    marker.bindPopup('<div class="pitch-map-popup"><span class="popup-kicker">ILLUSTRATIVE SAMPLE ' + sampleNumber +
      '</span><strong>' + escapeMapText(site.name) + '</strong><span>' + escapeMapText(site.city) + ', ' +
      escapeMapText(site.district) + '</span><p>Approximate interface mock location. This is not a verified facility or a live status.</p>' +
      '<button onclick="viewOrphanage(' + Number(site.id) + ')">Open sample profile <span aria-hidden="true">→</span></button></div>');
    marker.bindTooltip(escapeMapText(site.city) + ' · Sample ' + sampleNumber, {
      permanent: false, direction: 'top', offset: [0, -9], className: 'pitch-map-tooltip'
    });
    facilityMarkers.push(marker);
    facilityLayer.addLayer(marker);
  });
  fetch('/api/police-stations').then(function (response) { return response.json(); }).then(function (points) {
    points.forEach(function (point) {
      const icon = L.divIcon({
        html: '<span class="pitch-map-response-pin" aria-hidden="true"></span>',
        className: 'pitch-map-pin-wrap', iconSize: [18, 18], iconAnchor: [9, 9]
      });
      const marker = L.marker([Number(point.lat), Number(point.lng)], {
        icon: icon, title: point.name + ' · illustrative sample'
      });
      marker.bindPopup('<div class="pitch-map-popup response"><span class="popup-kicker">RESPONSE WORKFLOW SAMPLE</span><strong>' +
        escapeMapText(point.name) + '</strong><span>' + escapeMapText(point.city) + ', ' + escapeMapText(point.district) +
        '</span><p>Illustrative response point only. No agency, address, phone number, or dispatch route is connected.</p></div>');
      stationLayer.addLayer(marker);
    });
    const count = document.getElementById('station-map-count');
    if (count) count.textContent = points.length + ' sample points';
    const toggle = document.getElementById('map-show-stations');
    if (toggle && toggle.checked) stationLayer.addTo(map);
  }).catch(function () {
    const count = document.getElementById('station-map-count');
    if (count) count.textContent = 'Unavailable';
  });
  facilityLayer.addTo(map);
  const facilityToggle = document.getElementById('map-show-facilities');
  const responseToggle = document.getElementById('map-show-stations');
  if (facilityToggle) facilityToggle.onchange = function () {
    facilityToggle.checked ? map.addLayer(facilityLayer) : map.removeLayer(facilityLayer);
  };
  if (responseToggle) responseToggle.onchange = function () {
    responseToggle.checked ? map.addLayer(stationLayer) : map.removeLayer(stationLayer);
  };
  const facilityCount = document.getElementById('facility-map-count');
  if (facilityCount) facilityCount.textContent = facilityMarkers.length + ' sample points';
  map.on('zoomend', updateMapLabels);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const el = L.DomUtil.create('div', 'map-demo-legend');
    el.innerHTML = '<span><i class="legend-dot"></i> Sample care site</span><span><i class="legend-square"></i> Sample response point</span>';
    return el;
  };
  legend.addTo(map);
  fitPunjabMap();
  setTimeout(function () { map.invalidateSize(); }, 180);
}

function updateMapLabels() {
  if (!map) return;
  facilityMarkers.forEach(function (marker) {
    if (map.getZoom() >= 11) marker.openTooltip();
    else marker.closeTooltip();
  });
}

function fitPunjabMap() {
  if (!map || !facilityMarkers.length) return;
  map.fitBounds(L.latLngBounds(facilityMarkers.map(function (marker) { return marker.getLatLng(); })), {
    padding: [34, 34], maxZoom: 7, animate: true
  });
}

let cameraFeeds = [];
let cameraOrgFilter = '';

async function initCameras() {
  const filter = document.getElementById('camera-org-filter');
  if (!filter) return;
  filter.innerHTML = '<option value="">All sample sites</option>' + orphanages.map(function (site) {
    return '<option value="' + site.id + '"' + (cameraOrgFilter == site.id ? ' selected' : '') + '>' +
      escapeMapText(site.name) + ' — ' + escapeMapText(site.city) + '</option>';
  }).join('');
  filter.onchange = function (event) { cameraOrgFilter = event.target.value; initCameras(); };
  const sites = cameraOrgFilter ? orphanages.filter(function (site) {
    return site.id === parseInt(cameraOrgFilter);
  }) : orphanages.slice(0, 6);
  cameraFeeds = sites.flatMap(function (site) {
    return [1, 2].map(function (view) { return { name: 'Sample view ' + view, orgName: site.name, city: site.city }; });
  });
  document.getElementById('camera-stats').innerHTML =
    '<div class="cam-stat-row">' +
      '<div class="cam-stat"><span class="cam-stat-val" style="color:var(--accent)">' + cameraFeeds.length + '</span><span class="cam-stat-label">Feed mockups</span></div>' +
      '<div class="cam-stat"><span class="cam-stat-val" style="color:var(--text-tertiary)">0</span><span class="cam-stat-label">Connected cameras</span></div>' +
      '<div class="cam-stat"><span class="cam-stat-val" style="color:var(--purple)">' + sites.length + '</span><span class="cam-stat-label">Illustrative sites</span></div>' +
      '<div class="cam-stat"><span class="cam-stat-val" style="color:var(--cyan)">0</span><span class="cam-stat-label">AI detections</span></div>' +
    '</div>';
  const grid = document.getElementById('camera-grid');
  grid.innerHTML = cameraFeeds.map(function (feed, index) {
    return '<div class="camera-feed camera-mock-card"><div class="feed-header"><div>' +
      '<span class="feed-zone-name">' + feed.name + '</span><span class="feed-org-name">' +
      escapeMapText(feed.orgName) + ' · ' + escapeMapText(feed.city) +
      '</span></div><span class="prototype-state">MOCKUP</span></div>' +
      '<div class="feed-body mock-feed-body" id="feed-' + index + '">' +
      '<canvas class="sim-canvas" id="sim-canvas-' + index + '" aria-label="Illustrative camera workflow mockup"></canvas>' +
      '<div class="mock-feed-watermark"><span>ILLUSTRATIVE FRAME</span><strong>No camera connected</strong></div></div>' +
      '<div class="mock-feed-caption">Workflow preview only · no recording, image analysis, or person detection.</div></div>';
  }).join('');
  cameraFeeds.forEach(function (feed, index) {
    drawMockFeed(document.getElementById('sim-canvas-' + index), feed.name);
  });
}

function drawMockFeed(canvas, label) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = 640;
  canvas.height = 360;
  const gradient = ctx.createLinearGradient(0, 0, 640, 360);
  gradient.addColorStop(0, '#122a35');
  gradient.addColorStop(1, '#101a2b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 640, 360);
  ctx.strokeStyle = 'rgba(143,196,186,.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 270); ctx.lineTo(190, 180); ctx.lineTo(440, 180); ctx.lineTo(640, 260);
  ctx.moveTo(95, 360); ctx.lineTo(250, 224); ctx.lineTo(405, 224); ctx.lineTo(560, 360);
  ctx.moveTo(190, 180); ctx.lineTo(190, 270); ctx.lineTo(440, 270); ctx.lineTo(440, 180);
  ctx.moveTo(250, 224); ctx.lineTo(250, 316); ctx.lineTo(405, 316); ctx.lineTo(405, 224);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(143,196,186,.1)';
  for (let i = 0; i < 7; i++) {
    ctx.beginPath(); ctx.moveTo(i * 110, 0); ctx.lineTo(i * 110, 360); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText('WORKFLOW PREVIEW', 24, 34);
  ctx.fillStyle = 'rgba(255,255,255,.42)';
  ctx.font = '12px Inter, sans-serif';
  ctx.fillText(label + ' · no image source', 24, 56);
  ctx.strokeStyle = 'rgba(16,185,129,.7)';
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(210, 194, 210, 108);
  ctx.setLineDash([]);
}

async function loadRankings() {
  try {
    const response = await fetch('/api/rankings');
    const records = await response.json();
    const average = records.length ? Math.round(records.reduce(function (sum, row) {
      return sum + row.score;
    }, 0) / records.length) : 0;
    document.getElementById('ranking-summary').innerHTML =
      '<div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="stat-card blue"><div class="label">Sample profiles</div><div class="value">' + records.length + '</div><div class="sub">Synthetic records</div></div>' +
      '<div class="stat-card green"><div class="label">Average field completeness</div><div class="value">' + average + '%</div><div class="sub">Illustrative only</div></div>' +
      '<div class="stat-card purple"><div class="label">Safety assessments</div><div class="value">0</div><div class="sub">No assessment performed</div></div></div>';
    document.getElementById('ranking-list').innerHTML = records.map(function (row) {
      const score = Math.max(0, Math.min(100, Number(row.score) || 0));
      return '<div class="rank-card">' +
        '<div class="rank-position"><div class="rank-number">' + String(row.rank).padStart(2, '0') + '</div></div>' +
        '<div class="rank-info"><div class="rank-name">' + escapeMapText(row.name) + '</div>' +
        '<div class="rank-city">' + escapeMapText(row.city) + ', ' + escapeMapText(row.district) + ' · sample site</div></div>' +
        '<div class="rank-metrics"><div class="rank-metric"><div class="rm-label">Sample fields</div><div class="rm-val">' + score + '%</div></div>' +
        '<div class="rank-metric"><div class="rm-label">Children</div><div class="rm-val">Not evaluated</div></div>' +
        '<div class="rank-metric"><div class="rm-label">Cameras</div><div class="rm-val">Not evaluated</div></div></div>' +
        '<div class="rank-score-area"><div class="prototype-state">DATA COMPLETENESS</div><div class="rank-score-bar"><div class="rank-score-fill" style="width:' + score + '%;background:var(--accent)"></div></div>' +
        '<div class="rank-score-val" style="color:var(--accent)">' + score + '%</div></div></div>';
    }).join('');
  } catch (error) { console.error(error); }
}

async function loadEmotions() {
  const modelStatus = await fetch('/api/model-status').then(function (response) { return response.json(); });
  const readiness = modelStatus.readiness || {};
  const checks = [
    ['Model artifact', readiness.model_artifact, 'No model artifact is connected'],
    ['Approved data', readiness.approved_dataset, 'No approved training or evaluation data is connected'],
    ['Independent evaluation', readiness.independent_evaluation, 'No validated performance report is available'],
    ['Safeguarding review', readiness.safeguarding_approval, 'No safeguarding approval is recorded']
  ];
  document.getElementById('emotion-stats').innerHTML =
    '<div class="readiness-banner"><div class="readiness-orb">0</div><div><strong>Inference is disabled</strong>' +
    '<p>No child image, video, emotion, identity, or abuse classification is processed by this prototype.</p></div></div>';
  document.getElementById('emotion-feed').innerHTML =
    '<div class="readiness-grid">' + checks.map(function (check, index) {
      return '<article class="readiness-card"><span class="readiness-index">0' + (index + 1) + '</span>' +
        '<strong>' + check[0] + '</strong><span class="readiness-state">' + (check[1] ? 'Available' : 'Not in place') + '</span>' +
        '<p>' + check[2] + '</p></article>';
    }).join('') + '</div>' +
    '<p class="readiness-footnote">Before any real-world evaluation, the project would need a defined, narrow task; approved and appropriately governed data; independent validation; human review; and safeguarding approval. This screen is a readiness checklist, not a model-performance claim.</p>';
}

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (username === 'admin' && password === 'admin123') {
    document.getElementById('login-screen').style.display = 'none';
    document.body.style.overflow = '';
    sessionStorage.setItem('og_auth', '1');
    return;
  }
  const button = event.target.querySelector('button[type="submit"]');
  button.textContent = 'Use the demo credentials shown above';
  button.style.background = 'var(--danger)';
  setTimeout(function () {
    button.textContent = 'Open pitch demo';
    button.style.background = '';
  }, 2200);
}

function submitComplaint(event) {
  event.preventDefault();
  const reference = 'DEMO-' + Date.now().toString(36).toUpperCase();
  document.getElementById('complaint-ref').textContent = reference;
  document.getElementById('complaint-form').style.display = 'none';
  document.getElementById('complaint-success').style.display = '';
}

function sendWAMessage() {
  const input = document.getElementById('wa-input');
  const message = input.value.trim();
  if (!message) return;
  const chat = document.getElementById('wa-chat');
  const bubble = document.createElement('div');
  bubble.className = 'wa-msg outgoing';
  const body = document.createElement('div');
  body.className = 'wa-msg-body';
  body.textContent = message;
  const time = document.createElement('div');
  time.className = 'wa-msg-time';
  time.textContent = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  bubble.append(body, time);
  chat.appendChild(bubble);
  input.value = '';
  const note = document.createElement('div');
  note.className = 'wa-msg system';
  note.innerHTML = '<div class="wa-msg-body">Local preview only. Nothing was sent to WhatsApp, an officer, or any recipient.</div>';
  chat.appendChild(note);
  chat.scrollTop = chat.scrollHeight;
}

async function generatePDFReport() {
  const stats = await fetch('/api/stats').then(function (response) { return response.json(); });
  const modelStatus = await fetch('/api/model-status').then(function (response) { return response.json(); });
  const report = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>OrphanGuard pitch-demo summary</title>' +
    '<style>body{font:15px Arial,sans-serif;color:#18221e;max-width:760px;margin:40px auto;padding:0 22px;line-height:1.55}h1{color:#087f5b;margin-bottom:4px}.stamp{display:inline-block;border:1px solid #b45309;color:#92400e;background:#fffbeb;border-radius:20px;padding:5px 12px;font-size:12px;font-weight:bold}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.card{background:#f3f7f5;padding:18px;border-radius:12px}.num{font-size:28px;font-weight:bold;color:#087f5b}.label{font-size:12px;color:#52615a}.notice{padding:16px;background:#fef3c7;border-radius:10px}footer{margin-top:34px;border-top:1px solid #ddd;padding-top:14px;color:#667;font-size:12px}@media print{body{margin:18mm auto}}</style>' +
    '</head><body><span class="stamp">SYNTHETIC PITCH DEMO · NOT AN OFFICIAL REPORT</span><h1>OrphanGuard</h1>' +
    '<p>Concept workflow summary · ' + new Date().toLocaleDateString('en-PK') + '</p><div class="grid">' +
    '<div class="card"><div class="num">' + stats.totalOrphanages + '</div><div class="label">Illustrative map points</div></div>' +
    '<div class="card"><div class="num">' + stats.totalChildren + '</div><div class="label">Synthetic sample records</div></div>' +
    '<div class="card"><div class="num">0</div><div class="label">Connected AI models</div></div></div>' +
    '<div class="notice"><strong>Scope and limits</strong><p>All records and map points are synthetic interface examples. No safety assessment, AI inference, camera feed, agency connection, or safeguarding service is operating. This preview is not evidence of a deployed or evaluated system.</p>' +
    '<p>Model status: ' + escapeMapText(modelStatus.message) + '</p></div><footer>Independent concept prototype · no government affiliation, endorsement, or certification is claimed.</footer>' +
    '<script>window.onload=function(){window.print()}<\/script></body></html>';
  const win = window.open('', '_blank');
  if (!win) { alert('Allow the print preview window to open.'); return; }
  win.document.write(report);
  win.document.close();
}

async function runDemoScenario() {
  await fetch('/api/demo/scenario', { method: 'POST' });
  await Promise.all([loadIncidents(), loadAlerts(), loadStats(), loadActivity(), updateNotifCount()]);
}

async function resetDemo() {
  await fetch('/api/demo/reset', { method: 'POST' });
  currentFilter = '';
  const filter = document.getElementById('orphanage-filter');
  if (filter) filter.value = '';
  await Promise.all([loadOrphanages(), loadIncidents(), loadAlerts(), loadStats(), loadActivity(), loadVisitors(), loadChildren(), updateNotifCount()]);
  if (map) {
    map.remove();
    map = null;
    facilityMarkers = [];
    facilityLayer = null;
    stationLayer = null;
  }
  alert('The local sample data has been reset. No external system was contacted.');
}

function checkAuth() {
  if (new URLSearchParams(window.location.search).get('preview') === '1') {
    sessionStorage.setItem('og_auth', '1');
  }
  if (sessionStorage.getItem('og_auth') === '1') {
    document.getElementById('login-screen').style.display = 'none';
  }
}

function logout() {
  sessionStorage.removeItem('og_auth');
  document.getElementById('login-screen').style.display = '';
}

function toggleWhatsAppPanel() {
  document.getElementById('whatsapp-panel').classList.toggle('open');
}

function handleEmotionDetection() {
  // This prototype has no emotion inference path.
}

checkAuth();

function renderOrphanageGrid(filter) {
  const grid = document.getElementById('orphanage-grid');
  if (!grid) return;
  const query = (filter || '').toLowerCase();
  const records = orphanages.filter(function (site) {
    return !query || [site.name, site.city, site.district].some(function (value) {
      return String(value).toLowerCase().includes(query);
    });
  });
  grid.innerHTML = records.map(function (site) {
    const completeness = orphanageRankings[site.id] ? Number(orphanageRankings[site.id].data_completeness) || 0 : 0;
    return '<article class="orphanage-card" onclick="openOrphanageDetail(' + Number(site.id) + ')">' +
      '<div class="oc-header"><div><div class="oc-name">' + escapeMapText(site.name) + '</div>' +
      '<div class="oc-city">' + escapeMapText(site.city) + ', ' + escapeMapText(site.district) + '</div></div>' +
      '<span class="prototype-state">SAMPLE</span></div>' +
      '<div class="oc-score-row"><span class="oc-rank">Profile</span><div class="oc-score-bar"><div class="oc-score-fill" style="width:' + completeness + '%;background:var(--accent)"></div></div>' +
      '<span class="oc-score-text" style="color:var(--accent)">Fields ' + completeness + '%</span></div>' +
      '<div class="oc-stats"><div class="oc-stat"><div class="oc-stat-val">' + Number(site.total_children) + '</div><div class="oc-stat-label">Sample records</div></div>' +
      '<div class="oc-stat"><div class="oc-stat-val">' + Number(site.staff_count) + '</div><div class="oc-stat-label">Illustrative staff</div></div>' +
      '<div class="oc-stat"><div class="oc-stat-val">0</div><div class="oc-stat-label">Connected feeds</div></div></div></article>';
  }).join('') || '<p class="detail-empty">No sample profiles match this search.</p>';
}

function openOrphanageDetail(id) {
  const site = orphanages.find(function (record) { return record.id === Number(id); });
  if (!site) return;
  currentDetailOrphanage = site;
  document.querySelectorAll('.nav-item').forEach(function (item) { item.classList.remove('active'); });
  document.querySelectorAll('.page-section').forEach(function (section) { section.classList.remove('active'); });
  document.getElementById('page-detail').classList.add('active');
  document.getElementById('detail-title').textContent = site.name;
  const statusDot = document.getElementById('detail-status-dot');
  statusDot.style.background = 'var(--text-tertiary)';
  document.getElementById('detail-status-text').textContent = 'SAMPLE PROFILE · NO LIVE STATUS';
  document.getElementById('detail-header-info').innerHTML =
    '<div class="detail-info-bar"><div class="detail-info-item"><div><div class="dii-label">Illustrative locality</div><div class="dii-value">' +
    escapeMapText(site.city) + ', ' + escapeMapText(site.district) + '</div></div></div>' +
    '<div class="detail-info-item"><div><div class="dii-label">Map coordinates</div><div class="dii-value">' +
    Number(site.lat).toFixed(4) + ', ' + Number(site.lng).toFixed(4) + ' · approximate</div></div></div>' +
    '<div class="detail-info-item"><div><div class="dii-label">Profile type</div><div class="dii-value">Synthetic sample record</div></div></div></div>';
  switchDetailTab('overview');
}

async function loadDetailOverview(oid) {
  const response = await fetch('/api/stats?orphanage_id=' + oid);
  const stats = await response.json();
  document.getElementById('dtab-overview').innerHTML =
    '<div class="readiness-banner"><div class="readiness-orb">0</div><div><strong>Sample facility profile</strong><p>Illustrative records below demonstrate a possible coordination layout. No safety rating, service connection, or operational status has been assessed.</p></div></div>' +
    '<div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-top:16px">' +
    '<div class="stat-card green"><div class="label">Synthetic child records</div><div class="value">' + Number(stats.totalChildren || 0) + '</div></div>' +
    '<div class="stat-card blue"><div class="label">Sample visitor flows</div><div class="value">' + Number(stats.activeVisitors || 0) + '</div></div>' +
    '<div class="stat-card yellow"><div class="label">Scripted reminders</div><div class="value">' + Number(stats.pendingAlerts || 0) + '</div></div>' +
    '<div class="stat-card purple"><div class="label">Model detections</div><div class="value">0</div></div></div>' +
    '<div class="portal-section" style="margin-top:16px"><div class="portal-section-header">How the concept could work</div>' +
    '<div class="portal-section-body"><ol><li>A human reviewer checks a sample item.</li><li>The reviewer records a next step.</li><li>A follow-up is shown in the local demo queue.</li></ol><p class="readiness-footnote">This is a click-through interface only. None of these records represents a real facility or person.</p></div></div>';
}

async function loadDetailIncidents(oid) {
  const response = await fetch('/api/incidents?orphanage_id=' + oid);
  const scenarios = await response.json();
  document.getElementById('dtab-incidents').innerHTML = scenarios.length
    ? '<div class="alerts-list">' + scenarios.map(renderIncidentItem).join('') + '</div>'
    : '<div class="detail-empty">No scripted sample scenarios for this profile.</div>';
}

async function loadDetailZones(oid) {
  const response = await fetch('/api/zones?orphanage_id=' + oid);
  const zones = await response.json();
  document.getElementById('dtab-zones').innerHTML = zones.length
    ? '<div class="readiness-grid">' + zones.map(function (zone) {
      return '<article class="readiness-card"><strong>' + escapeMapText(zone.name) + '</strong><span class="readiness-state">Sample zone</span><p>Illustrative workflow placeholder; no live sensor, camera, or occupancy count is connected.</p></article>';
    }).join('') + '</div>'
    : '<div class="detail-empty">No sample zones configured.</div>';
}

function loadPortal() {
  const container = document.getElementById('portal-content');
  if (!portalOrphanageId) {
    container.innerHTML = '<div class="portal-login"><div class="portal-login-card"><span class="prototype-state">LOCAL CONCEPT · NO AUTHENTICATION</span>' +
      '<h2>Facility workspace concept</h2><p>Choose a fictional sample profile to preview the facility-side workflow. This is not a private or authenticated portal.</p>' +
      '<div class="form-group" style="margin-top:24px"><label>Select a sample profile</label><select id="portal-select" style="width:100%;padding:14px 18px;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg-primary);color:var(--text-primary);font-size:15px">' +
      '<option value="">Choose a sample profile</option>' + orphanages.map(function (site) {
        return '<option value="' + site.id + '">' + escapeMapText(site.name) + ' · ' + escapeMapText(site.city) + '</option>';
      }).join('') + '</select></div><button class="btn btn-primary" style="width:100%;padding:14px;font-size:15px;margin-top:8px" onclick="enterPortal()">Preview sample workspace</button></div></div>';
    return;
  }
  loadPortalDashboard();
}

function enterPortal() {
  const select = document.getElementById('portal-select');
  if (!select || !select.value) return;
  portalOrphanageId = parseInt(select.value, 10);
  loadPortalDashboard();
}

function exitPortal() {
  portalOrphanageId = null;
  loadPortal();
}

async function loadPortalDashboard() {
  const site = orphanages.find(function (record) { return record.id === portalOrphanageId; });
  if (!site) { exitPortal(); return; }
  const results = await Promise.all([
    fetch('/api/stats?orphanage_id=' + site.id).then(function (response) { return response.json(); }),
    fetch('/api/visitors?orphanage_id=' + site.id).then(function (response) { return response.json(); })
  ]);
  const stats = results[0];
  const visitors = results[1];
  document.getElementById('portal-content').innerHTML =
    '<div class="page-header"><div><span class="prototype-state">SAMPLE WORKSPACE</span><h2 style="margin-top:7px">' +
    escapeMapText(site.name) + '</h2><p class="page-subtitle">' + escapeMapText(site.city) + ', ' + escapeMapText(site.district) +
    ' · fictional profile</p></div><button class="btn btn-outline btn-sm" onclick="exitPortal()">Switch sample profile</button></div>' +
    '<div class="demo-disclosure"><strong>Concept portal</strong><br>Sample values only. This preview has no institution login, private account, live monitoring, or safety assessment.</div>' +
    '<div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">' +
    '<div class="stat-card green"><div class="label">Synthetic child profiles</div><div class="value">' + Number(stats.totalChildren || 0) + '</div></div>' +
    '<div class="stat-card blue"><div class="label">Sample visitor records</div><div class="value">' + visitors.length + '</div></div>' +
    '<div class="stat-card yellow"><div class="label">Workflow reminders</div><div class="value">' + Number(stats.pendingAlerts || 0) + '</div></div>' +
    '<div class="stat-card purple"><div class="label">Safety score</div><div class="value">Not assessed</div></div></div>' +
    '<div class="portal-grid" style="margin-top:16px"><div class="portal-section"><div class="portal-section-header">Human-led review</div><div class="portal-section-body"><ol><li>Review the fictional queue.</li><li>Record a follow-up step.</li><li>Return to the shared workspace.</li></ol></div></div>' +
    '<div class="portal-section"><div class="portal-section-header">Model and safeguarding readiness</div><div class="portal-section-body"><strong>No model is connected.</strong><p class="readiness-footnote">No inference, camera feed, child risk rating, or automated decision is produced in this prototype.</p><button class="btn btn-outline btn-sm" onclick="navigateToPage(&#39;emotions&#39;)">View readiness checklist</button></div></div></div>';
}

async function addChild(event) {
  event.preventDefault();
  const form = event.target;
  const facilityId = Number(new FormData(form).get('orphanage_id')) || 1;
  const response = await fetch('/api/children');
  const records = await response.json();
  const payload = {
    name: 'Demo Child ' + String(records.length + 1).padStart(2, '0'),
    age: 10, gender: 'Sample record', medical_notes: '', orphanage_id: facilityId
  };
  await fetch('/api/children', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  form.reset();
  closeModal('child-modal');
  await Promise.all([loadChildren(), loadStats()]);
}

async function addVisitor(event) {
  event.preventDefault();
  const form = event.target;
  const facilityId = Number(new FormData(form).get('orphanage_id')) || 1;
  const response = await fetch('/api/visitors');
  const records = await response.json();
  const payload = {
    name: 'Sample Visitor ' + String(records.length + 1).padStart(2, '0'),
    cnic: '', phone: '', purpose: 'Sample check-in workflow', orphanage_id: facilityId
  };
  await fetch('/api/visitors', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  form.reset();
  closeModal('visitor-modal');
  await Promise.all([loadVisitors(), loadStats()]);
}

async function addHealthRecord(event) {
  event.preventDefault();
  closeModal('health-modal');
  alert('Health records are disabled in this pitch demo. No health information was stored.');
}

function renderChildRow(child) {
  const site = orphanages.find(function (record) { return record.id === child.orphanage_id; });
  return '<tr><td><strong>' + escapeMapText(child.name) + '</strong><div class="prototype-state">SAMPLE</div></td>' +
    '<td>' + Number(child.age) + '</td><td>Fictional profile</td><td>' +
    escapeMapText(site ? site.name : 'Sample site') + '</td><td>' +
    new Date(child.admitted_date).toLocaleDateString('en-PK') + '</td><td>Not collected</td><td>Not available in demo</td></tr>';
}

async function loadDetailChildren(id) {
  const children = await fetch('/api/children?orphanage_id=' + id).then(function (response) { return response.json(); });
  document.getElementById('dtab-children').innerHTML = children.length
    ? '<table class="data-table"><thead><tr><th>Sample label</th><th>Example age</th><th>Profile type</th><th>Profile date</th></tr></thead><tbody>' +
      children.map(function (child) {
        return '<tr><td><strong>' + escapeMapText(child.name) + '</strong></td><td>' + Number(child.age) +
          '</td><td>Fictional sample</td><td>Demo record</td></tr>';
      }).join('') + '</tbody></table>'
    : '<div class="detail-empty">No synthetic profile records.</div>';
}

function renderVisitorRow(visitor) {
  const site = orphanages.find(function (record) { return record.id === visitor.orphanage_id; });
  return '<tr><td><strong>' + escapeMapText(visitor.name) + '</strong></td><td>Not collected</td><td>Not collected</td>' +
    '<td>Sample workflow</td><td>' + escapeMapText(site ? site.name : 'Sample site') + '</td><td>' +
    new Date(visitor.check_in).toLocaleString('en-PK') + '</td><td><span class="prototype-state">' +
    escapeMapText(visitor.status.replace('_', ' ')) + ' · DEMO</span></td><td>' +
    (visitor.status === 'checked_in' ? '<button class="btn btn-outline btn-sm" onclick="checkoutVisitor(' + Number(visitor.id) + ')">Preview check-out</button>' : '') + '</td></tr>';
}

async function addOrphanage(event) {
  event.preventDefault();
  const id = orphanages.length + 1;
  const payload = {
    name: 'Illustrative Care Site ' + String(id).padStart(2, '0'),
    city: 'Lahore',
    district: 'Lahore',
    address: 'Approximate synthetic map point',
    total_children: 0,
    staff_count: 0,
    cameras: 0,
    lat: 31.45 + (id % 5) * 0.01,
    lng: 74.28 + (id % 5) * 0.02
  };
  await fetch('/api/orphanages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  event.target.reset();
  closeModal('orphanage-modal');
  await Promise.all([loadOrphanages(), loadStats()]);
  if (map) {
    map.remove();
    map = null;
    facilityMarkers = [];
    facilityLayer = null;
    stationLayer = null;
    if (document.getElementById('page-map').classList.contains('active')) initMap();
  }
}

async function viewIncident(id) {
  const scenarios = await fetch('/api/incidents').then(function (response) { return response.json(); });
  const item = scenarios.find(function (scenario) { return Number(scenario.id) === Number(id); });
  if (!item) return;
  document.getElementById('incident-detail').innerHTML =
    '<div class="readiness-banner"><div class="readiness-orb">↗</div><div><strong>Scripted sample scenario</strong>' +
    '<p>This item was created for the demo walkthrough. No incident was detected and no model score exists.</p></div></div>' +
    '<h4 style="margin:16px 0 8px">' + escapeMapText(item.label) + '</h4><p style="color:var(--text-secondary);font-size:13px">' +
    escapeMapText(item.description) + '</p><div class="readiness-footnote">' + new Date(item.detected_at).toLocaleString('en-PK') +
    ' · Sample profile ' + escapeMapText(item.orphanage_name) + '</div>';
  const button = document.getElementById('btn-review-incident');
  button.onclick = async function () {
    await fetch('/api/incidents/' + item.id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'reviewed', reviewed: true })
    });
    closeModal('incident-modal');
    await Promise.all([loadIncidents(), loadStats(), loadOrphanageIndicators()]);
  };
  button.textContent = item.reviewed ? 'Already reviewed in demo' : 'Mark reviewed in demo';
  button.disabled = Boolean(item.reviewed);
  openModal('incident-modal');
}

function renderIncidentItem(item) {
  const when = new Date(item.detected_at).toLocaleString('en-PK');
  return '<div class="incident-item ' + (item.reviewed ? 'reviewed' : '') + '" onclick="viewIncident(' + Number(item.id) + ')">' +
    '<div class="incident-icon" aria-hidden="true">↗</div><div class="incident-content"><div class="inc-label">' +
    escapeMapText(item.label) + '</div><div class="inc-desc">' + escapeMapText(item.description) +
    '</div><div class="inc-meta"><span>' + when + '</span><span>Scripted sample</span><span>No model output</span></div></div>' +
    '<div><span class="prototype-state">DEMO</span><div style="color:var(--text-secondary);font-size:11px;margin-top:6px">' +
    (item.reviewed ? 'Reviewed locally' : 'Awaiting demo review') + '</div></div></div>';
}

function renderAlertItem(item) {
  const time = new Date(item.created_at).toLocaleTimeString('en-PK');
  return '<div class="alert-item ' + (item.acknowledged ? 'acknowledged' : '') + '" id="alert-' + Number(item.id) + '">' +
    '<div class="alert-severity" style="background:var(--accent)"></div><div class="alert-content"><div class="alert-msg">' +
    escapeMapText(item.message) + '</div><div class="alert-time">Sample follow-up · ' + time + '</div></div>' +
    '<div class="alert-actions">' + (item.acknowledged ? '<span class="readiness-state">Reviewed in demo</span>' :
      '<button class="btn-ack" onclick="acknowledgeAlert(' + Number(item.id) + ')">Mark reviewed</button>') + '</div></div>';
}

async function loadBriefing() {
  const stats = await fetch('/api/stats').then(function (response) { return response.json(); });
  const scenarios = await fetch('/api/incidents').then(function (response) { return response.json(); });
  document.getElementById('briefing-content').innerHTML =
    '<div class="briefing-card"><span class="prototype-state">SYNTHETIC DEMO DATA</span><h3>Concept workflow snapshot</h3>' +
    '<p class="readiness-footnote">This view summarizes the sample records in this browser demo. It is not a live operational report.</p>' +
    '<div class="briefing-grid"><div class="briefing-stat"><div class="bv" style="color:var(--accent)">' + Number(stats.totalOrphanages) + '</div><div class="bl">Illustrative map points</div></div>' +
    '<div class="briefing-stat"><div class="bv" style="color:var(--cyan)">' + Number(stats.totalChildren) + '</div><div class="bl">Synthetic child records</div></div>' +
    '<div class="briefing-stat"><div class="bv" style="color:var(--warning)">' + Number(stats.pendingAlerts) + '</div><div class="bl">Sample reminders</div></div>' +
    '<div class="briefing-stat"><div class="bv" style="color:var(--purple)">' + scenarios.length + '</div><div class="bl">Scripted review scenarios</div></div></div></div>' +
    '<div class="briefing-card"><h3>Model status</h3><p>No model artifact is connected. No camera, identity, emotion, abuse, or safety inference runs in this prototype.</p>' +
    '<button class="btn btn-outline btn-sm" onclick="navigateToPage(&#39;emotions&#39;)">Open readiness checklist</button></div>';
}
