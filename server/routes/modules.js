const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// GET /api/modules?userId=xxx
// Returns all modules the user is licensed for, with their persona for each
router.get('/', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    // Get licensed module IDs
    const { data: licences, error: licErr } = await supabase
      .from('user_modules')
      .select('module_id')
      .eq('user_id', userId);
    if (licErr) throw licErr;

    if (!licences || licences.length === 0) return res.json([]);

    const moduleIds = licences.map(l => l.module_id);

    // Fetch module details
    const { data: modules, error: modErr } = await supabase
      .from('modules')
      .select('*')
      .in('id', moduleIds);
    if (modErr) throw modErr;

    // Fetch personas for this user
    const { data: personas } = await supabase
      .from('personas')
      .select('*')
      .eq('user_id', userId)
      .in('module_id', moduleIds);

    // Attach persona to each module
    const result = (modules || []).map(m => ({
      ...m,
      persona: (personas || []).find(p => p.module_id === m.id) || null,
    }));

    res.json(result);
  } catch (err) {
    console.error('Get modules error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/modules/:moduleId/persona?userId=xxx
// Returns the persona for a specific module
router.get('/:moduleId/persona', async (req, res) => {
  const { userId } = req.query;
  const { moduleId } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const { data, error } = await supabase
      .from('personas')
      .select('*')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json(data || null);
  } catch (err) {
    console.error('Get persona error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/modules/:moduleId/persona
// Upserts the persona for a specific module
router.patch('/:moduleId/persona', async (req, res) => {
  const { moduleId } = req.params;
  const { userId, ...fields } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const { data, error } = await supabase
      .from('personas')
      .upsert({
        user_id: userId,
        module_id: moduleId,
        ...fields,
      }, { onConflict: 'user_id,module_id' })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Update persona error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/modules/last-active
// Saves the last active module to profiles
router.patch('/last-active', async (req, res) => {
  const { userId, moduleId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ last_active_module: moduleId })
      .eq('id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Update last active module error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
