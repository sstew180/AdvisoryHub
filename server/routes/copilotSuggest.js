// server/routes/copilotSuggest.js
// CHT-3: on-demand contextual prompt suggestions for the AHC Power Apps client.
//
// This is the demo value-add. Instead of static starter prompts (which Copilot
// already does), this asks Claude for six prompts that are specific to the
// officer's module (domain), active project, and role, so the suggestions
// visibly reflect the Queensland local government context.
//
// It is mounted in index.js at the same /api/copilot prefix and behind the same
// copilotAuth middleware as copilot.js. Express runs the two routers in order;
// copilot.js has no /suggest-prompts route, so a request for that path falls
// through to this router. Keeping it separate means copilot.js is untouched.

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Same lookup copilot.js uses: resolve a Supabase auth user from their email.
async function getUserByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(`Auth lookup failed: ${error.message}`);
  const user = data.users.find(
    u => u.email && u.email.toLowerCase() === email.toLowerCase()
  );
  if (!user) throw new Error(`No user found for email: ${email}`);
  return user;
}

// ---- POST /api/copilot/suggest-prompts ----
// Body: { email (required), project_id (optional), module_id (optional) }
// Returns: { prompts: [ { prompt: "..." }, ... ] }  (up to six)
router.post('/suggest-prompts', async (req, res) => {
  const body = req.body || {};
  const email = body.email;
  const project_id = body.project_id || body.projectId;
  const module_id = body.module_id || body.moduleId;

  if (!email) {
    return res.status(400).json({ error: 'email is required in the request body.' });
  }

  try {
    const user = await getUserByEmail(email);
    const userId = user.id;

    // Profile gives us the user's name, role, and current module fallback.
    // select('*') is used (as the chat route does) so we never error on a
    // column that may not exist; we just read fields if they are present.
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    // Resolve the module (domain) for context. Prefer the module_id passed in,
    // otherwise fall back to the user's last active module.
    const moduleId = module_id || (profile && profile.last_active_module) || null;
    let module = null;
    if (moduleId) {
      const { data } = await supabase
        .from('modules')
        .select('name, description')
        .eq('id', moduleId)
        .single();
      module = data;
    }

    // Resolve the active project for extra context, if one is supplied.
    let project = null;
    if (project_id) {
      const { data } = await supabase
        .from('projects')
        .select('name, description, objectives')
        .eq('id', project_id)
        .single();
      project = data;
    }

    // Build a compact, context-rich block. The richer this is, the more
    // obviously specialised the suggestions look in the demo.
    let context = '';
    if (module && module.name) {
      context += `\nDomain / module: ${module.name}`;
      if (module.description) context += ` - ${module.description}`;
    }
    if (profile && profile.role) {
      context += `\nThe user's role: ${profile.role}`;
    }
    if (project && project.name) {
      context += `\nActive project: ${project.name}`;
      if (project.description) context += `\nProject description: ${project.description}`;
      if (project.objectives) context += `\nProject objectives: ${project.objectives}`;
    }
    if (!context) {
      context =
        '\nNo specific module or project context is available; suggest broadly ' +
        'useful Queensland local government advisory prompts.';
    }

    const systemPrompt =
      'You are AdvisoryHub, an AI advisory assistant for local government ' +
      'officers in Queensland, Australia. Your job here is to suggest six short ' +
      'starter prompts the user could tap to begin a useful conversation. Make ' +
      'every prompt specific to the context below: the domain, the role, and the ' +
      'project. Avoid generic prompts that could apply to any tool. Each prompt ' +
      'must be a single clear request of about 6 to 14 words, written in the ' +
      'first person as the user would type it. Ground them in real Queensland ' +
      'local government practice where relevant. ' +
      'Return ONLY a JSON array of exactly six strings. No preamble, no object ' +
      'keys, no markdown, no code fences.';

    const userPrompt =
      'Here is the context. Generate the six starter prompts now.' + context;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content && response.content[0] && response.content[0].text
      ? response.content[0].text.trim()
      : '';
    if (!text) return res.status(500).json({ error: 'No response from model.' });

    // Strip any stray code fences, then parse the JSON array.
    const clean = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error('suggest-prompts parse error. Raw text was:', clean);
      return res.status(500).json({ error: 'Model did not return valid JSON.' });
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return res.status(500).json({ error: 'Model did not return a prompt array.' });
    }

    // Normalise to at most six and wrap each string as { prompt } so a Power
    // Apps gallery can bind to ThisItem.prompt directly.
    const prompts = parsed
      .filter(p => typeof p === 'string' && p.trim())
      .slice(0, 6)
      .map(p => ({ prompt: p.trim() }));

    return res.json({ prompts });
  } catch (err) {
    console.error('suggest-prompts (copilot) error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
