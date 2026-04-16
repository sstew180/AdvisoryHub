import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;
const CATS = ['All', 'Framework', 'Legislation', 'Best Practice', 'Consulting', 'Contract', 'Skills', 'Templates', 'Organisation', 'Communication'];

export default function LibraryPage({ session, onMenuOpen }) {
  const [docs, setDocs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('All');
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({ title: '', jurisdiction: 'Queensland', description: '', sourceUrl: '', selectedProjectIds: [] });
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

  const handleFilterChange = (cat) => {
    setFilter(cat);
    setShowUpload(false);
    setForm({ title: '', jurisdiction: 'Queensland', description: '', sourceUrl: '', selectedProjectIds: [] });
  };

  const toggleProjectSelection = (id) => {
    setForm(f => ({
      ...f,
      selectedProjectIds: f.selectedProjectIds.includes(id)
        ? f.selectedProjectIds.filter(pid => pid !== id)
        : [...f.selectedProjectIds, id],
    }));
  };

  const upload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('title', form.title);
    fd.append('category', filter);
    fd.append('domain', 'Risk & Audit');
    fd.append('jurisdiction', form.jurisdiction);
    if (form.description) fd.append('description', form.description);
    if (form.sourceUrl) fd.append('sourceUrl', form.sourceUrl);
    // Send each selected project ID
    form.selectedProjectIds.forEach(pid => fd.append('projectIds[]', pid));
    fd.append('file', file);
    try {
      await axios.post(API + '/api/library/upload', fd);
      loadDocs();
      setForm({ title: '', jurisdiction: 'Queensland', description: '', sourceUrl: '', selectedProjectIds: [] });
      setUploadSuccess(true);
      setShowUpload(false);
      setTimeout(() => setUploadSuccess(false), 3000);
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
      const { data } = await supabase.from('library_documents').select('content').eq('id', doc.id).single();
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

  // Build grouped project list for multi-select
  const topLevelProjects = projects.filter(p => !p.parent_id);
  const subProjects = projects.filter(p => p.parent_id);
  const projectOptions = [];
  topLevelProjects.forEach(p => {
    projectOptions.push({ id: p.id, label: p.name, indent: false });
    subProjects.filter(sp => sp.parent_id === p.id).forEach(sp => {
      projectOptions.push({ id: sp.id, label: '↳ ' + sp.name, indent: true });
    });
  });
  subProjects.filter(sp => !topLevelProjects.find(p => p.id === sp.parent_id)).forEach(sp => {
    projectOptions.push({ id: sp.id, label: sp.name, indent: false });
  });

  // Build a lookup map for project names
  const projectNameMap = {};
  projects.forEach(p => { projectNameMap[p.id] = p.name; });

  return (
    <div className='page'>

      {/* Header */}
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
        {uploadSuccess && <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 500 }}>Document uploaded</span>}
        {error && <button className='btn btn-secondary' style={{ fontSize: 12 }} onClick={loadDocs}>Retry</button>}
      </div>

      {/* View content modal */}
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
                  color: 'var(--text-muted)', padding: '0 4px', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
              {loadingContent
                ? <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading content...</p>
                : <pre style={{ fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1.6,
                    color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {docContent}
                  </pre>
              }
            </div>
          </div>
        </div>
      )}

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {CATS.map(c => (
          <button key={c} onClick={() => handleFilterChange(c)}
            style={{ padding: '8px 14px', fontSize: 13, border: 'none', background: 'transparent',
              cursor: 'pointer', whiteSpace: 'nowrap',
              borderBottom: filter === c ? '2px solid var(--accent)' : '2px solid transparent',
              color: filter === c ? 'var(--accent)' : 'var(--text-secondary)',
              fontWeight: filter === c ? 600 : 400, marginBottom: -1, transition: 'all 0.15s' }}>
            {c}
          </button>
        ))}
      </div>

      {/* Upload button -- only on specific category tabs for admins */}
      {isAdmin && filter !== 'All' && (
        <div style={{ marginBottom: 20 }}>
          {!showUpload ? (
            <button className='btn btn-secondary' style={{ fontSize: 13 }} onClick={() => setShowUpload(true)}>
              + Upload {filter} document
            </button>
          ) : (
            <div className='card'>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Upload {filter} document</div>
                <button onClick={() => setShowUpload(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className='form-group' style={{ margin: 0 }}>
                  <label className='form-label'>Title</label>
                  <input className='form-input' value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
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
                  <label className='form-label'>Description (optional)</label>
                  <input className='form-input' value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
              </div>

              {/* Project scope -- multi-select checkboxes */}
              {projectOptions.length > 0 && (
                <div className='form-group'>
                  <label className='form-label'>Scope to projects (leave unchecked for global)</label>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px', maxHeight: 160, overflowY: 'auto' }}>
                    {projectOptions.map(p => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer',
                        paddingLeft: p.indent ? 16 : 0, fontSize: 13, color: 'var(--text-primary)' }}>
                        <input
                          type='checkbox'
                          checked={form.selectedProjectIds.includes(p.id)}
                          onChange={() => toggleProjectSelection(p.id)}
                          style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                  {form.selectedProjectIds.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      No projects selected -- document will be global
                    </div>
                  )}
                  {form.selectedProjectIds.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4 }}>
                      Linked to {form.selectedProjectIds.length} project{form.selectedProjectIds.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              )}

              <label className='btn btn-primary' style={{ cursor: 'pointer', fontSize: 13 }}>
                {uploading ? 'Uploading and embedding...' : 'Choose file and upload'}
                <input type='file' style={{ display: 'none' }} accept='.pdf,.docx,.txt,.md' onChange={upload} />
              </label>
            </div>
          )}
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
        // project_ids comes from the updated GET route via junction table
        const linkedProjectIds = d.project_ids || [];
        const isGlobal = linkedProjectIds.length === 0;

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
                  {isAutoInjected && isGlobal && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: '#e8f4f8', color: '#0091a4', fontWeight: 500 }}>
                      Always on
                    </span>
                  )}
                  {isGlobal && !isAutoInjected && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: 'var(--surface)', color: 'var(--text-muted)', fontWeight: 500 }}>
                      Global
                    </span>
                  )}
                  {linkedProjectIds.map(pid => (
                    <span key={pid} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: '#f0f4ff', color: '#2563eb', fontWeight: 500 }}>
                      {projectNameMap[pid] || pid}
                    </span>
                  ))}
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
                <button onClick={() => viewDoc(d)} className='btn btn-secondary'
                  style={{ fontSize: 12, padding: '4px 10px' }}>View</button>
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
        <p style={{ color: 'var(--text-muted)' }}>
          {filter === 'All' ? 'No documents in the library yet.' : `No ${filter} documents yet.`}
        </p>
      )}
    </div>
  );
}
