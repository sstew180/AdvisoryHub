import { useState, useEffect, useRef, useCallback } from 'react';
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

const MODE_DESCRIPTIONS = {
  guided: 'Guided mode draws on your profile, project context, and relevant frameworks to give you well-rounded advice.',
  direct: 'Direct mode answers immediately with no preamble. Best for quick questions and specific requests.',
  inquisitive: 'Inquisitive mode asks you one question at a time to help you think through a problem before producing any output.',
};

const isMobile = () => window.innerWidth < 768;

const FALLBACK_GENERAL_PROMPTS = [
  'What are the key elements of an effective risk appetite statement for a local government?',
  'Summarise the QAO better practice approach to internal audit planning.',
  'Draft a briefing note on the requirements of the Local Government Act 2009 for risk management.',
  'What should be included in an insurance renewal briefing for the executive?',
  'Explain the difference between inherent and residual risk with a practical example.',
  'What does ISO 31000 say about risk treatment options?',
];

const FALLBACK_PROJECT_PROMPTS = [
  'Summarise the key objectives and current status of this project.',
  'What are the main risks associated with this project?',
  'Draft a briefing note on the progress of this project.',
  'What decisions are outstanding on this project?',
  'Identify any assumptions in this project that should be tested.',
  'What would a critical review of this project highlight?',
];

async function generatePersonalisedPrompts(profile, activeProject) {
  const profileParts = [];
  if (profile.role) profileParts.push('Role: ' + profile.role);
  if (profile.service_area) profileParts.push('Service area: ' + profile.service_area);
  if (profile.organisation) profileParts.push('Organisation: ' + profile.organisation);
  if (profile.goals) profileParts.push('Current objectives: ' + profile.goals);

  const projectParts = [];
  if (activeProject) {
    projectParts.push('Active project: ' + activeProject.name);
    if (activeProject.description) projectParts.push('Background: ' + activeProject.description);
    if (activeProject.objectives) projectParts.push('Objectives: ' + activeProject.objectives);
  }

  const contextBlock = [
    profileParts.length > 0 ? 'User profile:\n' + profileParts.join('\n') : '',
    projectParts.length > 0 ? 'Active project:\n' + projectParts.join('\n') : '',
  ].filter(Boolean).join('\n\n');

  if (!contextBlock.trim()) return null;

  const systemPrompt = 'You are AdvisoryHub, an AI advisory assistant for local government officers specialising in Risk, Audit, and Insurance in Queensland, Australia.';
  const userPrompt = `Based on this user context, generate exactly 6 short, specific, actionable prompt suggestions the user might want to ask right now. Each suggestion should be a complete question or request, directly relevant to their role, objectives, or active project. Make them concrete and practical -- not generic.\n\n${contextBlock}\n\nReturn a JSON array of exactly 6 strings. No other text, no markdown, no explanation. Example format:\n["Prompt one", "Prompt two", "Prompt three", "Prompt four", "Prompt five", "Prompt six"]`;

  const response = await fetch(API + '/api/suggest-prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userPrompt }),
  });

  if (!response.ok) return null;
  const data = await response.json();
  if (Array.isArray(data) && data.length === 6) return data;
  return null;
}

// Speak text using Web Speech API SpeechSynthesis
function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-AU';
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang === 'en-AU') ||
    voices.find(v => v.lang.startsWith('en-')) ||
    voices[0];
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

function StatusCallout({ steps, visible }) {
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    if (visible && steps.length > 0) setOpacity(1);
    else if (!visible) {
      const t = setTimeout(() => setOpacity(0), 100);
      return () => clearTimeout(t);
    }
  }, [visible, steps.length]);

  if (steps.length === 0) return null;

  return (
    <div style={{
      borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
      background: 'var(--surface)', padding: '10px 48px',
      opacity, transition: 'opacity 0.3s ease', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4, flexShrink: 0 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
          {steps.length > 1 && (
            <div style={{ width: 1, flex: 1, background: 'var(--border)', marginTop: 4, minHeight: 6 }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {steps.map((step, i) => (
            <div key={i} style={{ marginBottom: i < steps.length - 1 ? 6 : 0 }}>
              <div style={{
                fontSize: 12,
                color: i === steps.length - 1 ? 'var(--accent)' : 'var(--text-muted)',
                fontWeight: i === steps.length - 1 ? 500 : 400,
                animation: 'fadeIn 0.25s ease',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {i > 0 && (
                  <span style={{ width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
                    background: i === steps.length - 1 ? 'var(--accent)' : 'var(--border)',
                    display: 'inline-block' }} />
                )}
                {step}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ activeProject, activeModule, onPromptClick, userId, mode }) {
  const [prompts, setPrompts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hintDismissed, setHintDismissed] = useState(() => {
    try { return localStorage.getItem('ah-hint-dismissed') === '1'; } catch { return false; }
  });
  const fallback = activeProject ? FALLBACK_PROJECT_PROMPTS : FALLBACK_GENERAL_PROMPTS;
  const subtitle = activeProject
    ? 'Active project: ' + activeProject.name
    : activeModule ? activeModule.name : 'Risk, Audit and Insurance';

  const load = useCallback(async () => {
    setLoading(true);
    setPrompts(null);
    try {
      const { data: profile } = await supabase
        .from('profiles').select('role, service_area, organisation, goals')
        .eq('id', userId).single();
      const result = await generatePersonalisedPrompts(profile || {}, activeProject);
      setPrompts(result);
    } catch { setPrompts(null); }
    setLoading(false);
  }, [userId, activeProject?.id]);

  useEffect(() => { load(); }, [load]);

  const dismissHint = () => {
    try { localStorage.setItem('ah-hint-dismissed', '1'); } catch {}
    setHintDismissed(true);
  };

  const displayPrompts = prompts || fallback;

  return (
    <div style={{ paddingTop: 48, paddingBottom: 32, maxWidth: 600, margin: '0 auto', width: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>AdvisoryHub</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{subtitle}</div>
      </div>

      {/* Welcome hint -- only shows until dismissed */}
      {!hintDismissed && mode !== 'inquisitive' && (
        <div style={{
          marginBottom: 20, padding: '12px 16px', borderRadius: 'var(--radius)',
          background: 'rgba(0,145,164,0.06)', border: '1px solid rgba(0,145,164,0.2)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ fontSize: 18, flexShrink: 0 }}>💡</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 3 }}>
              Try Inquisitive mode
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Switch to Inquisitive in the topbar and tell AdvisoryHub what you are working on.
              It will ask you one question at a time to help you think it through before writing anything.
            </div>
          </div>
          <button onClick={dismissHint}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, color: 'var(--text-muted)', padding: '0 2px', flexShrink: 0, lineHeight: 1 }}>
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ padding: '12px 14px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', background: 'var(--surface)', height: 60,
              animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <button onClick={load} title='Refresh suggestions'
            style={{ position: 'absolute', top: -32, right: 0, background: 'none', border: 'none',
              cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', padding: '2px 6px',
              borderRadius: 'var(--radius)', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
            ↻
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {displayPrompts.map((prompt, i) => (
              <div key={i} onClick={() => onPromptClick(prompt)}
                style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45,
                  background: 'var(--bg)', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
                {prompt}
              </div>
            ))}
          </div>
        </div>
      )}
      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }`}</style>
    </div>
  );
}

const SILENCE_TIMEOUT_MS = 10000;

function MicButton({ onTranscript, disabled }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const supported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const resetSilenceTimer = () => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      setListening(false);
    }, SILENCE_TIMEOUT_MS);
  };

  const stop = () => {
    clearSilenceTimer();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  };

  const toggle = () => {
    if (!supported) return;
    if (listening) { stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'en-AU';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      resetSilenceTimer();
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) transcript += e.results[i][0].transcript + ' ';
      }
      if (transcript.trim()) onTranscript(transcript.trim());
    };
    rec.onerror = () => { clearSilenceTimer(); setListening(false); recognitionRef.current = null; };
    rec.onend = () => { clearSilenceTimer(); setListening(false); recognitionRef.current = null; };
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
    resetSilenceTimer();
  };

  if (!supported) return null;

  return (
    <button
      onClick={toggle}
      disabled={disabled}
      title={listening ? 'Tap to stop recording' : 'Speak your prompt'}
      style={{
        background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '2px 4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: listening ? '#e53e3e' : 'var(--text-muted)',
        transition: 'color 0.15s',
        opacity: disabled ? 0.4 : 1,
        animation: listening ? 'micPulse 1s ease-in-out infinite' : 'none',
      }}
    >
      <svg width='16' height='16' viewBox='0 0 16 16' fill='currentColor'>
        <rect x='5' y='1' width='6' height='9' rx='3' />
        <path d='M2.5 7.5A5.5 5.5 0 0 0 8 13a5.5 5.5 0 0 0 5.5-5.5' stroke='currentColor' strokeWidth='1.5' fill='none' strokeLinecap='round'/>
        <line x1='8' y1='13' x2='8' y2='15' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'/>
        <line x1='5.5' y1='15' x2='10.5' y2='15' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'/>
      </svg>
    </button>
  );
}

export default function ChatPage({ session, activeSessionId, setActiveSessionId, activeProject, setActiveProject, setView, activeModule, onMenuOpen }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState('guided');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [formatControls, setFormatControls] = useState({ length: null, format: null, depth: null });
  const [formatOpen, setFormatOpen] = useState(!isMobile());
  const [autoCaptured, setAutoCaptured] = useState(null);
  const [statusSteps, setStatusSteps] = useState([]);
  const [statusVisible, setStatusVisible] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [sessionArchived, setSessionArchived] = useState(false);
  const [hoveredMode, setHoveredMode] = useState(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (mode !== 'inquisitive' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, [mode]);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      setSessionArchived(false);
      return;
    }
    supabase
      .from('messages')
      .select('*')
      .eq('session_id', activeSessionId)
      .order('created_at')
      .then(({ data }) => { if (data) setMessages(data); });

    supabase
      .from('sessions')
      .select('archived_at')
      .eq('id', activeSessionId)
      .single()
      .then(({ data }) => { setSessionArchived(!!data?.archived_at); });
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
      user_id: session.user.id,
      project_id: activeProject?.id || null,
      module_id: activeModule?.id || null,
      title: null,
    }).select().single();
    setActiveSessionId(data.id);
    return data.id;
  };

  const toggleFormat = (type, id) => {
    setFormatControls(prev => ({ ...prev, [type]: prev[type] === id ? null : id }));
  };

  const formatActiveCount = Object.values(formatControls).filter(Boolean).length;

  const handlePromptClick = (prompt) => {
    setInput(prompt);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) setAttachedFile(file);
    e.target.value = '';
  };

  const removeAttachment = () => setAttachedFile(null);

  const handleTranscript = (transcript) => {
    setInput(prev => prev ? prev + ' ' + transcript : transcript);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleArchiveSession = async () => {
    setSessionMenuOpen(false);
    if (!activeSessionId) return;
    try {
      await fetch(`${API}/api/sessions/${activeSessionId}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.user.id }),
      });
      setSessionArchived(true);
      setActiveSessionId(null);
    } catch (err) {
      console.error('Archive error:', err);
    }
  };

  const handleRestoreSession = async () => {
    setSessionMenuOpen(false);
    if (!activeSessionId) return;
    try {
      await fetch(`${API}/api/sessions/${activeSessionId}/restore`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.user.id }),
      });
      setSessionArchived(false);
    } catch (err) {
      console.error('Restore error:', err);
    }
  };

  const downloadSession = async () => {
    if (!activeSessionId || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(API + '/api/generate-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId, userId: session.user.id }),
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = response.headers.get('content-disposition');
      const filename = disposition?.match(/filename="(.+)"/)?.[1] || 'session.docx';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { console.error(err); }
    setDownloading(false);
  };

  const send = async () => {
    if (!input.trim() || streaming) return;
    const text = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    const sessionId = await ensureSession();
    const userMsg = { role: 'user', content: attachedFile ? `[Attached: ${attachedFile.name}] ${text}` : text };
    await supabase.from('messages').insert({ ...userMsg, session_id: sessionId });
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setAutoCaptured(null);
    setStatusSteps([]);
    setStatusVisible(true);
    let assistantText = '';
    let hasStartedText = false;

    const formatForThisSend = { ...formatControls };
    const fileToSend = attachedFile;
    setFormatControls({ length: null, format: null, depth: null });
    setAttachedFile(null);

    try {
      let response;
      const msgPayload = [...messages, { role: 'user', content: text }]
        .map(m => ({ role: m.role, content: m.content }));

      if (fileToSend) {
        const fd = new FormData();
        fd.append('userId', session.user.id);
        fd.append('sessionId', sessionId);
        fd.append('projectId', activeProject?.id || '');
        fd.append('moduleId', activeModule?.id || '');
        fd.append('messages', JSON.stringify(msgPayload));
        fd.append('mode', mode);
        fd.append('ruleOverrides', JSON.stringify({}));
        fd.append('formatControls', JSON.stringify(formatForThisSend));
        fd.append('file', fileToSend);
        response = await fetch(API + '/api/chat', { method: 'POST', body: fd });
      } else {
        response = await fetch(API + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: session.user.id,
            sessionId,
            projectId: activeProject?.id || null,
            moduleId: activeModule?.id || null,
            messages: msgPayload,
            mode,
            ruleOverrides: {},
            formatControls: formatForThisSend,
          }),
        });
      }

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
            const parsed = JSON.parse(data);
            if (parsed.status) {
              setStatusSteps(prev => [...prev, parsed.status]);
            } else if (parsed.attached) {
              // File confirmed received by backend
            } else if (parsed.autocaptured) {
              setAutoCaptured(parsed.autocaptured);
              setTimeout(() => setAutoCaptured(null), 4000);
            } else if (parsed.text) {
              if (!hasStartedText) {
                hasStartedText = true;
                setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
              }
              assistantText += parsed.text;
              setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: assistantText }]);
            }
          } catch {}
        }
      }

      // Speak response if voice enabled and in inquisitive mode
      if (voiceEnabled && mode === 'inquisitive' && assistantText) {
        speakText(assistantText);
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
    setTimeout(() => {
      setStatusVisible(false);
      setTimeout(() => setStatusSteps([]), 400);
    }, 2000);
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

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes micPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .mode-tooltip {
          position: absolute; top: calc(100% + 8px); left: 50%; transform: translateX(-50%);
          background: var(--text-primary); color: white; font-size: 11px; line-height: 1.4;
          padding: 6px 10px; border-radius: var(--radius); white-space: normal;
          width: 200px; text-align: center; pointer-events: none; z-index: 100;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          animation: fadeIn 0.15s ease;
        }
        .mode-tooltip::before {
          content: ''; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
          border: 5px solid transparent; border-bottom-color: var(--text-primary);
        }
      `}</style>

      <div className='topbar'>
        <button className='hamburger' onClick={onMenuOpen} aria-label='Open menu'>
          <svg width='20' height='20' viewBox='0 0 20 20' fill='none'>
            <rect x='2' y='4' width='16' height='2' rx='1' fill='currentColor'/>
            <rect x='2' y='9' width='16' height='2' rx='1' fill='currentColor'/>
            <rect x='2' y='14' width='16' height='2' rx='1' fill='currentColor'/>
          </svg>
        </button>

        {/* Mode toggle with tooltips */}
        <div className='mode-toggle' style={{ position: 'relative' }}>
          {['guided', 'direct', 'inquisitive'].map(m => (
            <div key={m} style={{ position: 'relative' }}>
              <button
                className={'mode-btn' + (mode === m ? ' active' : '')}
                onClick={() => setMode(m)}
                onMouseEnter={() => setHoveredMode(m)}
                onMouseLeave={() => setHoveredMode(null)}
                title={MODE_DESCRIPTIONS[m]}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
              {hoveredMode === m && (
                <div className='mode-tooltip'>{MODE_DESCRIPTIONS[m]}</div>
              )}
            </div>
          ))}
        </div>

        {/* Voice toggle -- only in inquisitive mode */}
        {mode === 'inquisitive' && (
          <button
            onClick={() => {
              if (window.speechSynthesis) window.speechSynthesis.cancel();
              setVoiceEnabled(v => !v);
            }}
            title={voiceEnabled ? 'Voice on -- click to turn off' : 'Voice off -- click to turn on'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, padding: '2px 4px',
              color: voiceEnabled ? 'var(--accent)' : 'var(--text-muted)',
              transition: 'color 0.15s',
            }}
          >
            {voiceEnabled ? '🔊' : '🔇'}
          </button>
        )}

        {activeModule && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{activeModule.name}</span>
          </div>
        )}
        {activeProject && (
          <div
            className='project-indicator'
            onClick={() => setView && setView('projects')}
            style={{ cursor: 'pointer' }}
            title='Back to project'
          >
            Project: <span>{activeProject.name}</span>
          </div>
        )}
        {autoCaptured && (
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)',
            background: 'rgba(0,145,164,0.08)', border: '1px solid var(--accent)',
            borderRadius: 'var(--radius)', padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            Note captured
          </div>
        )}
        {activeSessionId && messages.length > 0 && (
          <div style={{ marginLeft: autoCaptured ? 8 : 'auto', position: 'relative' }}>
            <button
              className='action-btn'
              style={{ fontSize: 18, padding: '2px 8px', letterSpacing: 2 }}
              onClick={() => setSessionMenuOpen(prev => !prev)}
              title='Session options'
            >
              ···
            </button>
            {sessionMenuOpen && (
              <div
                className='session-menu-dropdown'
                style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4 }}
                onMouseLeave={() => setSessionMenuOpen(false)}
              >
                {sessionArchived ? (
                  <button onClick={handleRestoreSession}>Restore session</button>
                ) : (
                  <button onClick={handleArchiveSession}>Archive session</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mode banner -- shows below topbar when not in guided mode */}
      {mode !== 'guided' && (
        <div style={{
          padding: '6px 20px', fontSize: 11, color: 'var(--text-muted)',
          background: mode === 'inquisitive' ? 'rgba(0,145,164,0.04)' : 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: mode === 'inquisitive' ? 'var(--accent)' : 'var(--text-muted)',
          }} />
          {MODE_DESCRIPTIONS[mode]}
        </div>
      )}

      <div className='chat-area'>
        {sessionArchived && (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '8px 14px', marginBottom: 16,
            fontSize: 13, color: 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>This session is archived and read-only.</span>
            <button className='action-btn' onClick={handleRestoreSession}>Restore</button>
          </div>
        )}
        {messages.length === 0 && !streaming && !sessionArchived && (
          <EmptyState
            activeProject={activeProject}
            activeModule={activeModule}
            onPromptClick={handlePromptClick}
            userId={session.user.id}
            mode={mode}
          />
        )}
        {messages.map((msg, i) => (
          <Message key={i} message={msg} session={session}
            sessionId={activeSessionId} onPin={() => console.log('Pinned')} />
        ))}
        <div ref={bottomRef} />
      </div>

      <StatusCallout steps={statusSteps} visible={statusVisible} />

      {!sessionArchived && (
        <div className='input-area'>
          <div className='input-area-inner'>
            <div className='input-box'>
              <div style={{ borderBottom: formatOpen ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '6px 14px 4px',
                  gap: 8, borderBottom: formatOpen ? '1px solid var(--border)' : 'none' }}>
                  <button onClick={() => setFormatOpen(o => !o)}
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
                {formatOpen && (
                  <div style={{ display: 'flex', gap: 12, padding: '6px 14px 8px',
                    flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 2 }}>Length</span>
                      {LENGTH_OPTIONS.map(o => (
                        <OptionPill key={o.id} active={formatControls.length === o.id}
                          onClick={() => toggleFormat('length', o.id)}>{o.label}</OptionPill>
                      ))}
                    </div>
                    <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 2 }}>Format</span>
                      {FORMAT_OPTIONS.map(o => (
                        <OptionPill key={o.id} active={formatControls.format === o.id}
                          onClick={() => toggleFormat('format', o.id)}>{o.label}</OptionPill>
                      ))}
                    </div>
                    <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 2 }}>Depth</span>
                      {DEPTH_OPTIONS.map(o => (
                        <OptionPill key={o.id} active={formatControls.depth === o.id}
                          onClick={() => toggleFormat('depth', o.id)}>{o.label}</OptionPill>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {attachedFile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
                  borderBottom: '1px solid var(--border)', background: 'rgba(0,145,164,0.04)' }}>
                  <span style={{ fontSize: 14 }}>📎</span>
                  <span style={{ fontSize: 12, color: 'var(--accent)', flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {attachedFile.name}
                  </span>
                  <button onClick={removeAttachment}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 16, color: 'var(--text-muted)', padding: '0 2px', lineHeight: 1 }}>
                    ×
                  </button>
                </div>
              )}

              <textarea
                ref={textareaRef}
                className='input-textarea'
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={mode === 'inquisitive' ? 'Tell AdvisoryHub what you are working on...' : 'Ask AdvisoryHub... (Shift+Enter for new line)'}
                rows={1}
              />
              <div className='input-footer'>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label title='Attach a document (PDF, DOCX, TXT)'
                    style={{ cursor: 'pointer', color: attachedFile ? 'var(--accent)' : 'var(--text-muted)',
                      fontSize: 16, display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}>
                    📎
                    <input ref={fileInputRef} type='file' style={{ display: 'none' }}
                      accept='.pdf,.docx,.txt,.md' onChange={handleFileChange} />
                  </label>
                  <MicButton onTranscript={handleTranscript} disabled={streaming} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {activeProject ? <><span className='context-enabled'></span>{activeProject.name}</> : 'No project active'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {messages.length > 0 && activeSessionId && (
                    <button onClick={downloadSession} disabled={downloading || streaming}
                      title='Download session as Word document'
                      style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none',
                        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                        padding: '5px 10px', cursor: 'pointer', transition: 'all 0.15s',
                        opacity: downloading ? 0.5 : 1 }}>
                      {downloading ? '...' : '↓ Doc'}
                    </button>
                  )}
                  <button className='send-btn' onClick={send} disabled={streaming}>
                    {streaming ? '...' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
