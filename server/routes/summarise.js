const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/embed');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
router.post('/', async (req, res) => {
  const { userId, sessionId, messages } = req.body;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 500,
      messages: [{ role: 'user', content:
        'Summarise the following conversation in 2-3 dense sentences capturing ' +
        'key topics, decisions, and context. Write in third person.\n\n' +
        messages.map(m => m.role + ': ' + m.content).join('\n')
      }]
    });
    const summary = response.content[0].text;
    const embedding = await embed(summary);
    await supabase.from('sessions').update({ summary }).eq('id', sessionId);
    await supabase.from('session_embeddings').insert({
      session_id: sessionId, user_id: userId, content: summary, embedding
    });
    res.json({ summary });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
module.exports = router;
