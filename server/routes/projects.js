const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// PATCH /api/projects/:id/archive
router.patch('/:id/archive', async (req, res) => {
  const { userId } = req.body;
  const { id } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const { data, error } = await supabase
      .from('projects')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Project not found or not owned by user' });
    res.json({ success: true, project: data });
  } catch (err) {
    console.error('Archive project error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/:id/restore
router.patch('/:id/restore', async (req, res) => {
  const { userId } = req.body;
  const { id } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const { data, error } = await supabase
      .from('projects')
      .update({ archived_at: null })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Project not found or not owned by user' });
    res.json({ success: true, project: data });
  } catch (err) {
    console.error('Restore project error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', async (req, res) => {
  const { userId } = req.query;
  const { id } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (!project) return res.status(404).json({ error: 'Project not found or not owned by user' });
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/archived?userId=xxx
router.get('/archived', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Get archived projects error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
