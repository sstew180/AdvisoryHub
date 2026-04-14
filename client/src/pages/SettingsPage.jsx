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
      { id: 'no_rhetorical_contrasts', label: 'No rhetorical contrasts', desc: '"Not X but Y" constructions sound polished but substitute structure for substance. Ban them.' },
      { id: 'no_three_part_lists', label: 'No three-part rhetorical lists', desc: 'Lists like "clarity, consistency, and commitment" must each be tied to a measurable action.' },
      { id: 'metric_per_paragraph', label: 'One metric per paragraph', desc: 'Analytical responses must include at least one specific figure or documented fact per paragraph.' },
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
      { id: 'no_nominalisation', label: 'No nominalisation', desc: 'Write "we assessed" not "an assessment was conducted". Use verbs not noun forms.' },
      { id: 'no_hedging', label: 'No excessive hedging', desc: 'Avoid "it could be argued", "one might suggest". State positions directly or flag uncertainty explicitly.' },
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
      { id: 'cite_qao', label: 'Cite QAO guidance', desc: 'When recommending risk, audit, or governance approaches, cite the relevant QAO Better Practice Guide.' },
      { id: 'flag_legal_boundary', label: 'Flag legal and specialist boundaries', desc: 'If advice touches on legal, insurance, or specialist matters, flag this explicitly.' },
      { id: 'multi_role_check', label: 'Multi-role perspective check', desc: 'For high-stakes recommendations, consider at least two stakeholder perspectives (e.g. CFO and external auditor).' },
    ]
  },
  {
    category: 'Output Format',
    rules: [
      { id: 'lead_with_answer', label: 'Lead with the answer', desc: 'State recommendation or conclusion first. Do not bury it after background.' },
      { id: 'no_bullets_default', label: 'No bullet points by default', desc: 'Use prose paragraphs unless the user explicitly asks for a list.' },
      { id: 'end_operational', label: 'End with operational detail', desc: 'End sections with a concrete next step or detail, not a rhetorical closure.' },
      { id: 'no_preamble', label: 'No preamble', desc: 'Do not restate the question or explain what you are about to do. Start with the substance.' },
      { id: 'no_summary_ending', label: 'No summary endings', desc: 'Do not end with a paragraph that repeats what was just said. End with a next step or action.' },
      { id: 'confirm_artefact', label: 'Confirm document type before producing', desc: 'When producing a structured document, confirm the type and audience in one sentence first.' },
    ]
  },
];

const PRESETS = {
  none: [],
  base: ['no_em_dashes', 'no_slogans', 'no_buzzwords', 'plain_english', 'lead_with_answer', 'no_bullets_default', 'no_preamble'],
  strict: ['no_abstract_concepts', 'movement_verbs_evidence', 'traceable_claims', 'no_em_dashes', 'no_slogans', 'no_buzzwords', 'plain_english', 'active_voice', 'adversarial_review', 'expose_assumptions', 'no_flattery', 'prove_it', 'lead_with_answer', 'end_operational', 'no_preamble', 'no_summary_ending'],
  qld_gov: ['no_em_dashes', 'no_slogans', 'no_buzzwords', 'plain_english', 'lead_with_answer', 'no_bullets_default', 'traceable_claims', 'prove_it', 'no_flattery', 'cite_qao', 'flag_legal_boundary', 'no_preamble'],
  advisory: ['no_em_dashes', 'no_buzzwords', 'plain_english', 'active_voice', 'lead_with_answer', 'no_preamble', 'no_summary_ending', 'no_flattery', 'prove_it', 'flag_legal_boundary', 'no_rhetorical_contrasts', 'no_hedging'],
};

export default function SettingsPage({ session, onMenuOpen }) {
  const [rules, setRules] = useState([]);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [openCategories, setOpenCategories] = useState({});

  useEffect(() => {
    supabase.from('profiles').select('prompt_rules').eq('id', session.user.id).single()
      .then(({ data }) => { if (data) setRules(data.prompt_rules || []); });
    setEmail(session.user.email || '');
  }, [session]);

  const save = async () => {
    setSaving(true);
    await supabase.from('profiles').update({ prompt_rules: rules }).eq('id', session.user.id);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleRule = (id) => {
    setRules(r => r.includes(id) ? r.filter(x => x !== id) : [...r, id]);
  };

  const applyPreset = (preset) => {
    setRules([...PRESETS[preset]]);
    // Open any categories that have newly active rules
    const newRules = PRESETS[preset];
    const toOpen = {};
    RULES.forEach(cat => {
      if (cat.rules.some(r => newRules.includes(r.id))) toOpen[cat.category] = true;
    });
    setOpenCategories(toOpen);
  };

  const toggleCategory = (category) => {
    setOpenCategories(o => ({ ...o, [category]: !o[category] }));
  };

  const activeCount = rules.length;

  const categoryActiveCount = (cat) => cat.rules.filter(r => rules.includes(r.id)).length;

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
        <div className='page-title' style={{ margin: 0 }}>Settings</div>
      </div>

      <div className='page-content'>

        {/* Account section */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Account</div>
          <div className='form-group'>
            <label className='form-label'>Email</label>
            <input className='form-input' value={email} disabled
              style={{ background: 'var(--surface)', color: 'var(--text-muted)' }} />
          </div>
          <button className='btn btn-secondary' style={{ fontSize: 12 }}
            onClick={() => supabase.auth.resetPasswordForEmail(email)}>
            Send password reset email
          </button>
        </div>

        {/* Writing Rules section */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginBottom: 32 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
            Writing Rules
            {activeCount > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, background: 'var(--accent)', color: 'white',
                padding: '1px 7px', borderRadius: 10, fontWeight: 500 }}>
                {activeCount} active
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
            Applied to every Guided mode response. Project rules can extend or override these.
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Presets:</span>
            <button className='btn btn-secondary' style={{ fontSize: 11 }} onClick={() => applyPreset('none')}>None</button>
            <button className='btn btn-secondary' style={{ fontSize: 11 }} onClick={() => applyPreset('base')}>Base</button>
            <button className='btn btn-secondary' style={{ fontSize: 11 }} onClick={() => applyPreset('strict')}>Strict</button>
            <button className='btn btn-secondary' style={{ fontSize: 11 }} onClick={() => applyPreset('qld_gov')}>Qld Gov</button>
            <button className='btn btn-secondary' style={{ fontSize: 11 }} onClick={() => applyPreset('advisory')}>Advisory</button>
          </div>

          {RULES.map(cat => {
            const isOpen = !!openCategories[cat.category];
            const catActive = categoryActiveCount(cat);
            return (
              <div key={cat.category} style={{ marginBottom: 4, border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                <div
                  onClick={() => toggleCategory(cat.category)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', cursor: 'pointer', background: isOpen ? 'var(--surface)' : 'var(--bg)',
                    transition: 'background 0.15s', userSelect: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
                      {cat.category}
                    </span>
                    {catActive > 0 && (
                      <span style={{ fontSize: 10, background: 'var(--accent)', color: 'white',
                        padding: '1px 6px', borderRadius: 10, fontWeight: 500 }}>
                        {catActive} active
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', transition: 'transform 0.2s',
                    display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                    ▼
                  </span>
                </div>
                {isOpen && (
                  <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)' }}>
                    {cat.rules.map(rule => (
                      <div key={rule.id}
                        onClick={() => toggleRule(rule.id)}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px',
                          borderRadius: 'var(--radius)', cursor: 'pointer', marginBottom: 4,
                          background: rules.includes(rule.id) ? 'rgba(0,145,164,0.06)' : 'transparent',
                          border: '1px solid ' + (rules.includes(rule.id) ? 'var(--accent)' : 'transparent'),
                          transition: 'all 0.15s' }}>
                        <input type='checkbox' readOnly checked={rules.includes(rule.id)}
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
                )}
              </div>
            );
          })}
        </div>

        {/* Data section */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginBottom: 32 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Data</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Export all your sessions, messages, and memories as a CSV file.
          </div>
          <button className='btn btn-secondary' style={{ fontSize: 12 }} disabled>
            Export data (coming soon)
          </button>
        </div>

        <button className='btn btn-primary' onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}