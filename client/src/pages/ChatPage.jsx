import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import Message from '../components/Message';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;

const LENGTH_OPTIONS = [
  { id: 'brief', label: 'Brief' },
  { id: 'standard', label: 'Standard' },
  { id: 'detailed', label: 'Detailed' },
];

const FORMAT_OPTIONS = [
  { id: 'prose', label: 'Prose' },
  { id: 'structured', label: 'Structured' },
  { id: 'bullets', label: 'Bullets' },
  { id: 'table', label: 'Table' },
];

const DEPTH_OPTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'full', label: 'Full + recs' },
  { id: 'critical', label: 'Critical' },
];

// Detect mobile
const isMobile = () => window.innerWidth < 768;

export default function ChatPage({ session, activeSessionId, setActiveSessionId, activeProject, onMenuOpen }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState('guided');
  const [formatControls, setFormatControls] = useState({ length: null, format: null, depth: null });
  const [formatOpen, setFormatOpen] = useState(!isMobile());
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    const setVh = () => {
      document.documentElement.style.setProperty('--real-vh', window.innerHeight + 'px');
    };
    setVh();
    window.addEventListener('resize', setVh);
    window.addEventListener('orientationchange', setVh);
    return () => {
      window.removeEventListener('resize', setVh);
      window.removeEventListener('orientationchange', setVh);
    };
  }, []);

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

  const toggleFormat = (type, id) => {
    setFormatControls(prev => ({ ...prev, [type]: prev[type] === id ? null : id }));
  };

  const formatActiveCount = Object.values(formatControls).filter(Boolean).length;

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

    const formatForThisSend = { ...formatControls };
    setFormatControls({ length: null, format: null, depth: null });

    try {
      const response = await fetch(API + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: session.user.id, sessionId,
          projectId: activeProject?.id || null,
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
          mode,
          ruleOverrides: {},
          formatControls: formatForThisSend,
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
        axios.post(API + '/api/generate-title', {
          sessionId, userMessage: text, assistantMessage: assistantText
        }).catch(console.error);
      }
    } catch (err) { console.error(err); }
    setStreaming(false);
  };

  const OptionPill = ({ active, onClick, children }) => (
    <button onClick={onClick} style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
      border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
      background: active ? 'rgba(0,145,164,0.08)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text-muted)',
      fontWeight: active ? 600 : 400, transition: 'all 0.15s', whiteSpace: 'nowrap',
    }}>{children}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'hidden',
      height: 'var(--real-vh, 100dvh)' }}>

      {/* Topbar -- clean: just hamburger, mode toggle, project indicator */}
      <div className='topbar'>
        <button className='hamburger' onClick={onMenuOpen} aria-label='Open menu'>
          <svg width='20' height='20' viewBox='0 0 20 20' fill='none'>
            <rect x='2' y='4' width='16' height='2' rx='1' fill='currentColor'/>
            <rect x='2' y='9' width='16' height='2' rx='1' fill='currentColor'/>
            <rect x='2' y='14' width='16' height='2' rx='1' fill='currentColor'/>
          </svg>
        </button>
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

            {/* Format toolbar -- collapsible, open by default on desktop */}
            <div style={{ borderBottom: formatOpen ? '1px solid var(--border)' : 'none' }}>

              {/* Toggle row */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '6px 14px 4px',
                gap: 8, borderBottom: formatOpen ? '1px solid var(--border)' : 'none' }}>
                <button
                  onClick={() => setFormatOpen(o => !o)}
                  style={{ fontSize: 11, color: formatActiveCount > 0 ? 'var(--accent)' : 'var(--text-muted)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
                  Format
                  {formatActiveCount > 0 && (
                    <span style={{ width: 6, height: 6, borderRadius: '50%',
                      background: 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 9, color: 'var(--text-muted)',
                    transform: formatOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block', transition: 'transform 0.2s' }}>▼</span>
                </button>
                {formatActiveCount > 0 && !formatOpen && (
                  <span style={{ fontSize: 10, color: 'var(--accent)' }}>
                    {[formatControls.length, formatControls.format, formatControls.depth]
                      .filter(Boolean).join(', ')}
                  </span>
                )}
                {formatActiveCount > 0 && (
                  <button onClick={() => setFormatControls({ length: null, format: null, depth: null })}
                    style={{ fontSize: 10, color: 'var(--text-muted)', background: 'none',
                      border: 'none', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}>
                    Clear
                  </button>
                )}
              </div>

              {/* Expanded controls */}
              {formatOpen && (
                <div style={{ display: 'flex', gap: 12, padding: '6px 14px 8px',
                  flexWrap: 'wrap', alignItems: 'center' }}>

                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 2 }}>Length</span>
                    {LENGTH_OPTIONS.map(o => (
                      <OptionPill key={o.id} active={formatControls.length === o.id}
                        onClick={() => toggleFormat('length', o.id)}>
                        {o.label}
                      </OptionPill>
                    ))}
                  </div>

                  <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />

                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 2 }}>Format</span>
                    {FORMAT_OPTIONS.map(o => (
                      <OptionPill key={o.id} active={formatControls.format === o.id}
                        onClick={() => toggleFormat('format', o.id)}>
                        {o.label}
                      </OptionPill>
                    ))}
                  </div>

                  <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />

                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 2 }}>Depth</span>
                    {DEPTH_OPTIONS.map(o => (
                      <OptionPill key={o.id} active={formatControls.depth === o.id}
                        onClick={() => toggleFormat('depth', o.id)}>
                        {o.label}
                      </OptionPill>
                    ))}
                  </div>
                </div>
              )}
            </div>

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