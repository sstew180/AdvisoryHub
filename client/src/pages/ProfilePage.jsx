import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const RULES = [
  {
    category: 'Grounding',
    rules: [
      { id: 'no_abstract_concepts', label: 'No abstract concepts without evidence', desc: 'Anchor every concept to a specific data point, document, or recorded example.' },
      { id: 'movement_verbs_evidence', label: 'Movement verbs require evidence', desc: 'Words like "shifted", "evolved", "accelerated" must cite what specifically changed.' },
      { id: 'traceable_claims', label: 'Every claim must be traceable', desc: 'Major claims must link to a document, metric, or meeting. Otherwise label as commentary.' },
      { id: 'show_sequence', label: 'Show sequence not summary', desc: 'Do not compress cause and effect. Show steps in order.' },
    ]
  },
  {
    category: 'Tone and Style',
    rules: [
      { id: 'no_em_dashes', label: 'No em dashes', desc: 'Use commas, colons, or restructure the sentence instead.' },
      { id: 'no_slogans', label: 'No slogan endings', desc: 'End paragraphs with operational detail, not motivational or summary language.' },
      { id: 'no_buzzwords', label: 'No buzzwords', desc: 'Ban: leverage, optimise, unlock, transformative, holistic, ecosystem, synergy, embed, accelerate.' },
      { id: 'plain_english', label: 'Plain English', desc: 'Avoid jargon unless it is the precise correct term.' },
      { id: 'active_voice', label: 'Active voice', desc: 'Avoid passive constructions where the actor is unclear.' },
      { id: 'short_sentences', label: 'Short sentences', desc: 'Keep sentences under 20 words where possible.' },
    ]
  },
  {
    category: 'Analytical Rigour',
    rules: [
      { id: 'adversarial_review', label: 'Adversarial review', desc: 'Internally critique for unrealistic assumptions and unsupported claims. Surface these.' },
      { id: 'expose_assumptions', label: 'Expose assumptions', desc: 'List assumptions embedded in any plan and note what happens if each proves false.' },
      { id: 'no_flattery', label: 'No flattery', desc: 'No "great question", "absolutely right", or similar. Maintain analytical neutrality.' },
      { id: 'prove_it', label: 'Prove-it requirement', desc: 'No unsupported major claims. Label absent evidence explicitly.' },
      { id: 'model_failure_modes', label: 'Model failure modes', desc: 'For every recommendation include at least one way it could fail and the earliest warning signal.' },
      { id: 'no_motive_speculation', label: 'No motive speculation', desc: 'Describe decisions and actions only. Do not speculate about what people were thinking.' },
    ]
  },
  {
    category: 'Output Format',
    rules: [
      { id: 'lead_with_answer', label: 'Lead with the answer', desc: 'State recommendation or conclusion first. Do not bury it after background.' },
      { id: 'no_bullets_default', label: 'No bullet points by default', desc: 'Use prose paragraphs unless the user explicitly asks for a list.' },
      { id: 'end_operational', label: 'End with operational detail', desc: 'End sections with a concrete next step or detail, not a rhetorical closure.' },
    ]
  },
];

const PRESETS = {
  none: [],
  base: ['no_em_dashes', 'no_slogans', 'no_buzzwords', 'plain_english', 'lead_with_answer'],
  strict: ['no_abstract_concepts', 'movement_verbs_evidence', 'traceable_claims', 'no_em_dashes', 'no_slogans', 'no_buzzwords', 'plain_english', 'active_voice', 'adversarial_review', 'expose_assumptions', 'no_flattery', 'prove_it', 'lead_with_answer', 'end_operational'],
};

export default function ProfilePage({ session, onMenuOpen }) {
  const [profile, setProfile] = useState({
    role: '', service_area: '', goals: '', organisation: 'City of Gold Coast',
    preferences: '', artefact_preference: 'briefing note', high_scrutiny: false,
    prompt_rules: []
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => { if (data) setProfile(p => ({ ...p, ...data, prompt_rules: data.prompt_rules || [] })); });
  }, [session]);

  const save = async () => {
    setSaving(true);
    await supabase.from('profiles').upsert({ id: session.user.id, ...profile });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const u = (field, value) => setProfile(p => ({ ...p, [field]: value }));

  const toggleRule = (id) => {
    setProfile(p => ({
      ...p,
      prompt_rules: p.prompt_rules.includes(id)
        ? p.prompt_rules.filter(r => r !== id)
        : [...p.prompt_rules, id]
    }));
  };

  const applyPreset = (preset) => {
    setProfile(p => ({ ...p, prompt_rules: [...PRESETS[preset]] }));
  };

  const activeCount = profile.prompt_rules?.length || 0;

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
        <div className='page-title' style={{ margin: 0 }}>Profile</div>
      </div>
      <div className='page-content'>
        <div className='form-group'>
          <label className='form-label'>Role</label>
          <input className='form-input' value={profile.role}
            onChange={e => u('role', e.target.value)} placeholder='e.g. Manager Risk and Insurance' />
        </div>
        <div className='form-group'>
          <label className='form-label'>Service Area</label>
          <input className='form-input' value={profile.service_area}
            onChange={e => u('service_area', e.target.value)} placeholder='e.g. Corporate Governance' />
        </div>
        <div className='form-group'>
          <label className='form-label'>Current Objectives</label>
          <textarea className='form-textarea' value={profile.goals}
            onChange={e => u('goals', e.target.value)}
            placeholder='What are you currently working on?' />
        </div>
        <div className='form-group'>
          <label className='form-label'>Communication Style and Writing Preferences</label>
          <textarea className='form-textarea' value={profile.preferences}
            onChange={e => u('preferences', e.target.value)}
            placeholder='e.g. Plain English, no jargon, active voice, concise.' />
        </div>
        <div className='form-group'>
          <label className='form-label'>Default Output Format</label>
          <select className='form-select' value={profile.artefact_preference}
            onChange={e => u('artefact_preference', e.target.value)}>
            <option value='briefing note'>Briefing Note</option>
            <option value='risk assessment'>Risk Assessment</option>
            <option value='audit finding'>Audit Finding</option>
            <option value='options paper'>Options Paper</option>
            <option value='memo'>Memo</option>
          </select>
        </div>
        <div className='form-group' style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type='checkbox' id='scrutiny' checked={profile.high_scrutiny}
            onChange={e => u('high_scrutiny', e.target.checked)} />
          <label htmlFor='scrutiny' style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            High scrutiny mode (AI flags assumptions and recommends verification)
          </label>
        </div>

        {/* Writing Rules section */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, marginTop: 8, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                Writing Rules
                {activeCount > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 11, background: 'var(--accent)', color: 'white',
                    padding: '1px 7px', borderRadius: 10, fontWeight: 500 }}>
                    {activeCount} active
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Rules are injected into every guided mode response to shape tone, style, and rigour.
              </div>
            </div>
            <button className='btn btn-secondary' style={{ fontSize: 12 }}
              onClick={() => setRulesOpen(o => !o)}>
              {rulesOpen ? 'Hide' : 'Edit rules'}
            </button>
          </div>

          {rulesOpen && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Presets:</span>
                <button className='btn btn-secondary' style={{ fontSize: 11 }} onClick={() => applyPreset('none')}>None</button>
                <button className='btn btn-secondary' style={{ fontSize: 11 }} onClick={() => applyPreset('base')}>Base</button>
                <button className='btn btn-secondary' style={{ fontSize: 11 }} onClick={() => applyPreset('strict')}>Strict</button>
              </div>
              {RULES.map(cat => (
                <div key={cat.category} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: 'var(--text-muted)', marginBottom: 8 }}>
                    {cat.category}
                  </div>
                  {cat.rules.map(rule => (
                    <div key={rule.id}
                      onClick={() => toggleRule(rule.id)}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px',
                        borderRadius: 'var(--radius)', cursor: 'pointer', marginBottom: 4,
                        background: profile.prompt_rules?.includes(rule.id) ? 'var(--teal-glow, rgba(0,145,164,0.06))' : 'transparent',
                        border: '1px solid ' + (profile.prompt_rules?.includes(rule.id) ? 'var(--accent)' : 'transparent'),
                        transition: 'all 0.15s' }}>
                      <input type='checkbox' readOnly
                        checked={profile.prompt_rules?.includes(rule.id) || false}
                        style={{ marginTop: 2, accentColor: 'var(--accent)', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>
                          {rule.label}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rule.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <button className='btn btn-primary' onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
        </button>
      </div>
    </div>
  );
}