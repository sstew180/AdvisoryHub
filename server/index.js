const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/chat', require('./routes/chat'));
app.use('/api/summarise', require('./routes/summarise'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/pin-memory', require('./routes/pinMemory'));
app.use('/api/library', require('./routes/library'));
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(PORT, () => console.log(`AdvisoryHub API running on port ${PORT}`));