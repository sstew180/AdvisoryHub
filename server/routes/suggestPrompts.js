const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post('/', async (req, res) => {
  const { systemPrompt, userPrompt } = req.body;
  if (!systemPrompt || !userPrompt) return res.status(400).json({ error: 'Missing prompts' });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content?.[0]?.text?.trim();
    if (!text) return res.status(500).json({ error: 'No response' });

    const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.length === 6) return res.json(parsed);
    return res.status(500).json({ error: 'Invalid response format' });
  } catch (err) {
    console.error('suggest-prompts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
