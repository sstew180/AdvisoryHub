const express = require('express');
const router = express.Router();
const multer = require('multer');
const mammoth = require('mammoth');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
const upload = multer({ storage: multer.memoryStorage() });

async function extractPdfText(buffer) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true
  }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

router.get('/', async (req, res) => {
  console.log('Library route hit');
  const { data, error } = await supabase.from('library_documents')
    .select('id, title, category, domain, jurisdiction, description, source_url, default_enabled')
    .order('category');
  console.log('Library data:', data?.length, 'error:', error);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/upload', upload.single('file'), async (req, res) => {
  const { title, category, domain, jurisdiction, description, sourceUrl } = req.body;
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
    const { data, error } = await supabase.from('library_documents').insert({
      title, category, domain, jurisdiction, description,
      content: content.slice(0, 50000), source_url: sourceUrl, embedding
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Library upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;