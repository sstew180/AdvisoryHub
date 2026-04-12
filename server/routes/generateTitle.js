const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post('/', async (req, res) => {
  const { sessionId, userMessage, assistantMessage } = req.body;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 30,
      messages: [{
        role: 'user',
        content: `Generate a concise 4-6 word title for a conversation that starts with this exchange. Return only the title, no punctuation, no quotes.\n\nUser: ${userMessage.slice(0, 300)}\n\nAssistant: ${assistantMessage.slice(0, 300)}`
      }]
    });
    const title = response.content[0].text.trim().slice(0, 60);
    await supabase.from('sessions').update({ title }).eq('id', sessionId);
    res.json({ title });
  } catch (err) {
    console.error('Title generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;