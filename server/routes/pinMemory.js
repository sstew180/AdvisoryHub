const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
router.post('/', async (req, res) => {
  const { userId, sessionId, content } = req.body;
  try {
    const embedding = await embed(content);
    await supabase.from('session_embeddings').insert({
      session_id: sessionId, user_id: userId,
      content: '[PINNED NOTE] ' + content, embedding
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
module.exports = router;

