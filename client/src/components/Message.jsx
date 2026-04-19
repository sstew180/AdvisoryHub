import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;

const SCRUTINY_ROLES = [
  { id: 'cfo', label: 'CFO', prompt: 'You just read the previous response. What are the first three things a sceptical CFO would think or challenge? Be specific and direct. No preamble.' },
  { id: 'auditor', label: 'Auditor', prompt: 'You just read the previous response. What are the first three things an external auditor would flag or question? Be specific and direct. No preamble.' },
  { id: 'ceo', label: 'CEO', prompt: 'You just read the previous response. What would a CEO immediately push back on or want clarified before acting? Be specific and direct. No preamble.' },
  { id: 'councillor', label: 'Elected member', prompt: 'You just read the previous response. What would an elected council member question or find unclear when this lands on their desk? Be specific and direct. No preamble.' },
];

export default function Message({ message, session, sessionId, projectId, onPin, isLast, onInject }) {
  const isAssistant = message.role === 'assistant';
  const [pinned, setPinned] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [scrutinyOpen, setScrutinyOpen] = useState(false);

  const pin = async () => {
    if (pinning || pinned) return;
    setPinning(true);
    try {
      await axios.post(API + '/api/pin-memory', {
        userId: session.user.id,
        sessionId,
        projectId: projectId || null,
        content: message.content,
      });
      setPinned(true);
      onPin && onPin();
      setTimeout(() => setPinned(false), 3000);
    } catch (err) {
      console.error('Pin error:', err);
    }
    setPinning(false);
  };

  const copy = () => navigator.clipboard.writeText(message.content);

  const audit = () => {
    onInject && onInject(
      'Audit the previous response against the active writing rules. Check for: abstract concepts without evidence, movement verbs without evidence, rhetorical contrasts, buzzwords, slogans, unsupported claims, motive speculation, and flattery. List each violation with the specific sentence and what rule it breaks. If there are no violations say so plainly. Note: these violations reflect the current active writing rules in Settings -- to tighten output by default, update your rules in Settings.'
    );
  };

  const fixViolations = () => {
    onInject && onInject(
      'Rewrite the response that was audited, fixing every violation identified. Do not list the violations again. Do not explain what you changed. Just produce the corrected version.'
    );
  };



  const scrutinise = (role) => {
    setScrutinyOpen(false);
    onInject && onInject(role.prompt);
  };

  return (
    <div className={'message ' + message.role}>
      <div className='message-role'>{isAssistant ? 'AdvisoryHub' : 'You'}</div>
      <div className='message-content'>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>
      <div className='message-actions'>
        <button className='action-btn' onClick={copy}>Copy</button>

        {isAssistant && (
          <button
            className='action-btn'
            onClick={pin}
            disabled={pinning}
            style={{ color: pinned ? 'var(--accent)' : undefined }}
          >
            {pinning ? 'Pinning...' : pinned ? 'Pinned!' : 'Pin to memory'}
          </button>
        )}
        {isAssistant && isLast && (
          <>
            <button
              className='action-btn'
              onClick={audit}
              title='Check this response against your writing rules'
            >
              Audit
            </button>
            <button
              className='action-btn'
              onClick={fixViolations}
              title='Rewrite fixing any rule violations'
            >
              Fix it
            </button>
            <div style={{ position: 'relative' }}>
              <button
                className='action-btn'
                onClick={() => setScrutinyOpen(o => !o)}
                title='Challenge this response from a stakeholder perspective'
              >
                Scrutinise ▾
              </button>
              {scrutinyOpen && (
                <div style={{
                  position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                  zIndex: 100, minWidth: 160, overflow: 'hidden',
                }}>
                  {SCRUTINY_ROLES.map(role => (
                    <button
                      key={role.id}
                      onClick={() => scrutinise(role)}
                      style={{
                        display: 'block', width: '100%', padding: '8px 14px',
                        textAlign: 'left', background: 'none', border: 'none',
                        fontSize: 13, fontFamily: 'var(--font)', color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
