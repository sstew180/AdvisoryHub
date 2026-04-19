import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const API = import.meta.env.VITE_API_URL;

const WRITING_QUESTIONS = [
  { id: 'challenge', question: 'When you share an idea or draft, do you want the AI to challenge it or support it?', options: ['Challenge my thinking -- find the weaknesses', 'Support and develop my thinking', 'Depends on the situation -- do both'] },
  { id: 'length', question: 'How long should responses be by default?', options: ['Short and direct -- get to the point', 'Standard -- enough to be useful', 'Thorough -- cover the detail'] },
  { id: 'tone', question: 'What tone do you prefer?', options: ['Formal and professional', 'Plain and direct', 'Conversational'] },
  { id: 'assumptions', question: 'When the AI makes assumptions, should it flag them?', options: ['Yes -- always flag assumptions explicitly', 'Only flag them if they are significant', 'Just get on with it -- I will ask if I need to'] },
  { id: 'nextsteps', question: 'Should the AI suggest next steps at the end of a response?', options: ['Yes -- always suggest what to do next', 'Only if it is obvious and useful', 'No -- just answer the question'] },
  { id: 'structure', question: 'How do you prefer output to be structured?', options: ['Prose paragraphs -- no bullet points', 'Well-structured with headings and lists', 'Whatever fits the content'] },
];

const WORKING_QUESTIONS = [
  { id: 'pace', question: 'How do you work?', options: ['At pace -- I need quick answers I can act on', 'Methodically -- I want to think things through', 'It varies depending on the task'] },
  { id: 'context', question: 'How much context do you typically provide?', options: ['Minimal -- I expect the AI to fill in the gaps', 'Enough to get started -- I will add more if needed', 'Detailed -- I want the AI to have the full picture'] },
  { id: 'output', question: 'What do you primarily use AdvisoryHub for?', options: ['Drafting documents and communications', 'Getting advice and thinking through problems', 'Both in roughly equal measure'] },
  { id: 'iteration', question: 'How do you like to refine outputs?', options: ['Quick back and forth -- iterate fast', 'Get it close to right first time -- fewer rounds', 'Depends on the stakes of the document'] },
  { id: 'expertise', question: 'How would you describe your expertise in risk, audit, and insurance?', options: ['Specialist -- this is my core domain', 'Practitioner -- solid working knowledge', 'Generalist -- I work in related areas but am not a specialist'] },
];

function StyleWizard({ type, onComplete, onCancel }) {
  const questions = type === 'writing' ? WRITING_QUESTIONS : WORKING_QUESTIONS;
  const [answers, setAnswers] = useState({});
  const [generating, setGenerating] = useState(false);
  const title = type === 'writing' ? 'Build your writing style' : 'Build your working style';
  const desc = type === 'writing'
    ? 'Answer these questions and AdvisoryHub will generate a communication style profile for you.'
    : 'Answer these questions and AdvisoryHub will generate a working style profile for you.';

  const allAnswered = questions.every(q => answers[q.id]);

  return (
    <div style={{
      border: '1px solid var(--accent)', borderRadius: 'var(--radius)',
      padding: 20, marginBottom: 16, background: 'rgba(0,145,164,0.03)',
    }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>{desc}</div>

      {questions.map((q, qi) => (
        <div key={q.id} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }}>
            {qi + 1}. {q.question}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {q.options.map(opt => (
              <label key={opt} style={{
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                padding: '8px 12px', borderRadius: 'var(--radius)',
                border: '1px solid ' + (answers[q.id] === opt ? 'var(--accent)' : 'var(--border)'),
                background: answers[q.id] === opt ? 'rgba(0,145,164,0.06)' : 'var(--bg)',
                transition: 'all 0.15s',
              }}>
                <input
                  type='radio'
                  name={q.id}
                  value={opt}
                  checked={answers[q.id] === opt}
                  onChange={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                  style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: answers[q.id] === opt ? 'var(--accent)' : 'var(--text-secondary)' }}>
                  {opt}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button
          className='btn btn-primary'
          disabled={!allAnswered || generating}
        onClick={async () => { setGenerating(true); await onComplete(questions.map(q => ({ question: q.question, answer: answers[q.id] }))); setGenerating(false); }}
        >
          {generating ? 'Generating...' : 'Generate my profile'}
        </button>
        <button className='btn btn-secondary' onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function ProfilePage({ session, onMenuOpen, setView, activeModule }) {
  const [profile, setProfile] = useState({
    first_name: '', last_name: '', organisation: 'City of Gold Coast',
  });
  const [persona, setPersona] = useState({
    role: '', service_area: '', goals: '', preferences: '', working_style: '', high_scrutiny: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showWritingWizard, setShowWritingWizard] = useState(false);
  const [showWorkingWizard, setShowWorkingWizard] = useState(false);


  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (data) setProfile({
          first_name: data.first_name || '',
          last_name: data.last_name || '',
          organisation: data.organisation || 'City of Gold Coast',
        });
      });
  }, [session]);

  useEffect(() => {
    if (!activeModule) return;
    fetch(`${API}/api/modules/${activeModule.id}/persona?userId=${session.user.id}`)
      .then(r => r.json())
      .then(data => {
        if (data) setPersona({
          role: data.role || '',
          service_area: data.service_area || '',
          goals: data.goals || '',
          preferences: data.preferences || '',
          working_style: data.working_style || '',
          high_scrutiny: data.high_scrutiny || false,
        });
      })
      .catch(() => {});
  }, [activeModule, session]);

  const save = async () => {
    setSaving(true);
    await supabase.from('profiles').upsert({
      id: session.user.id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      organisation: profile.organisation,
    });
    if (activeModule) {
      await fetch(`${API}/api/modules/${activeModule.id}/persona`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.user.id, ...persona }),
      });
    }
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleWritingWizard = async (answers) => {
    try {
      const res = await fetch(`${API}/api/generate-style`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'writing', answers }),
      });
      const data = await res.json();
      if (data.result) {
        setPersona(p => ({ ...p, preferences: data.result }));
        setShowWritingWizard(false);
      }
    } catch (err) {
      console.error('Writing wizard error:', err);
    }
  };

  const handleWorkingWizard = async (answers) => {
    try {
      const res = await fetch(`${API}/api/generate-style`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'working', answers }),
      });
      const data = await res.json();
      if (data.result) {
        setPersona(p => ({ ...p, working_style: data.result }));
        setShowWorkingWizard(false);
      }
    } catch (err) {
      console.error('Working wizard error:', err);
    }
  };

  const up = (field, value) => setProfile(p => ({ ...p, [field]: value }));
  const ua = (field, value) => setPersona(p => ({ ...p, [field]: value }));

  return (
    <div className='page'>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button className='hamburger' onClick={onMenuOpen} aria-label='Open menu'>
          <svg width='20' height='20' viewBox='0 0 20 20' fill='none'>
            <rect x='2' y='4' width='16' height='2' rx='1' fill='currentColor'/>
            <rect x='2' y='9' width='16' height='2' rx='1' fill='currentColor'/>
            <rect x='2' y='14' width='16' height='2' rx='1' fill='currentColor'/>
          </svg>
        </button>
        <button className='mobile-back' onClick={() => setView('chat')}>‹ Chat</button>
        <div className='page-title' style={{ margin: 0 }}>Profile</div>
        {activeModule && (
          <span style={{ fontSize: 11, color: 'var(--accent)', background: 'rgba(0,145,164,0.08)',
            padding: '2px 8px', borderRadius: 10, fontWeight: 500 }}>
            {activeModule.name}
          </span>
        )}
      </div>

      <div className='page-content'>

        {/* Account section */}
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12 }}>
          Account
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div className='form-group' style={{ margin: 0 }}>
            <label className='form-label'>First Name</label>
            <input className='form-input' value={profile.first_name}
              onChange={e => up('first_name', e.target.value)} placeholder='e.g. Scott' />
          </div>
          <div className='form-group' style={{ margin: 0 }}>
            <label className='form-label'>Last Name</label>
            <input className='form-input' value={profile.last_name}
              onChange={e => up('last_name', e.target.value)} placeholder='e.g. Stewart' />
          </div>
        </div>
        <div className='form-group'>
          <label className='form-label'>Organisation</label>
          <input className='form-input' value={profile.organisation}
            onChange={e => up('organisation', e.target.value)} />
        </div>

        <div style={{ borderTop: '1px solid var(--border)', margin: '24px 0 20px' }} />

        {/* Persona section */}
        {activeModule ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12 }}>
              {activeModule.name} persona
            </div>
            <div className='form-group'>
              <label className='form-label'>Role</label>
              <input className='form-input' value={persona.role}
                onChange={e => ua('role', e.target.value)}
                placeholder='e.g. Manager Risk and Insurance' />
            </div>
            <div className='form-group'>
              <label className='form-label'>Service Area</label>
              <input className='form-input' value={persona.service_area}
                onChange={e => ua('service_area', e.target.value)}
                placeholder='e.g. Corporate Governance' />
            </div>
            <div className='form-group'>
              <label className='form-label'>Current Objectives</label>
              <textarea className='form-textarea' value={persona.goals}
                onChange={e => ua('goals', e.target.value)}
                placeholder='What are you currently working on in this domain?' />
            </div>

            {/* Writing Style */}
            <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0 16px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label className='form-label' style={{ margin: 0 }}>Communication Style</label>
              {!showWritingWizard && (
                <button
                  onClick={() => setShowWritingWizard(true)}
                  style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none',
                    cursor: 'pointer', padding: 0, fontWeight: 500 }}>
                  {persona.preferences ? 'Rebuild ↻' : 'Build with wizard →'}
                </button>
              )}
            </div>
            {showWritingWizard ? (
              <StyleWizard
                key='writing-wizard'
                type='writing'
                onComplete={handleWritingWizard}
                onCancel={() => setShowWritingWizard(false)}
              />
            ) : (
              <div className='form-group'>
                <textarea className='form-textarea' value={persona.preferences}
                  onChange={e => ua('preferences', e.target.value)}
                  placeholder='Describe how you want AdvisoryHub to write for you. Or use the wizard above to generate this automatically.' />
                {!persona.preferences && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    e.g. "You prefer direct responses. Lead with the recommendation. No bullet points by default. Flag assumptions explicitly."
                  </div>
                )}
              </div>
            )}

            {/* Working Style */}
            <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0 16px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label className='form-label' style={{ margin: 0 }}>Working Style</label>
              {!showWorkingWizard && (
                <button
                  onClick={() => setShowWorkingWizard(true)}
                  style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none',
                    cursor: 'pointer', padding: 0, fontWeight: 500 }}>
                  {persona.working_style ? 'Rebuild ↻' : 'Build with wizard →'}
                </button>
              )}
            </div>
            {showWorkingWizard ? (
              <StyleWizard
                key='working-wizard'
                type='working'
                onComplete={handleWorkingWizard}
                onCancel={() => setShowWorkingWizard(false)}
              />
            ) : (
              <div className='form-group'>
                <textarea className='form-textarea' value={persona.working_style}
                  onChange={e => ua('working_style', e.target.value)}
                  placeholder='Describe how you work. Or use the wizard above to generate this automatically.' />
                {!persona.working_style && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    e.g. "You work at pace and need answers you can act on immediately. You are a specialist in risk management."
                  </div>
                )}
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0 16px' }} />
            <div className='form-group' style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type='checkbox' id='scrutiny' checked={persona.high_scrutiny}
                onChange={e => ua('high_scrutiny', e.target.checked)} />
              <label htmlFor='scrutiny' style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                High scrutiny mode (AI flags assumptions and recommends verification)
              </label>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>
            No active module -- select a domain from the module selector to configure your persona.
          </div>
        )}

        <button className='btn btn-primary' onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  );
}
