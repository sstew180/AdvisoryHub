import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;
const blank = { name: '', description: '', objectives: '', custom_instructions: '', high_scrutiny: false, profile_override: false };

export default function ProjectsPage({ session, activeProject, setActiveProject, setView }) {
  const [projects, setProjects] = useState([]);
  const [editing, setEditing] = useState(null);
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { load(); }, []);
  useEffect(() => { if (editing?.id) loadDocs(editing.id); }, [editing?.id]);

  const load = async () => {
    const { data } = await supabase.from('projects').select('*')
      .eq('user_id', session.user.id).order('created_at', { ascending: false });
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

  if (editing) return (
    <div className='page'>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button className='btn btn-secondary' onClick={() => setEditing(null)}>&larr; Back</button>
        <div className='page-title' style={{ margin: 0 }}>{editing.id ? 'Edit Project' : 'New Project'}</div>
      </div>
      <div className='page-content'>
        <div className='form-group'>
          <label className='form-label'>Project Name</label>
          <input className='form-input' value={editing.name} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} />
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
        <div className='page-title' style={{ margin: 0 }}>Projects</div>
        <button className='btn btn-primary' onClick={() => setEditing({ ...blank })}>New Project</button>
      </div>
      {projects.map(p => (
        <div key={p.id} className='card' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className='card-title'>{p.name}</div>
            <div className='card-meta'>{p.description?.slice(0, 100)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginLeft: 16 }}>
            <button className='btn btn-secondary' style={{ fontSize: 12 }} onClick={() => setEditing(p)}>Edit</button>
            {activeProject?.id === p.id
              ? <button className='btn btn-secondary' style={{ fontSize: 12, color: 'var(--accent)' }} onClick={() => setActiveProject(null)}>Active</button>
              : <button className='btn btn-primary' style={{ fontSize: 12 }} onClick={() => { setActiveProject(p); setView('chat'); }}>Use in chat</button>
            }
            <button className='btn btn-danger' style={{ fontSize: 12 }} onClick={() => del(p.id)}>Delete</button>
          </div>
        </div>
      ))}
      {projects.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No projects yet. Create one to organise your work.</p>}
    </div>
  );
}