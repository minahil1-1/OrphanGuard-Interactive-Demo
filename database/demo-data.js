const districts = [
  ['Lahore', 31.5204, 74.3587], ['Rawalpindi', 33.5651, 73.0169], ['Faisalabad', 31.4180, 73.0790],
  ['Multan', 30.1575, 71.5249], ['Sargodha', 32.0836, 72.6711], ['Sialkot', 32.4945, 74.5229],
  ['Gujranwala', 32.1877, 74.1945], ['Bahawalpur', 29.3956, 71.6836], ['Dera Ghazi Khan', 30.0459, 70.6403],
  ['Narowal', 32.1020, 74.8730], ['Sheikhupura', 31.7130, 73.9780], ['Attock', 33.7667, 72.3597],
  ['Jhelum', 32.9330, 73.7260], ['Gujrat', 32.5730, 74.0790], ['Hafizabad', 32.0700, 73.6900],
  ['Jhang', 31.2700, 72.3200], ['Kasur', 31.1200, 74.4500], ['Okara', 30.8100, 73.4500],
  ['Pakpattan', 30.3400, 73.3900], ['Sahiwal', 30.6700, 73.1100], ['Mianwali', 32.5800, 71.5400],
  ['Khushab', 32.3000, 72.3500], ['Bhakkar', 31.6200, 71.0600], ['Chiniot', 31.7200, 72.9800],
  ['Toba Tek Singh', 30.9700, 72.4800], ['Vehari', 30.0400, 72.3500], ['Khanewal', 30.3000, 71.9300],
  ['Muzaffargarh', 30.0700, 71.1900], ['Rahim Yar Khan', 28.4200, 70.3000], ['Bahawalnagar', 29.9900, 73.2500],
  ['Lodhran', 29.5400, 71.6300], ['Rajanpur', 29.1000, 70.3300], ['Nankana Sahib', 31.4500, 73.7000],
  ['Mandi Bahauddin', 32.5800, 73.4900], ['Chakwal', 32.9300, 72.8600], ['Murree', 33.9100, 73.3900],
  ['Layyah', 30.9600, 70.9400]
];

const districtCounts = districts.map((_, index) => index === 0 ? 4 : index <= 7 ? 3 : 2);
const lahorePoints = [
  [31.4500, 74.2800], [31.5200, 74.3000], [31.5900, 74.3900], [31.5100, 74.3500]
];
const offsets = [[0.012, 0.014], [-0.014, 0.018], [0.019, -0.016], [-0.020, -0.013]];

function makeDemoData() {
  let id = 0;
  const orphanages = [];
  districts.forEach(([city, lat, lng], districtIndex) => {
    for (let localIndex = 0; localIndex < districtCounts[districtIndex]; localIndex++) {
      id += 1;
      const [dLat, dLng] = offsets[localIndex % offsets.length];
      const point = city === 'Lahore' ? lahorePoints[localIndex] : [lat + dLat, lng + dLng];
      orphanages.push({
        id,
        name: `Illustrative Care Site ${String(id).padStart(2, '0')}`,
        city,
        district: city,
        address: `Illustrative map point for ${city}; not a verified facility address`,
        lat: point[0],
        lng: point[1],
        total_children: 18 + ((id * 13) % 47),
        staff_count: 5 + ((id * 7) % 16),
        cameras: 2 + ((id * 3) % 11),
        status: id % 8 === 0 ? 'offline' : 'online',
        risk_level: 'not_assessed',
        demo_record: true
      });
    }
  });

  const policeStations = districts.slice(0, 30).map(([city, lat, lng], index) => ({
    id: index + 1,
    name: `Illustrative response point ${String(index + 1).padStart(2, '0')}`,
    city,
    district: city,
    lat: lat + 0.008,
    lng: lng - 0.009,
    phone: 'Not connected',
    demo_record: true
  }));

  const children = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    name: `Demo Child ${String(index + 1).padStart(2, '0')}`,
    age: 7 + (index % 10),
    gender: 'Sample record',
    orphanage_id: orphanages[index % orphanages.length].id,
    admitted_date: '2026-01-01',
    status: 'active',
    medical_notes: ''
  }));

  const visitors = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    name: `Sample Visitor ${String(index + 1).padStart(2, '0')}`,
    cnic: 'Not collected in demo',
    phone: 'Not collected in demo',
    purpose: 'Sample check-in workflow',
    orphanage_id: orphanages[index].id,
    check_in: new Date(Date.now() - (index + 1) * 19 * 60000).toISOString(),
    check_out: null,
    status: index === 4 ? 'checked_out' : 'checked_in',
    demo_record: true
  }));

  const scenarioTemplates = [
    ['presence_check', 'Sample attendance review', 'Illustrative count-check scenario. No real people, camera feed, or event are represented.'],
    ['workflow_handoff', 'Sample review handoff', 'A demonstration of how a human reviewer could route a case for follow-up.'],
    ['camera_coverage', 'Sample camera availability check', 'Illustrative system workflow only; no camera is connected or recording.'],
    ['visitor_checkin', 'Sample visitor check-in review', 'A demonstration record for the portal flow; no real visitor details are included.'],
    ['follow_up', 'Sample follow-up reminder', 'A fictional reminder used to demonstrate the review and acknowledgement flow.'],
    ['presence_check', 'Sample attendance reconciliation', 'Illustrative scenario: reviewer checks a count discrepancy before taking action.']
  ];
  const incidents = scenarioTemplates.map(([type, label, description], index) => ({
    id: index + 1,
    type,
    label,
    description,
    severity: index === 2 ? 'medium' : 'low',
    orphanage_id: orphanages[index * 3].id,
    orphanage_name: orphanages[index * 3].name,
    city: orphanages[index * 3].city,
    detected_at: new Date(Date.now() - index * 47 * 60000).toISOString(),
    reviewed: index > 2,
    status: index > 2 ? 'reviewed' : 'open',
    ai_model: 'Scenario only · no model',
    confidence: null,
    frame_count: null,
    demo_record: true
  }));

  const alerts = incidents.slice(0, 5).map((incident, index) => ({
    id: index + 1,
    orphanage_id: incident.orphanage_id,
    type: incident.type,
    severity: incident.severity,
    message: `${incident.label} — sample workflow only`,
    acknowledged: index > 2,
    created_at: incident.detected_at,
    demo_record: true
  }));

  const zones = orphanages.slice(0, 12).flatMap((site, index) => [
    { id: index * 2 + 1, name: 'Entry area · demo', description: 'Illustrative zone; no live camera or count', expected_count: 10, current_count: 10 + (index % 3), orphanage_id: site.id },
    { id: index * 2 + 2, name: 'Common area · demo', description: 'Illustrative zone; no live camera or count', expected_count: 14, current_count: 12 + (index % 5), orphanage_id: site.id }
  ]);

  const activity_log = incidents.map((incident, index) => ({
    id: index + 1,
    event_type: 'demo_scenario',
    description: `${incident.label} opened in the local demonstration`,
    orphanage_id: incident.orphanage_id,
    created_at: incident.detected_at
  }));

  const notifications = alerts.slice(0, 3).map((alert, index) => ({
    id: index + 1,
    title: 'Demo workflow reminder',
    message: alert.message,
    read: index > 0,
    created_at: alert.created_at
  }));

  return {
    schema_version: 2,
    demo_mode: true,
    orphanages,
    police_stations: policeStations,
    children,
    health_records: [],
    visitors,
    alerts,
    incidents,
    zones,
    activity_log,
    growth_records: [],
    notifications,
    emotion_detections: [],
    counters: {
      children: children.length, health_records: 0, visitors: visitors.length,
      alerts: alerts.length, incidents: incidents.length, activity_log: activity_log.length,
      orphanages: orphanages.length, growth_records: 0, notifications: notifications.length
    }
  };
}

module.exports = { makeDemoData, districtCount: districts.length };
