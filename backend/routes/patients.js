const express = require('express');
const { load, save, log } = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const { computeRisk } = require('./auth');

const router = express.Router();
router.use(auth);

router.get('/', requireRole('admin', 'doctor', 'nurse'), (req, res) => {
  const db = load();
  let list = db.patients.filter((p) => !p.dischargedAt);
  if (req.user.role === 'doctor') {
    const doc = db.doctors.find((d) => d.id === req.user.profileId);
    list = list.filter((p) => doc && doc.patientIds.includes(p.id));
  }
  res.json(
    list.map((p) => ({ ...p, doctorName: (db.doctors.find((d) => d.id === p.doctorId) || {}).name || 'Unassigned' }))
  );
});

// Admin can add a patient directly (e.g. walk-in / phone admission) —
// same auto doctor + bed assignment logic as self-registration.
router.post('/', requireRole('admin'), (req, res) => {
  const db = load();
  const { name, age, gender, condition } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const pool = condition
    ? db.doctors.filter((d) => d.specialty.toLowerCase() === String(condition).toLowerCase())
    : [];
  const doctorPool = (pool.length ? pool : db.doctors).slice().sort((a, b) => a.patientIds.length - b.patientIds.length);
  const doctor = doctorPool[0] || null;
  const bed = db.beds.find((b) => b.status === 'available') || null;
  const vitals = { hr: 82, spo2: 97, bp: '118/78', rr: 18 };

  const p = {
    id: 'P-' + Date.now(),
    userId: null,
    name,
    age: Number(age) || 30,
    gender: gender || 'Unspecified',
    condition: condition || 'General observation',
    riskLevel: 'STABLE',
    doctorId: doctor ? doctor.id : null,
    bedId: bed ? bed.id : null,
    vitals,
    admittedAt: Date.now(),
    dischargedAt: null,
    timeline: [{ time: new Date().toLocaleString(), event: `Admitted by admin (${req.user.name})` }],
    chatHistory: [],
  };
  if (doctor) doctor.patientIds.push(p.id);
  if (bed) {
    bed.status = 'occupied';
    bed.patientId = p.id;
    const room = db.rooms.find((r) => r.id === bed.id);
    if (room) {
      room.status = 'OCCUPIED';
      room.updatedAt = Date.now();
    }
  }
  db.patients.push(p);
  log(db, `Admin added patient ${name} — auto-assigned to ${doctor ? doctor.name : 'no doctor available'}${bed ? ', bed ' + bed.id : ''}`);
  save(db);
  res.json(p);
});

router.get('/me', requireRole('patient'), (req, res) => {
  const db = load();
  const p = db.patients.find((x) => x.id === req.user.profileId);
  if (!p) return res.status(404).json({ error: 'Patient record not found' });
  const doctor = db.doctors.find((d) => d.id === p.doctorId);
  res.json({ ...p, doctor: doctor ? { name: doctor.name, specialty: doctor.specialty } : null });
});

router.get('/:id', requireRole('admin', 'doctor', 'nurse'), (req, res) => {
  const db = load();
  const p = db.patients.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

router.patch('/:id/vitals', requireRole('doctor', 'nurse'), (req, res) => {
  const db = load();
  const p = db.patients.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.vitals = { ...p.vitals, ...req.body };
  const prevRisk = p.riskLevel;
  p.riskLevel = computeRisk(p.vitals);
  p.timeline.unshift({
    time: new Date().toLocaleString(),
    event: `Vitals updated — HR ${p.vitals.hr}, SpO2 ${p.vitals.spo2}%, RR ${p.vitals.rr}, BP ${p.vitals.bp}`,
  });
  if (prevRisk !== p.riskLevel) {
    log(db, `Patient ${p.name} risk changed ${prevRisk} -> ${p.riskLevel}`);
    p.timeline.unshift({ time: new Date().toLocaleString(), event: `Risk level changed to ${p.riskLevel}` });
  }
  save(db);
  res.json(p);
});

// Discharge triggers a fully automatic sanitation cycle server-side —
// no manual button press is required for the room to eventually free up.
router.patch('/:id/discharge', requireRole('doctor', 'admin'), (req, res) => {
  const db = load();
  const p = db.patients.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.dischargedAt) return res.status(400).json({ error: 'Already discharged' });

  p.dischargedAt = Date.now();
  p.timeline.unshift({ time: new Date().toLocaleString(), event: 'Discharged from hospital' });

  const bedId = p.bedId;
  const bed = db.beds.find((b) => b.id === bedId);
  const room = db.rooms.find((r) => r.id === bedId);
  if (bed) bed.status = 'cleaning';
  if (room) {
    room.status = 'PENDING';
    room.lastPatientId = p.id;
    room.updatedAt = Date.now();
  }
  const doctor = db.doctors.find((d) => d.id === p.doctorId);
  if (doctor) doctor.patientIds = doctor.patientIds.filter((id) => id !== p.id);

  log(db, `Patient ${p.name} discharged — room ${bedId} automatically queued for sanitation`);
  save(db);

  if (bedId) {
    setTimeout(() => {
      const db2 = load();
      const r2 = db2.rooms.find((r) => r.id === bedId);
      if (r2 && r2.status === 'PENDING') {
        r2.status = 'ACTIVE';
        r2.updatedAt = Date.now();
        log(db2, `Room ${bedId} — sanitation crew automatically dispatched`);
        save(db2);
      }
    }, 8000);

    setTimeout(() => {
      const db3 = load();
      const r3 = db3.rooms.find((r) => r.id === bedId);
      const b3 = db3.beds.find((b) => b.id === bedId);
      if (r3 && r3.status !== 'READY') {
        r3.status = 'READY';
        r3.updatedAt = Date.now();
      }
      if (b3) {
        b3.status = 'available';
        b3.patientId = null;
      }
      log(db3, `Room ${bedId} sanitized and automatically released back to admissions`);
      save(db3);
    }, 20000);
  }

  res.json(p);
});

module.exports = router;
