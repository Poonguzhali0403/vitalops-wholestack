require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { router: authRouter } = require('./routes/auth');
const patientsRouter = require('./routes/patients');
const doctorsRouter = require('./routes/doctors');
const staffRouter = require('./routes/staff');
const roomsRouter = require('./routes/rooms');
const inventoryRouter = require('./routes/inventory');
const requestsRouter = require('./routes/requests');
const chatRouter = require('./routes/chat');
const searchRouter = require('./routes/search');
const simulationRouter = require('./routes/simulation');
const auditRouter = require('./routes/audit');
const appointmentsRouter = require('./routes/appointments');
const orScheduleRouter = require('./routes/orSchedule');
const bedsRouter = require('./routes/beds');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/doctors', doctorsRouter);
app.use('/api/staff', staffRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/search', searchRouter);
app.use('/api/simulation', simulationRouter);
app.use('/api/audit', auditRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/or-schedule', orScheduleRouter);
app.use('/api/beds', bedsRouter);

// Serves the frontend directly — one server, one command, one port.
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

if (require.main === module) {
  const PORT = process.env.PORT || 4000;

  app.listen(PORT, () => {
    console.log(`VitalOps running on port ${PORT}`);

    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('AI assistant running in offline fallback mode.');
    }
  });
}

module.exports = app;
