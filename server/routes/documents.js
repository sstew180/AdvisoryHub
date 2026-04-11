const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.post('/upload', upload.single('file'), async (req, res) => {
  const { projectId, userId } = req.body;
  const file = req.file;
  try {
    let content = '';
    if (file.mimetype === 'application/pdf') {
      const data = await pdfParse(file.buffer); content = data.text;
    } else if (file.mimetype.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ buffer: file.buffer }); content = result.value;
    } else { content = file.buffer.toString('utf-8'); }
    const embedding = await embed(content);
    const { data, error } = await supabase.from('documents').insert({
      project_id: projectId, user_id: userId,
      filename: file.originalname, content: content.slice(0, 50000), embedding
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/:projectId', async (req, res) => {
  const { data, error } = await supabase.from('documents')
    .select('id, filename, created_at').eq('project_id', req.params.projectId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('documents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});
module.exports = router;

