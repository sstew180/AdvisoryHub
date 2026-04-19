const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');

router.post('/', async (req, res) => {
  const { userId, sessionId, projectId, content } = req.body;
  try {
    const embedding = await embed(content);

    // Store the pinned note
    await supabase.from('session_embeddings').insert({
      session_id: sessionId, user_id: userId,
      content: '[PINNED NOTE] ' + content, embedding
    });

    // If session has no project_id but we know the active project, link them now
    if (projectId && sessionId) {
      const { data: sess } = await supabase
        .from('sessions').select('project_id').eq('id', sessionId).single();
      if (sess && !sess.project_id) {
        await supabase.from('sessions').update({ project_id: projectId }).eq('id', sessionId);
      }
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
