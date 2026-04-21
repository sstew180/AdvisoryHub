const express = require('express');
const router = express.Router();
const multer = require('multer');
const mammoth = require('mammoth');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');

const PDFParser = require('pdf2json');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── PDF extraction using pdf2json ────────────────────────────────────────────
function extractPdf(buffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, 1);
    pdfParser.on('pdfParser_dataError', err => reject(new Error(err.parserError)));
    pdfParser.on('pdfParser_dataReady', () => {
      try { resolve(pdfParser.getRawTextContent()); }
      catch (e) { reject(e); }
    });
    pdfParser.parseBuffer(buffer);
  });
}

// ─── GET /api/library ─────────────────────────────────────────────────────────
// Returns all documents visible to the user:
//   - Admin/global documents (user_id IS NULL)
//   - User's own documents (user_id = userId)
//   - Project documents for user's projects (project_id in user's projects)
router.get('/', async (req, res) => {
  const { userId } = req.query;

  try {
    // Get user's project IDs
    let projectIds = [];
    if (userId) {
      const { data: projects } = await supabase
        .from('projects')
        .select('id')
        .eq('user_id', userId);
      projectIds = (projects || []).map(p => p.id);
    }

    // Fetch all visible documents in one query
    let query = supabase
      .from('library_documents')
      .select('id, title, category, domain, jurisdiction, description, source_url, default_enabled, user_id, project_id, is_admin_managed, created_at')
      .order('category')
      .order('title');

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Filter: admin docs + user's own + user's project docs
    const visible = (data || []).filter(d => {
      if (!d.user_id) return true; // admin/global doc
      if (d.user_id === userId) return true; // user's own doc
      if (d.project_id && projectIds.includes(d.project_id)) return true; // project doc
      return false;
    });

    res.json(visible);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/library/upload ─────────────────────────────────────────────────
// Handles both admin uploads and user uploads (personal + project)
router.post('/upload', upload.single('file'), async (req, res) => {
  const { title, category, domain, jurisdiction, description, sourceUrl, userId, projectId } = req.body;
  const file = req.file;

  if (!file) return res.status(400).json({ error: 'No file provided' });

  try {
    let content = '';

    if (file.mimetype === 'application/pdf') {
      content = await extractPdf(file.buffer);
    } else if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype.includes('wordprocessingml')
    ) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      content = result.value;
    } else {
      content = file.buffer.toString('utf-8');
    }

    if (!content || content.trim().length < 20) {
      return res.status(400).json({ error: 'Could not extract text from this file. Please check the file is not empty or image-only.' });
    }

    const embedding = await embed(content);

    // Determine if this is an admin upload or user upload
    const isAdmin = !userId; // if no userId provided, treat as admin upload

    const insertData = {
      title: title || file.originalname.replace(/\.[^.]+$/, ''),
      category: category || 'Skills',
      domain: domain || 'General',
      jurisdiction: jurisdiction || 'Queensland',
      description: description || null,
      source_url: sourceUrl || null,
      content: content.slice(0, 50000),
      embedding,
      is_admin_managed: isAdmin,
      default_enabled: isAdmin, // user docs default to enabled but not "default_enabled" globally
    };

    // Attach user_id for user uploads
    if (userId) insertData.user_id = userId;

    // Attach project_id if provided
    if (projectId) insertData.project_id = projectId;

    const { data, error } = await supabase
      .from('library_documents')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/library/:id ───────────────────────────────────────────────────
// Update title, description, jurisdiction, source_url, project_id
router.patch('/:id', async (req, res) => {
  const { title, jurisdiction, description, sourceUrl, projectId, userId } = req.body;

  try {
    // Verify ownership -- user can only edit their own docs, admins can edit all
    const { data: doc } = await supabase
      .from('library_documents')
      .select('user_id, is_admin_managed')
      .eq('id', req.params.id)
      .single();

    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Only allow edit if: admin doc (no userId restriction) OR user owns it
    if (doc.user_id && doc.user_id !== userId) {
      return res.status(403).json({ error: 'Not authorised to edit this document' });
    }

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (jurisdiction !== undefined) updates.jurisdiction = jurisdiction;
    if (description !== undefined) updates.description = description;
    if (sourceUrl !== undefined) updates.source_url = sourceUrl;
    if (projectId !== undefined) updates.project_id = projectId || null;

    const { error } = await supabase
      .from('library_documents')
      .update(updates)
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/library/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { userId } = req.query;

  try {
    // Verify ownership
    const { data: doc } = await supabase
      .from('library_documents')
      .select('user_id, is_admin_managed')
      .eq('id', req.params.id)
      .single();

    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Users can only delete their own docs. Admins (no userId) can delete any.
    if (userId && doc.user_id !== userId) {
      return res.status(403).json({ error: 'Not authorised to delete this document' });
    }

    const { error } = await supabase
      .from('library_documents')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
