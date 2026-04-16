const express = require('express');
const router = express.Router();
const multer = require('multer');
const mammoth = require('mammoth');
const PDFParser = require('pdf2json');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
const upload = multer({ storage: multer.memoryStorage() });

function extractPdfText(buffer) {
  return new Promise((resolve) => {
    try {
      const pdfParser = new PDFParser(null, 1);
      pdfParser.on('pdfParser_dataReady', (data) => {
        try {
          const text = data.Pages.map(page =>
            page.Texts.map(t => t.R.map(r => decodeURIComponent(r.T)).join('')).join(' ')
          ).join('\n\n');
          resolve(text.trim().length > 0 ? text : '');
        } catch (e) {
          console.error('PDF text assembly error:', e.message);
          resolve('');
        }
      });
      pdfParser.on('pdfParser_dataError', (err) => {
        console.error('PDF parse error:', err.parserError);
        resolve('');
      });
      pdfParser.parseBuffer(buffer);
    } catch (e) {
      console.error('PDF parser init error:', e.message);
      resolve('');
    }
  });
}

// GET /api/library
// Returns all library documents with their linked project IDs
router.get('/', async (req, res) => {
  try {
    // Fetch all documents
    const { data: docs, error } = await supabase
      .from('library_documents')
      .select('id, title, category, domain, jurisdiction, description, source_url, default_enabled, project_id')
      .order('category');

    if (error) throw error;

    // Fetch all junction table entries
    const docIds = (docs || []).map(d => d.id);
    let projectLinks = [];
    if (docIds.length > 0) {
      const { data: links } = await supabase
        .from('library_document_projects')
        .select('document_id, project_id')
        .in('document_id', docIds);
      projectLinks = links || [];
    }

    // Attach project_ids array to each document
    const result = (docs || []).map(d => {
      const linked = projectLinks
        .filter(l => l.document_id === d.id)
        .map(l => l.project_id);
      return {
        ...d,
        project_ids: linked,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Library GET error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/library/upload
// Uploads a document and links it to zero or more projects via junction table
router.post('/upload', upload.single('file'), async (req, res) => {
  const { title, category, domain, jurisdiction, description, sourceUrl } = req.body;

  // projectIds can be a single string or an array
  let projectIds = req.body.projectIds || req.body['projectIds[]'] || [];
  if (typeof projectIds === 'string') projectIds = [projectIds];
  projectIds = projectIds.filter(Boolean);

  const file = req.file;
  try {
    let content = '';
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      content = await extractPdfText(file.buffer);
    } else if (file.mimetype.includes('wordprocessingml') || file.originalname.toLowerCase().endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      content = result.value || '';
    } else {
      content = file.buffer.toString('utf-8');
    }

    const embedding = await embed(content);

    // Insert document -- project_id column left null (junction table handles linking)
    const { data: doc, error } = await supabase
      .from('library_documents')
      .insert({
        title,
        category,
        domain: domain || 'Risk & Audit',
        jurisdiction,
        description,
        content: content.slice(0, 50000),
        source_url: sourceUrl || null,
        project_id: null,
        embedding,
      })
      .select()
      .single();

    if (error) throw error;

    // Insert junction table rows for each project
    if (projectIds.length > 0) {
      const links = projectIds.map(pid => ({
        document_id: doc.id,
        project_id: pid,
      }));
      const { error: linkError } = await supabase
        .from('library_document_projects')
        .insert(links);
      if (linkError) console.error('Junction insert error:', linkError);
    }

    res.json({ ...doc, project_ids: projectIds });
  } catch (err) {
    console.error('Library upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/library/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('library_documents')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
