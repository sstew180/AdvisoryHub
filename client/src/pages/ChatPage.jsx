import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import Message from '../components/Message';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;

export default function ChatPage({ session, activeSessionId, setActiveSessionId, activeProject }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState('guided');
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!activeSessionId) { setMessages([]); return; }
    supabase.from('messages').select('*').eq('session_id', activeSessionId)
      .order('created_at').then(({ data }) => { if (data) setMessages(data); });
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  const ensureSession = async () => {
    if (activeSessionId) return activeSessionId;
    const { data } = await supabase.from('sessions').insert({
      user_id: session.user.id, project_id: activeProject?.id || null, title: null
    }).select().single();
    setActiveSessionId(data.id);
    return data.id;
  };

  const send = async () => {
    if (!input.trim() || streaming) return;
    const text = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    const sessionId = await ensureSession();
    const userMsg = { role: 'user', content: text };
    await supabase.from('messages').insert({ ...userMsg, session_id: sessionId });
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    let assistantText = '';
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
    try {
      const response = await fetch(API + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: session.user.id, sessionId,
          projectId: activeProject?.id || null,
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
          mode
        })
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n').filter(l => l.startsWith('data: '))) {
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const { text } = JSON.parse(data);
            assistantText += text;
            setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: assistantText }]);
          } catch {}
        }
      }
      await supabase.from('messages').insert({ role: 'assistant', content: assistantText, session_id: sessionId });
      const { data: allMsgs } = await supabase.from('messages')
        .select('*').eq('session_id', sessionId).order('created_at');
      if (allMsgs && allMsgs.length > 0 && allMsgs.length % 10 === 0) {
        axios.post(API + '/api/summarise', {
          userId: session.user.id, sessionId, messages: allMsgs
        }).catch(console.error);
      }
      if (messages.length === 0) {
        await supabase.from('sessions').update({ title: text.slice(0, 60) }).eq('id', sessionId);
      }
    } catch (err) { console.error(err); }
    setStreaming(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className='topbar'>
        <div className='mode-toggle'>
          <button className={'mode-btn' + (mode === 'guided' ? ' active' : '')} onClick={() => setMode('guided')}>Guided</button>
          <button className={'mode-btn' + (mode === 'direct' ? ' active' : '')} onClick={() => setMode('direct')}>Direct</button>
        </div>
        {activeProject && <div className='project-indicator'>Project: <span>{activeProject.name}</span></div>}
      </div>
      <div className='chat-area'>
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', paddingTop: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>AdvisoryHub</div>
            <div style={{ fontSize: 14 }}>Risk, Audit and Insurance</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <Message key={i} message={msg} session={session}
            sessionId={activeSessionId} onPin={() => console.log('Pinned')} />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className='input-area'>
        <div className='input-area-inner'>
          <div className='input-box'>
            <textarea
              ref={textareaRef}
              className='input-textarea'
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder='Ask AdvisoryHub... (Shift+Enter for new line)'
              rows={1}
            />
            <div className='input-footer'>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {activeProject ? <><span className='context-enabled'></span>{activeProject.name}</> : 'No project active'}
              </span>
              <button className='send-btn' onClick={send} disabled={streaming || !input.trim()}>
                {streaming ? '...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}