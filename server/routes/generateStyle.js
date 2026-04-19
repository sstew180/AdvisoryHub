const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/generate-style
// Accepts wizard answers and synthesises a style or working profile paragraph
router.post('/', async (req, res) => {
  const { type, answers } = req.body;
  // type: 'writing' or 'working'
  // answers: array of { question, answer } objects

  const answerBlock = answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n');

  const prompts = {
    writing: `Based on the following answers, write a concise 2-3 sentence communication style profile for an AI assistant to follow. Write in second person ("You prefer..."). Be specific and direct. No preamble, no explanation, no bullet points -- just the profile paragraph.\n\n${answerBlock}`,
    working: `Based on the following answers, write a concise 2-3 sentence working style profile for an AI assistant to follow. Write in second person ("You work at pace..."). Be specific and direct. No preamble, no explanation, no bullet points -- just the profile paragraph.\n\n${answerBlock}`,
  };

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompts[type] || prompts.writing }],
    });
    res.json({ result: response.content[0].text.trim() });
  } catch (err) {
    console.error('Generate style error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
