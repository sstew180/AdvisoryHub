import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;
const blank = { name: '', description: '', objectives: '', custom_instructions: '', high_scrutiny: false, profile_override: false, parent_id: null };

export default function ProjectsPage({ session, activeProject, setActiveProject, setView, onMenuOpen }) {
  const [projects, setProjects] = useState([]);
  const [editing, setEditing] = useState(null);
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState({});

  useEffect(() => { load(); }, []);
  useEffect(() => { if (editing?.id) loadDocs(editing.id); }, [editing?.id]);

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

  if (editing) return (
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
      <div className='page-content'>
        <div className='form-group'>
          <label className='form-label'>Project Name</label>
          <input className='form-input' value={editing.name} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} />
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
          <textarea className='form-textarea' value={editing.description} onChange={e => setEditing(p => ({ ...p, description: e.target.value }))} />
        </div>
        <div className='form-group'>
          <label className='form-label'>Objectives</label>
          <textarea className='form-textarea' value={editing.objectives} onChange={e => setEditing(p => ({ ...p, objectives: e.target.value }))} />
        </div>
        <div className='form-group'>
          <label className='form-label'>Custom AI Instructions</label>
          <textarea className='form-textarea' value={editing.custom_instructions}
            onChange={e => setEditing(p => ({ ...p, custom_instructions: e.target.value }))}
            placeholder='Specific guidance for AI responses on this project' />
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type='checkbox' checked={editing.high_scrutiny} onChange={e => setEditing(p => ({ ...p, high_scrutiny: e.target.checked }))} />
            High scrutiny mode
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type='checkbox' checked={editing.profile_override} onChange={e => setEditing(p => ({ ...p, profile_override: e.target.checked }))} />
            Project overrides profile
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
          <button className='btn btn-primary' onClick={save}>Save</button>
          <button className='btn btn-secondary' onClick={() => setEditing(null)}>Cancel</button>
        </div>
        {editing.id && <>
          <div className='page-title' style={{ fontSize: 16, marginBottom: 12 }}>Documents</div>
          <label className='btn btn-secondary' style={{ cursor: 'pointer', marginBottom: 12, display: 'inline-block' }}>
            {uploading ? 'Uploading...' : 'Upload document (PDF, DOCX, TXT)'}
            <input type='file' style={{ display: 'none' }} accept='.pdf,.docx,.txt,.md' onChange={uploadDoc} />
          </label>
          {docs.map(d => (
            <div key={d.id} className='card' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className='card-title'>{d.filename}</div>
                <div className='card-meta'>{new Date(d.created_at).toLocaleDateString()}</div>
              </div>
              <button className='btn btn-danger' style={{ fontSize: 12 }} onClick={() => delDoc(d.id)}>Remove</button>
            </div>
          ))}
        </>}
      </div>
    </div>
  );

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