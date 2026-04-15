const express = require('express');
const router = express.Router();
const multer = require('multer');
const mammoth = require('mammoth');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function extractPdfText(buffer) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({
    data, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true
  }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

// List user documents
router.get('/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from('user_documents')
    .select('id, filename, created_at')
    .eq('user_id', req.params.userId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Upload user document
router.post('/upload', upload.single('file'), async (req, res) => {
  const { userId } = req.body;
  const file = req.file;
  try {
    let content = '';
    if (file.mimetype === 'application/pdf') {
      content = await extractPdfText(file.buffer);
    } else if (file.mimetype.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      content = result.value;
    } else {
      content = file.buffer.toString('utf-8');
    }
    const embedding = await embed(content);
    const { data, error } = await supabase.from('user_documents').insert({
      user_id: userId,
      filename: file.originalname,
      content: content.slice(0, 50000),
      embedding,
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('User document upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete user document
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('user_documents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;