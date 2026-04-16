import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;
const CATS = ['All', 'Framework', 'Legislation', 'Best Practice', 'Consulting', 'Contract', 'Skills', 'Templates', 'Organisation', 'Communication'];
const EMPTY_FORM = { title: '', category: 'Framework', domain: 'Risk & Audit', jurisdiction: 'Queensland', description: '', sourceUrl: '', projectId: '' };

export default function LibraryPage({ session, onMenuOpen }) {
  const [docs, setDocs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('All');
  const [form, setForm] = useState(EMPTY_FORM);
  const [viewingDoc, setViewingDoc] = useState(null);
  const [docContent, setDocContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadDocs = () => {
    setLoading(true);
    setError(null);
    axios.get(API + '/api/library')
      .then(r => { setDocs(r.data); setLoading(false); })
      .catch(() => { setError('Could not load library. The server may be starting up -- try again in 30 seconds.'); setLoading(false); });
  };

  useEffect(() => {
    loadDocs();
    supabase.from('profiles').select('access_tier').eq('id', session.user.id).single()
      .then(({ data }) => setIsAdmin(data?.access_tier === 'admin'));
    supabase.from('projects').select('id, name, parent_id').eq('user_id', session.user.id).order('name')
      .then(({ data }) => { if (data) setProjects(data); });
  }, []);

  const upload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
    fd.append('file', file);
    try {
      await axios.post(API + '/api/library/upload', fd);
      loadDocs();
      setForm(f => ({ ...EMPTY_FORM, category: f.category, domain: f.domain, jurisdiction: f.jurisdiction }));
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 2000);
    } catch {
      setError('Upload failed. Please try again.');
    }
    setUploading(false);
    e.target.value = '';
  };

  const viewDoc = async (doc) => {
    setViewingDoc(doc);
    setLoadingContent(true);
    setDocContent('');
    try {
      const { data } = await supabase
        .from('library_documents')
        .select('content')
        .eq('id', doc.id)
        .single();
      setDocContent(data?.content || 'No content available.');
    } catch {
      setDocContent('Could not load document content.');
    }
    setLoadingContent(false);
  };

  const deleteDoc = async (id) => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await axios.delete(API + '/api/library/' + id);
      setDocs(prev => prev.filter(d => d.id !== id));
    } catch {
      setError('Delete failed. Please try again.');
    }
    setDeletingId(null);
  };

  const filtered = filter === 'All' ? docs : docs.filter(d => d.category === filter);

  const categoryBadgeStyle = (cat) => {
    const colours = {
      'Framework': { bg: '#e8f4f8', color: '#0091a4' },
      'Legislation': { bg: '#fdf0e8', color: '#c67a2e' },
      'Best Practice': { bg: '#eaf4ea', color: '#2e7d32' },
      'Consulting': { bg: '#f3eafa', color: '#6a3aab' },
      'Contract': { bg: '#fef3e8', color: '#b85c00' },
      'Skills': { bg: '#e8f0fa', color: '#1a5cb5' },
      'Templates': { bg: '#fdf5e8', color: '#b57a1a' },
      'Organisation': { bg: '#fae8e8', color: '#b52a2a' },
      'Communication': { bg: '#f0f0ec', color: '#6b6b6b' },
    };
    return colours[cat] || { bg: '#f0f0ec', color: '#6b6b6b' };
  };

  // Build grouped project options for the scope dropdown
  const topLevelProjects = projects.filter(p => !p.parent_id);
  const subProjects = projects.filter(p => p.parent_id);
  const projectOptions = [];
  topLevelProjects.forEach(p => {
    projectOptions.push({ id: p.id, label: p.name, indent: false });
    subProjects.filter(sp => sp.parent_id === p.id).forEach(sp => {
      projectOptions.push({ id: sp.id, label: '↳ ' + sp.name, indent: true });
    });
  });
  // Any sub-projects whose parent isn't in the list (edge case)
  subProjects.filter(sp => !topLevelProjects.find(p => p.id === sp.parent_id)).forEach(sp => {
    projectOptions.push({ id: sp.id, label: sp.name, indent: false });
  });

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
          <div className='page-title' style={{ margin: 0 }}>Library</div>
        </div>
        {error && (
          <button className='btn btn-secondary' style={{ fontSize: 12 }} onClick={loadDocs}>Retry</button>
        )}
      </div>

      {viewingDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setViewingDoc(null)}>
          <div style={{ background: 'var(--bg)', borderRadius: 8, maxWidth: 720, width: '100%',
            maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 32px rgba(0,0,0,0.16)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{viewingDoc.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {viewingDoc.category} · {viewingDoc.jurisdiction}
                </div>
              </div>
              <button onClick={() => setViewingDoc(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20,
                  color: 'var(--text-muted)', padding: '0 4px', lineHeight: 1 }}>
                ×
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
              {loadingContent ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading content...</p>
              ) : (
                <pre style={{ fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1.6,
                  color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {docContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {CATS.map(c => (
          <button key={c} className={'btn ' + (filter === c ? 'btn-primary' : 'btn-secondary')}
            style={{ fontSize: 12 }} onClick={() => setFilter(c)}>{c}</button>
        ))}
      </div>

      {isAdmin && (
        <div className='card' style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Upload document</div>
            {uploadSuccess && (
              <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 500 }}>Document uploaded</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Skills, Templates, and Organisation documents are injected into every Guided mode response automatically. Scoping to a project limits injection to that project only.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Title</label>
              <input className='form-input' value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Category</label>
              <select className='form-select' value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATS.slice(1).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Jurisdiction</label>
              <input className='form-input' value={form.jurisdiction}
                onChange={e => setForm(f => ({ ...f, jurisdiction: e.target.value }))} />
            </div>
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Source URL (optional)</label>
              <input className='form-input' value={form.sourceUrl}
                onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))} />
            </div>
            <div className='form-group' style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className='form-label'>Scope to project (optional)</label>
              <select className='form-select' value={form.projectId}
                onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}>
                <option value=''>Global -- available to all sessions</option>
                {projectOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className='form-group'>
            <label className='form-label'>Description</label>
            <input className='form-input' value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <label className='btn btn-primary' style={{ cursor: 'pointer', fontSize: 13 }}>
            {uploading ? 'Uploading and embedding...' : 'Choose file and upload'}
            <input type='file' style={{ display: 'none' }} accept='.pdf,.docx,.txt,.md' onChange={upload} />
          </label>
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading library...</p>}

      {error && !loading && (
        <div style={{ padding: 16, background: 'var(--surface)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!loading && !error && filtered.map(d => {
        const badge = categoryBadgeStyle(d.category);
        const isAutoInjected = ['Skills', 'Templates', 'Organisation'].includes(d.category);
        const projectName = d.project_id ? projects.find(p => p.id === d.project_id)?.name : null;
        return (
          <div key={d.id} className='card'>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <div className='card-title' style={{ margin: 0 }}>{d.title}</div>
                  <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                    background: badge.bg, color: badge.color, fontWeight: 500 }}>
                    {d.category}
                  </span>
                  {isAutoInjected && !projectName && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: '#e8f4f8', color: '#0091a4', fontWeight: 500 }}>
                      Always on
                    </span>
                  )}
                  {projectName && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: '#f0f0ec', color: '#6b6b6b', fontWeight: 500 }}>
                      {projectName}
                    </span>
                  )}
                </div>
                <div className='card-meta'>{d.jurisdiction}</div>
                {d.description && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{d.description}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginLeft: 16, flexShrink: 0, alignItems: 'center' }}>
                {d.source_url && (
                  <a href={d.source_url} target='_blank' rel='noopener noreferrer'
                    style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                    Source &rarr;
                  </a>
                )}
                <button onClick={() => viewDoc(d)}
                  className='btn btn-secondary' style={{ fontSize: 12, padding: '4px 10px' }}>
                  View
                </button>
                {isAdmin && (
                  <button onClick={() => deleteDoc(d.id)} disabled={deletingId === d.id}
                    className='btn btn-danger' style={{ fontSize: 12, padding: '4px 10px',
                      opacity: deletingId === d.id ? 0.5 : 1 }}>
                    {deletingId === d.id ? '...' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {!loading && !error && filtered.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>No documents in this category yet.</p>
      )}
    </div>
  );
}
