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

// List library documents -- optionally filter by project_id
router.get('/', async (req, res) => {
  const { projectId } = req.query;
  let query = supabase.from('library_documents')
    .select('id, title, category, domain, jurisdiction, description, source_url, default_enabled, project_id')
    .order('category');

  if (projectId) {
    query = query.eq('project_id', projectId);
  } else {
    query = query.is('project_id', null);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Upload library document -- optional projectId scopes it to a project
router.post('/upload', upload.single('file'), async (req, res) => {
  const { title, category, domain, jurisdiction, description, sourceUrl, projectId } = req.body;
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
      content: content.slice(0, 50000),
      source_url: sourceUrl,
      project_id: projectId || null,
      embedding,
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Library upload error:', err);
    res.status(500).json({ error: err.message });
  }
});
// Delete library document (admin only via service role)
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('library_documents')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});
module.exports = router;