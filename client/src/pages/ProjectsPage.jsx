import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;
const blank = { name: '', description: '', objectives: '', custom_instructions: '', high_scrutiny: false, profile_override: false, parent_id: null, prompt_rules: [] };

const RULES = [
  {
    category: 'Grounding',
    rules: [
      { id: 'no_abstract_concepts', label: 'No abstract concepts without evidence' },
      { id: 'movement_verbs_evidence', label: 'Movement verbs require evidence' },
      { id: 'traceable_claims', label: 'Every claim must be traceable' },
      { id: 'show_sequence', label: 'Show sequence not summary' },
      { id: 'no_rhetorical_contrasts', label: 'No rhetorical contrasts' },
      { id: 'no_three_part_lists', label: 'No three-part rhetorical lists' },
      { id: 'metric_per_paragraph', label: 'One metric per paragraph' },
    ]
  },
  {
    category: 'Tone and Style',
    rules: [
      { id: 'no_em_dashes', label: 'No em dashes' },
      { id: 'no_slogans', label: 'No slogan endings' },
      { id: 'no_buzzwords', label: 'No buzzwords' },
      { id: 'plain_english', label: 'Plain English' },
      { id: 'active_voice', label: 'Active voice' },
      { id: 'short_sentences', label: 'Short sentences' },
      { id: 'no_nominalisation', label: 'No nominalisation' },
      { id: 'no_hedging', label: 'No excessive hedging' },
    ]
  },
  {
    category: 'Analytical Rigour',
    rules: [
      { id: 'adversarial_review', label: 'Adversarial review' },
      { id: 'expose_assumptions', label: 'Expose assumptions' },
      { id: 'no_flattery', label: 'No flattery' },
      { id: 'prove_it', label: 'Prove-it requirement' },
      { id: 'model_failure_modes', label: 'Model failure modes' },
      { id: 'no_motive_speculation', label: 'No motive speculation' },
      { id: 'cite_qao', label: 'Cite QAO guidance' },
      { id: 'flag_legal_boundary', label: 'Flag legal and specialist boundaries' },
      { id: 'multi_role_check', label: 'Multi-role perspective check' },
    ]
  },
  {
    category: 'Output Format',
    rules: [
      { id: 'lead_with_answer', label: 'Lead with the answer' },
      { id: 'no_bullets_default', label: 'No bullet points by default' },
      { id: 'end_operational', label: 'End with operational detail' },
      { id: 'no_preamble', label: 'No preamble' },
      { id: 'no_summary_ending', label: 'No summary endings' },
      { id: 'confirm_artefact', label: 'Confirm document type before producing' },
    ]
  },
];

function ProjectRulesTab({ editing, setEditing }) {
  const [openCategories, setOpenCategories] = useState({});
  const projectRules = editing.prompt_rules || [];

  const toggleCategory = (cat) => setOpenCategories(o => ({ ...o, [cat]: !o[cat] }));

  const getState = (id) => {
    if (projectRules.includes(id + ':on')) return 'on';
    if (projectRules.includes(id + ':off')) return 'off';
    return 'inherit';
  };

  const cycleRule = (id) => {
    const current = getState(id);
    const filtered = projectRules.filter(r => !r.startsWith(id + ':'));
    if (current === 'inherit') setEditing(p => ({ ...p, prompt_rules: [...filtered, id + ':on'] }));
    else if (current === 'on') setEditing(p => ({ ...p, prompt_rules: [...filtered, id + ':off'] }));
    else setEditing(p => ({ ...p, prompt_rules: filtered }));
  };

  const stateLabel = (state) => {
    if (state === 'on') return { label: 'On', bg: 'var(--accent)', color: 'white' };
    if (state === 'off') return { label: 'Off', bg: 'var(--danger)', color: 'white' };
    return { label: 'Inherit', bg: 'var(--surface)', color: 'var(--text-muted)' };
  };

  const overrideCount = projectRules.length;

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Each rule can be set to <strong>Inherit</strong> (use profile setting), <strong>On</strong> (force active for this project), or <strong>Off</strong> (force inactive). Click a rule to cycle through states.
        {overrideCount > 0 && (
          <span style={{ marginLeft: 8, fontSize: 11, background: 'var(--accent)', color: 'white',
            padding: '1px 7px', borderRadius: 10, fontWeight: 500 }}>
            {overrideCount} override{overrideCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {RULES.map(cat => {
        const isOpen = !!openCategories[cat.category];
        const catOverrides = cat.rules.filter(r => getState(r.id) !== 'inherit').length;
        return (
          <div key={cat.category} style={{ marginBottom: 4, border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div onClick={() => toggleCategory(cat.category)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', cursor: 'pointer', background: isOpen ? 'var(--surface)' : 'var(--bg)',
                transition: 'background 0.15s', userSelect: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
                  {cat.category}
                </span>
                {catOverrides > 0 && (
                  <span style={{ fontSize: 10, background: 'var(--accent)', color: 'white',
                    padding: '1px 6px', borderRadius: 10, fontWeight: 500 }}>
                    {catOverrides} override{catOverrides > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'inline-block',
                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                ▼
              </span>
            </div>
            {isOpen && (
              <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)' }}>
                {cat.rules.map(rule => {
                  const state = getState(rule.id);
                  const badge = stateLabel(state);
                  return (
                    <div key={rule.id}
                      onClick={() => cycleRule(rule.id)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 10px', borderRadius: 'var(--radius)', cursor: 'pointer', marginBottom: 4,
                        background: state !== 'inherit' ? 'rgba(0,145,164,0.04)' : 'transparent',
                        border: '1px solid ' + (state !== 'inherit' ? 'var(--border)' : 'transparent'),
                        transition: 'all 0.15s' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{rule.label}</span>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                        background: badge.bg, color: badge.color, flexShrink: 0, marginLeft: 12 }}>
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ProjectsPage({ session, activeProject, setActiveProject, setView, onMenuOpen }) {
  const [projects, setProjects] = useState([]);
  const [editing, setEditing] = useState(null);
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [activeTab, setActiveTab] = useState('details');

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (editing?.id) loadDocs(editing.id);
    setActiveTab('details');
  }, [editing?.id]);

  const load = async () => {
    const { data } = await supabase.from('projects').select('*')
      .eq('user_id', session.user.id).order('name');
    if (data) setProjects(data);
  };

  const loadDocs = async (id) => {
    const { data } = await axios.get(API + '/api/documents/' + id);
    setDocs(data);
  };

  const save = async () => {
    if (editing.id) await supabase.from('projects').update(editing).eq('id', editing.id);
    else await supabase.from('projects').insert({ ...editing, user_id: session.user.id });
    setEditing(null); load();
  };

  const del = async (id) => {
    if (!confirm('Delete this project?')) return;
    await supabase.from('projects').delete().eq('id', id);
    if (activeProject?.id === id) setActiveProject(null);
    load();
  };

  const uploadDoc = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file); fd.append('projectId', editing.id); fd.append('userId', session.user.id);
    await axios.post(API + '/api/documents/upload', fd);
    loadDocs(editing.id); setUploading(false);
  };

  const delDoc = async (id) => {
    await axios.delete(API + '/api/documents/' + id); loadDocs(editing.id);
  };

  const toggleExpand = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const topLevel = projects.filter(p => !p.parent_id);
  const subProjects = projects.filter(p => p.parent_id);
  const topLevelOptions = projects.filter(p => !p.parent_id);

  if (editing) {
    const tabs = [
      { id: 'details', label: 'Details' },
      { id: 'rules', label: 'Writing Rules' },
      ...(editing.id ? [{ id: 'documents', label: 'Documents' }] : []),
    ];

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
          <button className='btn btn-secondary' onClick={() => setEditing(null)}>&larr; Back</button>
          <div className='page-title' style={{ margin: 0 }}>{editing.id ? 'Edit Project' : 'New Project'}</div>
        </div>

        <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--border)',
          paddingBottom: 0 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{ padding: '8px 16px', fontSize: 13, border: 'none', background: 'transparent',
                cursor: 'pointer', borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)',
                fontWeight: activeTab === tab.id ? 600 : 400, marginBottom: -1, transition: 'all 0.15s' }}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className='page-content'>
          {activeTab === 'details' && (
            <>
              <div className='form-group'>
                <label className='form-label'>Project Name</label>
                <input className='form-input' value={editing.name}
                  onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className='form-group'>
                <label className='form-label'>Parent Project (optional)</label>
                <select className='form-select' value={editing.parent_id || ''}
                  onChange={e => setEditing(p => ({ ...p, parent_id: e.target.value || null }))}>
                  <option value=''>None -- top level project</option>
                  {topLevelOptions.filter(p => p.id !== editing.id).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className='form-group'>
                <label className='form-label'>Background and Context</label>
                <textarea className='form-textarea' value={editing.description}
                  onChange={e => setEditing(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div className='form-group'>
                <label className='form-label'>Objectives</label>
                <textarea className='form-textarea' value={editing.objectives}
                  onChange={e => setEditing(p => ({ ...p, objectives: e.target.value }))} />
              </div>
              <div className='form-group'>
                <label className='form-label'>Custom AI Instructions</label>
                <textarea className='form-textarea' value={editing.custom_instructions}
                  onChange={e => setEditing(p => ({ ...p, custom_instructions: e.target.value }))}
                  placeholder='Specific guidance for AI responses on this project' />
              </div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                  color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type='checkbox' checked={editing.high_scrutiny}
                    onChange={e => setEditing(p => ({ ...p, high_scrutiny: e.target.checked }))} />
                  High scrutiny mode
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                  color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type='checkbox' checked={editing.profile_override}
                    onChange={e => setEditing(p => ({ ...p, profile_override: e.target.checked }))} />
                  Project overrides profile
                </label>
              </div>
            </>
          )}

          {activeTab === 'rules' && (
            <ProjectRulesTab editing={editing} setEditing={setEditing} />
          )}

          {activeTab === 'documents' && editing.id && (
            <>
              <label className='btn btn-secondary' style={{ cursor: 'pointer', marginBottom: 12, display: 'inline-block' }}>
                {uploading ? 'Uploading...' : 'Upload document (PDF, DOCX, TXT)'}
                <input type='file' style={{ display: 'none' }} accept='.pdf,.docx,.txt,.md' onChange={uploadDoc} />
              </label>
              {docs.map(d => (
                <div key={d.id} className='card'
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className='card-title'>{d.filename}</div>
                    <div className='card-meta'>{new Date(d.created_at).toLocaleDateString()}</div>
                  </div>
                  <button className='btn btn-danger' style={{ fontSize: 12 }} onClick={() => delDoc(d.id)}>Remove</button>
                </div>
              ))}
              {docs.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No documents uploaded yet.</p>}
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
            <button className='btn btn-primary' onClick={save}>Save</button>
            <button className='btn btn-secondary' onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='page'>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className='hamburger' onClick={onMenuOpen} aria-label='Open menu'>
            <svg width='20' height='20' viewBox='0 0 20 20' fill='none'>
              <rect x='2' y='4' width='16' height='2' rx='1' fill='currentColor'/>
              <rect x='2' y='9' width='16' height='2' rx='1' fill='currentColor'/>
              <rect x='2' y='14' width='16' height='2' rx='1' fill='currentColor'/>
            </svg>
          </button>
          <div className='page-title' style={{ margin: 0 }}>Projects</div>
        </div>
        <button className='btn btn-primary' onClick={() => setEditing({ ...blank })}>New Project</button>
      </div>

      {topLevel.map(p => {
        const subs = subProjects.filter(sp => sp.parent_id === p.id);
        const isExpanded = expanded[p.id];
        return (
          <div key={p.id}>
            <div className='card' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {subs.length > 0 && (
                    <button onClick={() => toggleExpand(p.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11,
                        color: 'var(--text-muted)', padding: '0 2px', lineHeight: 1 }}>
                      {isExpanded ? '▼' : '▶'}
                    </button>
                  )}
                  <div className='card-title'>{p.name}</div>
                  {subs.length > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--surface)',
                      padding: '1px 6px', borderRadius: 10 }}>
                      {subs.length} sub-project{subs.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className='card-meta'>{p.description?.slice(0, 100)}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginLeft: 16, flexShrink: 0 }}>
                <button className='btn btn-secondary' style={{ fontSize: 12 }} onClick={() => setEditing(p)}>Edit</button>
                {activeProject?.id === p.id
                  ? <button className='btn btn-secondary' style={{ fontSize: 12, color: 'var(--accent)' }} onClick={() => setActiveProject(null)}>Active</button>
                  : <button className='btn btn-primary' style={{ fontSize: 12 }} onClick={() => { setActiveProject(p); setView('chat'); }}>Use</button>
                }
                <button className='btn btn-secondary' style={{ fontSize: 12 }}
                  onClick={() => setEditing({ ...blank, parent_id: p.id })}>+ Sub</button>
                <button className='btn btn-danger' style={{ fontSize: 12 }} onClick={() => del(p.id)}>Delete</button>
              </div>
            </div>
            {isExpanded && subs.map(sp => (
              <div key={sp.id} className='card' style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', marginLeft: 24, borderLeft: '2px solid var(--accent)',
                borderRadius: '0 6px 6px 0' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>↳</span>
                    <div className='card-title'>{sp.name}</div>
                  </div>
                  <div className='card-meta'>{sp.description?.slice(0, 100)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginLeft: 16, flexShrink: 0 }}>
                  <button className='btn btn-secondary' style={{ fontSize: 12 }} onClick={() => setEditing(sp)}>Edit</button>
                  {activeProject?.id === sp.id
                    ? <button className='btn btn-secondary' style={{ fontSize: 12, color: 'var(--accent)' }} onClick={() => setActiveProject(null)}>Active</button>
                    : <button className='btn btn-primary' style={{ fontSize: 12 }} onClick={() => { setActiveProject(sp); setView('chat'); }}>Use</button>
                  }
                  <button className='btn btn-danger' style={{ fontSize: 12 }} onClick={() => del(sp.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        );
      })}
      {projects.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No projects yet. Create one to organise your work.</p>}
    </div>
  );
}