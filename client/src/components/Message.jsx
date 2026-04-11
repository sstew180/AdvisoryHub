
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import axios from 'axios';
const API = import.meta.env.VITE_API_URL;

export default function Message({ message, session, sessionId, onPin }) {
  const isAssistant = message.role === 'assistant';
  const pin = async () => {
    await axios.post(API + '/api/pin-memory', {
      userId: session.user.id, sessionId, content: message.content
    });
    onPin && onPin();
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
        {isAssistant && <button className='action-btn' onClick={pin}>Pin to memory</button>}
      </div>
    </div>
  );
}

