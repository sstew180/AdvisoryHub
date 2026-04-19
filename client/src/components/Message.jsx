import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;

export default function Message({ message, session, sessionId, projectId, onPin }) {
  const isAssistant = message.role === 'assistant';
  const [pinned, setPinned] = useState(false);
  const [pinning, setPinning] = useState(false);

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
      </div>
    </div>
  );
}
