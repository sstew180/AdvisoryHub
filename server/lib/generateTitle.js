// server/lib/generateTitle.js
// =============================================================================
// SVR-5: Auto-title sessions.
//
// Shared title generation helper used in two places:
//   1. server/routes/generateTitle.js -- AHP endpoint /api/generate-title,
//      called by the React frontend after the first exchange of a session.
//   2. server/routes/copilot.js -- AHC chat endpoint /api/copilot/chat,
//      called fire-and-forget after the first exchange of a newly created
//      session.
//
// Generates a concise 4-6 word title from the first exchange and saves it
// to sessions.title for the given sessionId.
//
// Errors are caught and logged. The function never throws. Safe to call
// fire-and-forget from anywhere in the request pipeline; failures will not
// affect the main chat response.
// =============================================================================

const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./supabase');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate a concise 4-6 word title from the first exchange of a session,
 * then save it to the sessions table.
 *
 * @param {string} sessionId         ID of the session row to update.
 * @param {string} userMessage       First user message content.
 * @param {string} assistantMessage  First assistant response content.
 * @returns {Promise<string|null>}   The generated title, or null on failure.
 */
async function generateAndSaveTitle(sessionId, userMessage, assistantMessage) {
  if (!sessionId || !userMessage || !assistantMessage) {
    console.error('generateAndSaveTitle: missing required argument', {
      hasSessionId: !!sessionId,
      hasUserMessage: !!userMessage,
      hasAssistantMessage: !!assistantMessage,
    });
    return null;
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 30,
      messages: [{
        role: 'user',
        content:
          'Generate a concise 4-6 word title for a conversation that starts ' +
          'with this exchange. Return only the title, no punctuation, no ' +
          'quotes.\n\n' +
          'User: ' + userMessage.slice(0, 300) + '\n\n' +
          'Assistant: ' + assistantMessage.slice(0, 300),
      }],
    });

    const rawText = (response && response.content && response.content[0] && response.content[0].text) || '';
    const title = rawText.trim().slice(0, 60);

    if (!title) {
      console.error('generateAndSaveTitle: empty title from model', { sessionId });
      return null;
    }

    const { error } = await supabase
      .from('sessions')
      .update({ title })
      .eq('id', sessionId);

    if (error) {
      console.error('generateAndSaveTitle: DB update failed:', error.message);
      return null;
    }

    console.log('generateAndSaveTitle: saved title for session', sessionId, '->', title);
    return title;
  } catch (err) {
    console.error('generateAndSaveTitle: error:', err.message);
    return null;
  }
}

module.exports = { generateAndSaveTitle };
