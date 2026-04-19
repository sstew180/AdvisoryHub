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
app.use('/api/generate-title', require('./routes/generateTitle'));
app.use('/api/user-documents', require('./routes/userDocuments'));
app.use('/api/generate-file', require('./routes/generateFile'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/modules', require('./routes/modules'));
app.use('/api/suggest-prompts', require('./routes/suggestPrompts'));
app.use('/api/generate-style', require('./routes/generateStyle'));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`AdvisoryHub API running on port ${PORT}`));
