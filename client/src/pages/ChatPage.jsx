import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import Message from '../components/Message';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;

const RULE_LABELS = {
  no_abstract_concepts: 'No abstract concepts',
  movement_verbs_evidence: 'Movement verbs need evidence',
  traceable_claims: 'Traceable claims',
  show_sequence: 'Show sequence',
  no_rhetorical_contrasts: 'No rhetorical contrasts',
  no_three_part_lists: 'No three-part lists',
  metric_per_paragraph: 'One metric per paragraph',
  no_em_dashes: 'No em dashes',
  no_slogans: 'No slogan endings',
  no_buzzwords: 'No buzzwords',
  plain_english: 'Plain English',
  active_voice: 'Active voice',
  short_sentences: 'Short sentences',
  no_nominalisation: 'No nominalisation',
  no_hedging: 'No hedging',
  adversarial_review: 'Adversarial review',
  expose_assumptions: 'Expose assumptions',
  no_flattery: 'No flattery',
  prove_it: 'Prove it',
  model_failure_modes: 'Model failure modes',
  no_motive_speculation: 'No motive speculation',
  cite_qao: 'Cite QAO',
  flag_legal_boundary: 'Flag legal boundary',
  multi_role_check: 'Multi-role check',
  lead_with_answer: 'Lead with answer',
  no_bullets_default: 'No bullets',
  end_operational: 'End operational',
  no_preamble: 'No preamble',
  no_summary_ending: 'No summary ending',
  confirm_artefact: 'Confirm artefact',
};

const LENGTH_OPTIONS = [
  { id: 'brief', label: 'Brief', instruction: 'Keep the response to 2-3 short paragraphs maximum.' },
  { id: 'standard', label: 'Standard', instruction: 'Keep the response to roughly one page -- 4-6 paragraphs.' },
  { id: 'detailed', label: 'Detailed', instruction: 'Provide a full, detailed response with as much depth as needed.' },
];

const FORMAT_OPTIONS = [
  { id: 'prose', label: 'Prose', instruction: 'Write in flowing prose paragraphs. No bullet points or numbered lists.' },
  { id: 'structured', label: 'Structured', instruction: 'Use clear headings and structured sections to organise the response.' },
  { id: 'bullets', label: 'Bullets', instruction: 'Use bullet points or numbered lists as the primary format.' },
  { id: 'table', label: 'Table', instruction: 'Present the information as a table where possible.' },
];

const DEPTH_OPTIONS = [
  { id: 'summary', label: 'Summary', instruction: 'Provide a high-level summary only. Do not go into detail.' },
  { id: 'analysis', label: 'Analysis', instruction: 'Provide analysis with reasoning, not just facts.' },
  { id: 'full', label: 'Full + recommendations', instruction: 'Provide full analysis with specific recommendations and next steps.' },
  { id: 'critical', label: 'Critical review', instruction: 'Provide full analysis plus an adversarial critique -- identify assumptions, gaps, and risks.' },
];

export default function ChatPage({ session, activeSessionId, setActiveSessionId, activeProject, onMenuOpen }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState('guided');
  const [activeRules, setActiveRules] = useState([]);
  const [ruleOverrides, setRuleOverrides] = useState({});
  const [rulesOpen, setRulesOpen] = useState(false);
  const [formatControls, setFormatControls] = useState({ length: null, format: null, depth: null });
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const rulesPanelRef = useRef(null);

  useEffect(() => {
    supabase.from('profiles').select('prompt_rules').eq('id', session.user.id).single()
      .then(({ data }) => { if (data) setActiveRules(data.prompt_rules || []); });
  }, [session]);

  useEffect(() => {
    const handler = (e) => {
      if (rulesOpen && rulesPanelRef.current && !rulesPanelRef.current.contains(e.target)) {
        setRulesOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [rulesOpen]);

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

  const getEffectiveRules = () => {
    let effective = new Set(activeRules);
    for (const [id, state] of Object.entries(ruleOverrides)) {
      if (state === 'on') effective.add(id);
      else if (state === 'off') effective.delete(id);
    }
    return [...effective];
  };

  const toggleOverride = (id) => {
    const isActive = getEffectiveRules().includes(id);
    setRuleOverrides(prev => {
      const next = { ...prev };
      const profileHas = activeRules.includes(id);
      if (profileHas) {
        next[id] = isActive ? 'off' : 'on';
        if (next[id] === 'on') delete next[id];
      } else {
        if (next[id] === 'on') delete next[id];
        else next[id] = 'on';
      }
      return next;
    });
  };

  const toggleFormat = (type, id) => {
    setFormatControls(prev => ({ ...prev, [type]: prev[type] === id ? null : id }));
  };

  const formatActiveCount = Object.values(formatControls).filter(Boolean).length;
  const overrideCount = Object.keys(ruleOverrides).length;
  const effectiveRules = getEffectiveRules();

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

    const overridesForThisSend = { ...ruleOverrides };
    const formatForThisSend = { ...formatControls };
    setRuleOverrides({});
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
          ruleOverrides: overridesForThisSend,
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

        <div style={{ position: 'relative' }} ref={rulesPanelRef}>
          <button onClick={() => setRulesOpen(o => !o)}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 'var(--radius)',
              border: '1px solid ' + (overrideCount > 0 ? 'var(--accent)' : 'var(--border)'),
              background: overrideCount > 0 ? 'rgba(0,145,164,0.06)' : 'transparent',
              color: overrideCount > 0 ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            Rules
            {overrideCount > 0 && (
              <span style={{ fontSize: 10, background: 'var(--accent)', color: 'white',
                padding: '0 5px', borderRadius: 8, fontWeight: 600 }}>
                {overrideCount}
              </span>
            )}
          </button>

          {rulesOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 100,
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)', padding: 12, width: 280 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Rules for next response
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                Overrides reset after each send. Profile and project rules apply by default.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                {Object.entries(RULE_LABELS).map(([id, label]) => {
                  const isEffective = effectiveRules.includes(id);
                  const isOverridden = ruleOverrides[id] !== undefined;
                  return (
                    <button key={id} onClick={() => toggleOverride(id)}
                      style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, cursor: 'pointer',
                        border: '1px solid ' + (isEffective ? 'var(--accent)' : 'var(--border)'),
                        background: isEffective ? 'rgba(0,145,164,0.08)' : 'transparent',
                        color: isEffective ? 'var(--accent)' : 'var(--text-muted)',
                        fontWeight: isOverridden ? 600 : 400,
                        textDecoration: isOverridden && !isEffective ? 'line-through' : 'none',
                        transition: 'all 0.15s' }}>
                      {label}
                    </button>
                  );
                })}
              </div>
              {overrideCount > 0 && (
                <button onClick={() => setRuleOverrides({})}
                  style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', background: 'none',
                    border: 'none', cursor: 'pointer', padding: 0 }}>
                  Clear overrides
                </button>
              )}
            </div>
          )}
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

            {/* Format controls toolbar */}
            <div style={{ display: 'flex', gap: 12, padding: '8px 14px 6px',
              borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>

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

              {formatActiveCount > 0 && (
                <button onClick={() => setFormatControls({ length: null, format: null, depth: null })}
                  style={{ fontSize: 10, color: 'var(--text-muted)', background: 'none',
                    border: 'none', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}>
                  Clear
                </button>
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