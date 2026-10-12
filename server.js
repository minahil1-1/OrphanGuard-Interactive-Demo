const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const path = require('path');
const store = require('./database/store');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.disable('x-powered-by');

app.use(express.json({ limit: '32kb' }));
app.use('/uploads', (_req, res) => res.sendStatus(404));
app.get('/', (req, res, next) => {
  if (req.query.preview === '1') return next();
  return res.sendFile(path.join(__dirname, 'public', 'pitch.html'));
});
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const valid = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    const allowed = valid.has(path.extname(file.originalname).toLowerCase()) && /^image\/(jpeg|png|webp)$/.test(file.mimetype);
    cb(allowed ? null : new Error('Unsupported file type'), allowed);
  }
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// All write operations in this local build affect synthetic, in-memory demo
// data only. Nothing is persisted or sent to an external service.

// === API Routes ===

// Model status is explicit: this prototype has no validated inference provider.
app.get('/api/model-status', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({
    status: 'not_configured', inference_enabled: false, provider: null, model_version: null,
    last_inference_at: null, accepted_event_types: [],
    prohibited_capabilities: ['identity_recognition', 'emotion_inference', 'abuse_classification', 'automated_decisions'],
    readiness: { model_artifact: false, approved_dataset: false, independent_evaluation: false, safeguarding_approval: false },
    message: 'No AI model is connected. All on-screen scenarios use illustrative sample data.'
  });
});

app.get('/api/police-stations', (_req, res) => res.json(store.getPoliceStations()));
app.get('/api/rankings', (_req, res) => res.json(store.getRankings()));
app.get('/api/emotions', (_req, res) => res.json([]));
app.get('/api/briefing', (_req, res) => res.json(store.getBriefing()));

app.post('/api/demo/reset', (_req, res) => {
  const stats = store.resetDemo();
  broadcast({ type: 'demo_reset' });
  res.json({ ok: true, demo_mode: true, stats });
});

app.post('/api/demo/scenario', (_req, res) => {
  const result = store.addDemoScenario();
  broadcast({ type: 'incident', incident: result.incident });
  broadcast({ type: 'alert', alert: result.alert });
  res.json({ ok: true, demo_mode: true, ...result });
});

// Orphanages
app.get('/api/orphanages', (req, res) => res.json(store.getOrphanages()));
app.get('/api/orphanages/:id', (req, res) => {
  const o = store.getOrphanage(req.params.id);
  o ? res.json(o) : res.status(404).json({ error: 'Not found' });
});
app.post('/api/orphanages', (req, res) => res.json(store.addOrphanage(req.body)));

// Stats
app.get('/api/stats', (req, res) => res.json(store.getStats(req.query.orphanage_id)));

// Children
app.get('/api/children', (req, res) => res.json(store.getChildren(req.query.orphanage_id)));
app.post('/api/children', upload.single('photo'), (req, res) => {
  const { name, age, gender, medical_notes, orphanage_id } = req.body;
  const child = store.addChild({
    name, age: parseInt(age), gender,
    photo_url: req.file ? '/uploads/' + req.file.filename : null,
    medical_notes, orphanage_id: parseInt(orphanage_id) || 1
  });
  broadcast({ type: 'child_added', child });
  res.json(child);
});
app.put('/api/children/:id', (req, res) => {
  const child = store.updateChild(req.params.id, req.body);
  child ? res.json(child) : res.status(404).json({ error: 'Not found' });
});

// Health
app.get('/api/children/:id/health', (req, res) => res.json(store.getHealthRecords(req.params.id)));
app.post('/api/children/:id/health', (req, res) => res.json(store.addHealthRecord(req.params.id, req.body)));

// Visitors
app.get('/api/visitors', (req, res) => res.json(store.getVisitors(req.query.orphanage_id)));
app.post('/api/visitors', upload.single('photo'), (req, res) => {
  const { name, cnic, phone, purpose, orphanage_id } = req.body;
  const visitor = store.addVisitor({
    name, cnic, phone, purpose,
    photo_url: req.file ? '/uploads/' + req.file.filename : null,
    orphanage_id: parseInt(orphanage_id) || 1
  });
  broadcast({ type: 'visitor_checkin', visitor });
  store.addActivity({ event_type: 'visitor_entry', description: `Visitor ${name} checked in`, orphanage_id: visitor.orphanage_id });
  res.json(visitor);
});
app.put('/api/visitors/:id/checkout', (req, res) => {
  const visitor = store.checkoutVisitor(req.params.id);
  if (visitor) { broadcast({ type: 'visitor_checkout', visitor }); res.json(visitor); }
  else res.status(404).json({ error: 'Not found' });
});

// Alerts
app.get('/api/alerts', (req, res) => res.json(store.getAlerts(req.query.orphanage_id)));
app.put('/api/alerts/:id/acknowledge', (req, res) => {
  const alert = store.acknowledgeAlert(req.params.id);
  if (alert) { broadcast({ type: 'alert_ack', alertId: parseInt(req.params.id) }); res.json(alert); }
  else res.status(404).json({ error: 'Not found' });
});

// Incidents
app.get('/api/incidents', (req, res) => res.json(store.getIncidents(req.query.orphanage_id)));
app.put('/api/incidents/:id', (req, res) => {
  const inc = store.updateIncident(req.params.id, req.body);
  if (inc) { broadcast({ type: 'incident_update', incident: inc }); res.json(inc); }
  else res.status(404).json({ error: 'Not found' });
});

// Activity
app.get('/api/activity', (req, res) => res.json(store.getActivity(req.query.orphanage_id)));

// Zones
app.get('/api/zones', (req, res) => res.json(store.getZones(req.query.orphanage_id)));

// Growth records
app.get('/api/children/:id/growth', (req, res) => res.json(store.getGrowthRecords(req.params.id)));
app.post('/api/children/:id/growth', (req, res) => {
  const record = req.body;
  record.height_cm = parseFloat(record.height_cm);
  record.weight_kg = parseFloat(record.weight_kg);
  record.bmi = parseFloat((record.weight_kg / Math.pow(record.height_cm / 100, 2)).toFixed(1));
  res.json(store.addGrowthRecord(req.params.id, record));
});

// Notifications
app.get('/api/notifications', (req, res) => res.json(store.getNotifications()));
app.get('/api/notifications/unread-count', (req, res) => res.json({ count: store.getUnreadCount() }));
app.put('/api/notifications/:id/read', (req, res) => { store.markNotificationRead(req.params.id); res.json({ ok: true }); });
app.put('/api/notifications/read-all', (req, res) => { store.markAllNotificationsRead(); res.json({ ok: true }); });

// Analytics/Charts data
app.get('/api/analytics/incidents-timeline', (req, res) => {
  const incidents = store.getIncidents(req.query.orphanage_id, 500);
  const days = {};
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    days[key] = { date: key, total: 0 };
  }
  incidents.forEach(inc => {
    const key = inc.detected_at.split('T')[0];
    if (days[key]) days[key].total++;
  });
  res.json(Object.values(days));
});

app.get('/api/analytics/alerts-by-type', (req, res) => {
  const alerts = store.getAlerts(req.query.orphanage_id, 500);
  const types = {};
  alerts.forEach(a => { types[a.type] = (types[a.type] || 0) + 1; });
  res.json(Object.entries(types).map(([type, count]) => ({ type: type.replace(/_/g, ' '), count })));
});

app.get('/api/analytics/anomalies', (req, res) => {
  const facilities = store.getOrphanages();
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);

  const trends = facilities.map(facility => {
    const records = store.getIncidents(facility.id, 500);
    const thisWeek = records.filter(i => new Date(i.detected_at) >= weekAgo).length;
    const lastWeek = records.filter(i => new Date(i.detected_at) >= twoWeeksAgo && new Date(i.detected_at) < weekAgo).length;
    const change = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : (thisWeek > 0 ? 100 : 0);
    return {
      facility_id: facility.id, name: facility.name, city: facility.city,
      incidents_this_week: thisWeek, incidents_last_week: lastWeek, change_percent: change,
      critical_this_week: 0, unresolved_alerts: store.getAlerts(facility.id).filter(a => !a.acknowledged).length,
      anomaly_level: 'sample', records_this_week: thisWeek, records_previous_week: lastWeek
    };
  }).sort((a, b) => b.records_this_week - a.records_this_week);

  res.json(trends);
});

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.on('close', () => console.log('Client disconnected'));
});

const PORT = Number(process.env.PORT || 3000);
// Keep local runs bound to loopback. Railway sets RAILWAY_ENVIRONMENT and
// requires the app to listen on all interfaces inside its deployment.
const HOST = process.env.HOST || (process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1');
server.listen(PORT, HOST, () => {
  console.log(`OrphanGuard pitch demo listening on ${HOST}:${PORT} (synthetic data; no AI provider connected)`);
});
