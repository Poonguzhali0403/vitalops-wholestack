const express = require('express');
const { load, save, log } = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

router.get('/', requireRole('admin', 'nurse', 'staff'), (req, res) => {
  res.json(load().rooms);
});

// Manual override, in addition to the automatic timer in patients.js —
// lets staff speed up or verify a cleaning cycle during a demo.
router.patch('/:id/advance', requireRole('nurse', 'staff', 'admin'), (req, res) => {
  const db = load();
  const r = db.rooms.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const order = ['PENDING', 'ACTIVE', 'READY'];
  const idx = order.indexOf(r.status);
  if (idx >= 0 && idx < order.length - 1) {
    r.status = order[idx + 1];
    r.updatedAt = Date.now();
  }
  if (r.status === 'READY') {
    const b = db.beds.find((b) => b.id === r.id);
    if (b) {
      b.status = 'available';
      b.patientId = null;
    }
  }
  log(db, `Room ${r.id} manually advanced to ${r.status} by ${req.user.name}`);
  save(db);
  res.json(r);
});

module.exports = router;
