const { makeDemoData } = require('./demo-data');

class Store {
  constructor() {
    this.data = makeDemoData();
  }

  load() {
    return makeDemoData();
  }

  save() {
    // Demo actions live in memory only and reset when the local server restarts.
  }

  resetDemo() { this.data = makeDemoData(); return this.getStats(); }

  addDemoScenario() {
    const facility = this.data.orphanages[2];
    const incident = {
      id: this.nextId('incidents'),
      type: 'presence_check',
      label: 'Illustrative presence review',
      description: 'A scripted sample shows how a reviewer can compare an attendance count and record a follow-up. No real person, facility, camera, or event is represented.',
      severity: 'low', orphanage_id: facility.id, orphanage_name: facility.name, city: facility.city,
      detected_at: new Date().toISOString(), reviewed: false, status: 'open',
      ai_model: 'Scenario only · no model', confidence: null, frame_count: null, demo_record: true
    };
    this.data.incidents.push(incident);
    const alert = {
      id: this.nextId('alerts'), orphanage_id: facility.id, type: 'presence_check', severity: 'low',
      message: 'Sample workflow: review a fictional attendance discrepancy.', acknowledged: false,
      created_at: incident.detected_at, demo_record: true
    };
    this.data.alerts.push(alert);
    this.data.counters.incidents = Math.max(this.data.counters.incidents, incident.id);
    this.data.counters.alerts = Math.max(this.data.counters.alerts, alert.id);
    this.addActivity({ event_type: 'demo_scenario', description: 'Scripted sample review added to the in-memory demo.', orphanage_id: facility.id });
    return { incident, alert };
  }

  nextId(table) {
    this.data.counters[table] = (this.data.counters[table] || 0) + 1;
    return this.data.counters[table];
  }

  // Orphanages
  getOrphanages() { return this.data.orphanages; }

  getPoliceStations() { return this.data.police_stations || []; }

  getOrphanage(id) { return this.data.orphanages.find(o => o.id === parseInt(id)); }

  addOrphanage(orphanage) {
    orphanage.id = this.nextId('orphanages');
    orphanage.status = 'unverified';
    orphanage.risk_level = 'not_assessed';
    this.data.orphanages.push(orphanage);
    this.save();
    return orphanage;
  }

  updateOrphanage(id, updates) {
    const o = this.data.orphanages.find(x => x.id === parseInt(id));
    if (o) { Object.assign(o, updates); this.save(); }
    return o;
  }

  // Children
  getChildren(orphanageId) {
    let list = this.data.children.filter(c => c.status === 'active');
    if (orphanageId) list = list.filter(c => c.orphanage_id === parseInt(orphanageId));
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  addChild(child) {
    child.id = this.nextId('children');
    child.created_at = new Date().toISOString();
    child.status = 'active';
    child.admitted_date = child.admitted_date || new Date().toISOString().split('T')[0];
    this.data.children.push(child);
    this.save();
    return child;
  }

  updateChild(id, updates) {
    const child = this.data.children.find(c => c.id === parseInt(id));
    if (child) { Object.assign(child, updates); this.save(); }
    return child;
  }

  getHealthRecords(childId) {
    return this.data.health_records
      .filter(r => r.child_id === parseInt(childId))
      .sort((a, b) => new Date(b.record_date) - new Date(a.record_date));
  }

  addHealthRecord(childId, record) {
    record.id = this.nextId('health_records');
    record.child_id = parseInt(childId);
    record.record_date = record.record_date || new Date().toISOString().split('T')[0];
    record.created_at = new Date().toISOString();
    this.data.health_records.push(record);
    this.save();
    return record;
  }

  // Visitors
  getVisitors(orphanageId, limit = 50) {
    let list = this.data.visitors;
    if (orphanageId) list = list.filter(v => v.orphanage_id === parseInt(orphanageId));
    return list.sort((a, b) => new Date(b.check_in) - new Date(a.check_in)).slice(0, limit);
  }

  addVisitor(visitor) {
    visitor.id = this.nextId('visitors');
    visitor.check_in = new Date().toISOString();
    visitor.check_out = null;
    visitor.status = 'checked_in';
    this.data.visitors.push(visitor);
    this.save();
    return visitor;
  }

  checkoutVisitor(id) {
    const visitor = this.data.visitors.find(v => v.id === parseInt(id));
    if (visitor) { visitor.check_out = new Date().toISOString(); visitor.status = 'checked_out'; this.save(); }
    return visitor;
  }

  // Alerts
  getAlerts(orphanageId, limit = 50) {
    let list = this.data.alerts;
    if (orphanageId) list = list.filter(a => a.orphanage_id === parseInt(orphanageId));
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
  }

  addAlert(alert) {
    alert.id = this.nextId('alerts');
    alert.acknowledged = false;
    alert.created_at = new Date().toISOString();
    this.data.alerts.push(alert);
    this.save();
    return alert;
  }

  acknowledgeAlert(id) {
    const alert = this.data.alerts.find(a => a.id === parseInt(id));
    if (alert) { alert.acknowledged = true; this.save(); }
    return alert;
  }

  // Historical incident records; no model-generated detections are added.
  getIncidents(orphanageId, limit = 50) {
    let list = this.data.incidents;
    if (orphanageId) list = list.filter(i => i.orphanage_id === parseInt(orphanageId));
    return list.sort((a, b) => new Date(b.detected_at) - new Date(a.detected_at)).slice(0, limit);
  }

  addIncident(incident) {
    incident.id = this.nextId('incidents');
    incident.detected_at = new Date().toISOString();
    incident.status = 'open';
    incident.reviewed = false;
    this.data.incidents.push(incident);
    this.save();
    return incident;
  }

  updateIncident(id, updates) {
    const inc = this.data.incidents.find(i => i.id === parseInt(id));
    if (inc) { Object.assign(inc, updates); this.save(); }
    return inc;
  }

  // Zones
  getZones(orphanageId) {
    let list = this.data.zones;
    if (orphanageId) list = list.filter(z => z.orphanage_id === parseInt(orphanageId));
    return list.sort((a, b) => a.id - b.id);
  }

  updateZoneCount(zoneName, count) {
    const zone = this.data.zones.find(z => z.name === zoneName);
    if (zone) zone.current_count = count;
  }

  // Activity
  getActivity(orphanageId, limit = 30) {
    let list = this.data.activity_log;
    if (orphanageId) list = list.filter(a => a.orphanage_id === parseInt(orphanageId));
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit).map(a => {
      const zone = this.data.zones.find(z => z.id === a.zone_id);
      return { ...a, zone_name: zone ? zone.name : null };
    });
  }

  addActivity(event) {
    event.id = this.nextId('activity_log');
    event.created_at = new Date().toISOString();
    this.data.activity_log.push(event);
    if (this.data.activity_log.length > 500) this.data.activity_log = this.data.activity_log.slice(-250);
    this.save();
    return event;
  }

  // Growth Records
  getGrowthRecords(childId) {
    return this.data.growth_records
      .filter(r => r.child_id === parseInt(childId))
      .sort((a, b) => new Date(b.recorded_date) - new Date(a.recorded_date));
  }

  addGrowthRecord(childId, record) {
    record.id = this.nextId('growth_records');
    record.child_id = parseInt(childId);
    record.recorded_date = record.recorded_date || new Date().toISOString().split('T')[0];
    record.created_at = new Date().toISOString();
    this.data.growth_records.push(record);
    this.save();
    return record;
  }

  // Notifications
  getNotifications(limit = 50) {
    return this.data.notifications
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  addNotification(notification) {
    notification.id = this.nextId('notifications');
    notification.read = false;
    notification.created_at = new Date().toISOString();
    this.data.notifications.push(notification);
    if (this.data.notifications.length > 500) this.data.notifications = this.data.notifications.slice(-250);
    this.save();
    return notification;
  }

  markNotificationRead(id) {
    const notif = this.data.notifications.find(n => n.id === parseInt(id));
    if (notif) { notif.read = true; this.save(); }
    return notif;
  }

  markAllNotificationsRead() {
    this.data.notifications.forEach(n => { n.read = true; });
    this.save();
  }

  getUnreadCount() {
    return this.data.notifications.filter(n => !n.read).length;
  }

  getEmotionDetections() { return []; }

  getRankings() {
    const fields = ['name', 'city', 'district', 'address', 'lat', 'lng', 'total_children', 'staff_count'];
    return this.data.orphanages.map(site => {
      const present = fields.filter(field => {
        const value = site[field];
        return value !== null && value !== undefined && String(value).trim() !== '';
      }).length;
      const completeness = Math.round((present / fields.length) * 100);
      return {
        id: site.id, name: site.name, city: site.city, district: site.district,
        data_completeness: completeness, demo_record: true
      };
    }).sort((a, b) => a.name.localeCompare(b.name)).map((record, index) => ({
      ...record, rank: index + 1
    }));
  }

  getBriefing() {
    const incidents = this.data.incidents;
    const alerts = this.data.alerts;
    const rankings = this.getRankings();
    const breakdown = {};
    incidents.forEach(item => { breakdown[item.type] = (breakdown[item.type] || 0) + 1; });
    return {
      date: new Date().toISOString(), generated_at: new Date().toISOString(),
      summary: {
        total_orphanages: this.data.orphanages.length,
        online: this.data.orphanages.filter(site => site.status === 'online').length,
        total_children: this.data.children.length,
        active_visitors: this.data.visitors.filter(visitor => visitor.status === 'checked_in').length
      },
      today: {
        incidents: incidents.length,
        critical_incidents: 0,
        alerts: alerts.length,
        resolved_alerts: alerts.filter(alert => alert.acknowledged).length
      },
      incident_breakdown: breakdown,
      recent_critical: [],
      top_performer: null,
      needs_attention: null,
      demo_mode: true
    };
  }

  // Stats
  getStats(orphanageId) {
    const filter = orphanageId ? parseInt(orphanageId) : null;
    return {
      totalChildren: this.data.children.filter(c => c.status === 'active' && (!filter || c.orphanage_id === filter)).length,
      activeVisitors: this.data.visitors.filter(v => v.status === 'checked_in' && (!filter || v.orphanage_id === filter)).length,
      pendingAlerts: this.data.alerts.filter(a => !a.acknowledged && (!filter || a.orphanage_id === filter)).length,
      openIncidents: this.data.incidents.filter(i => i.status === 'open' && (!filter || i.orphanage_id === filter)).length,
      zones: this.getZones(orphanageId),
      totalOrphanages: this.data.orphanages.length,
      onlineOrphanages: this.data.orphanages.filter(o => o.status === 'online').length,
    };
  }
}

module.exports = new Store();
