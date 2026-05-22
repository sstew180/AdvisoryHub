'use strict';

// =============================================================================
// server/lib/summariseSession.js
//
// SVR-6: summarise + embed every 10 messages (ported from AHP).
//
// Each time a session reaches a multiple of 10 saved messages, this generates a
// short third-person summary of the conversation, embeds it, stores the
// embedding in session_embeddings, and updates sessions.summary. Future
// sessions retrieve these summaries via the existing match_sessions RPC, which
// gives the assistant cross-session recall ("what did we work on last time").
//
// HOW IT IS CALLED:
//   Fire-and-forget from copilot.js, right after the assistant message is
//   saved (the same spot the SVR-5 auto-title call sits):
//
//     summariseSession(activeSessionId, userId).catch(err =>
//       console.error('summariseSession failed:', err.message));
//
// It never throws back into the chat request path: every failure is logged and
// swallowed, so a summariser problem can never break a user's reply.
//
// NO DATABASE CHANGE IS REQUIRED. The session_embeddings table and the
// match_sessions RPC already exist in AHC (copilot.js already reads from them),
// and sessions.summary already exists.
// =============================================================================

const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./supabase');
const { embed } = require('./embed');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Summarise each time the saved-message count hits a multiple of this number.
// One conversational turn is two messages (user + assistant), so 10 messages is
// roughly every five turns.
const EVERY_N_MESSAGES = 10;

// Cap how many of the most recent messages we feed the summariser, so the
// summary prompt stays a sensible size on long sessions.
const MAX_MESSAGES_IN_PROMPT = 40;

/**
 * Summarise and embed a session if it has just crossed a 10-message boundary.
 * Safe to call after every assistant reply; it self-checks and returns early
 * when there is nothing to do.
 *
 * @param {string} sessionId
 * @param {string} userId
 */
async function summariseSession(sessionId, userId) {
  if (!sessionId || !userId) return;

  // How many messages does this session have now?
  const { count, error: countError } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);

  if (countError) {
    console.error('summariseSession count error:', countError.message);
    return;
  }
  if (!count || count % EVERY_N_MESSAGES !== 0) {
    return; // not on a 10-message boundary, nothing to do
  }

  // Pull the most recent messages, then put them back in chronological order.
  const { data: recentDesc, error: msgError } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES_IN_PROMPT);

  if (msgError) {
    console.error('summariseSession message fetch error:', msgError.message);
    return;
  }

  const messages = (recentDesc || []).reverse();
  if (messages.length === 0) return;

  const transcript = messages.map(m => m.role + ': ' + m.content).join('\n');

  // Same prompt shape as the AHP summarise route.
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content:
        'Summarise the following conversation in 2-3 dense sentences capturing ' +
        'key topics, decisions, and context. Write in third person.\n\n' +
        transcript,
    }],
  });

  const summary = (response.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();

  if (!summary) return;

  const embedding = await embed(summary);

  // Update the human-readable session summary (shown in the sidebar list).
  await supabase.from('sessions').update({ summary }).eq('id', sessionId);

  // Replace any prior summary embedding for this session, so match_sessions
  // holds exactly one current summary per session rather than accumulating a
  // stale one at every 10-message boundary. This is the one deliberate change
  // from the AHP version, which only ever inserted (it was triggered once, not
  // repeatedly).
  await supabase.from('session_embeddings').delete().eq('session_id', sessionId);
  await supabase.from('session_embeddings').insert({
    session_id: sessionId,
    user_id: userId,
    content: summary,
    embedding,
  });
}

module.exports = { summariseSession };
