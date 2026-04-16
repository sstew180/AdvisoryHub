const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// PATCH /api/sessions/:id/archive
// Soft-deletes a session by setting archived_at
router.patch('/:id/archive', async (req, res) => {
  const { userId } = req.body;
  const { id } = req.params;

  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const { data, error } = await supabase
      .from('sessions')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Session not found or not owned by user' });

    res.json({ success: true, session: data });
  } catch (err) {
    console.error('Archive session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/sessions/:id/restore
// Restores an archived session by clearing archived_at
router.patch('/:id/restore', async (req, res) => {
  const { userId } = req.body;
  const { id } = req.params;

  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const { data, error } = await supabase
      .from('sessions')
      .update({ archived_at: null })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Session not found or not owned by user' });

    res.json({ success: true, session: data });
  } catch (err) {
    console.error('Restore session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sessions/:id
// Permanently deletes a session (messages and embeddings cascade)
router.delete('/:id', async (req, res) => {
  const { userId } = req.query;
  const { id } = req.params;

  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    // Verify ownership before delete
    const { data: session } = await supabase
      .from('sessions')
      .select('id, user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (!session) return res.status(404).json({ error: 'Session not found or not owned by user' });

    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('Delete session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/archived?userId=xxx
// Returns all archived sessions for the user via RPC
router.get('/archived', async (req, res) => {
  const { userId } = req.query;

  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const { data, error } = await supabase
      .rpc('get_archived_sessions', { p_user_id: userId });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error('Get archived sessions error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
