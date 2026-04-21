import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;

// Library tabs -- Project and My Documents are user-facing upload destinations
const CATS = ['All', 'Project', 'My Documents', 'Framework', 'Legislation', 'Best Practice', 'Consulting', 'Contract', 'Skills', 'Templates', 'Organisation', 'Communication'];

const UPLOAD_CATEGORIES = ['Skills', 'Framework', 'Best Practice', 'Templates', 'Organisation', 'Communication', 'Other'];

export default function LibraryPage({ session, onMenuOpen, setView, activeProject }) {
  const [docs, setDocs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('All');
  const [viewingDoc, setViewingDoc] = useState(null);
  const [docContent, setDocContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editingDoc, setEditingDoc] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', jurisdiction: '', description: '', sourceUrl: '', projectId: '' });
  const [saving, setSaving] = useState(false);
  const [userSettings, setUserSettings] = useState({});
  const [togglingId, setTogglingId] = useState(null);

  // Upload form state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    category: 'Skills',
    jurisdiction: 'Queensland',
    description: '',
    sourceUrl: '',
    projectId: '',
  });

  const loadDocs = () => {
    setLoading(true);
    setError(null);
    axios.get(`${API}/api/library?userId=${session.user.id}`)
      .then(r => { setDocs(r.data); setLoading(false); })
      .catch(() => {
        setError('Could not load library. The server may be starting up -- try again in 30 seconds.');
        setLoading(false);
      });
  };

  const loadUserSettings = async () => {
    const { data } = await supabase
      .from('user_library_settings')
      .select('document_id, enabled')
      .eq('user_id', session.user.id);
    if (data) {
      const map = {};
      data.forEach(s => { map[s.document_id] = s.enabled; });
      setUserSettings(map);
    }
  };

  useEffect(() => {
    loadDocs();
    loadUserSettings();
    supabase.from('profiles').select('access_tier').eq('id', session.user.id).single()
      .then(({ data }) => setIsAdmin(data?.access_tier === 'admin'));
    supabase.from('projects').select('id, name, parent_id').eq('user_id', session.user.id)
      .is('archived_at', null).order('name')
      .then(({ data }) => { if (data) setProjects(data); });
  }, []);

  const isDocEnabled = (docId) => {
    if (docId in userSettings) return userSettings[docId];
    return true;
  };

  const toggleDoc = async (docId) => {
    setTogglingId(docId);
    const newEnabled = !isDocEnabled(docId);
    try {
      await supabase.from('user_library_settings').upsert({
        user_id: session.user.id,
        document_id: docId,
        enabled: newEnabled,
      }, { onConflict: 'user_id,document_id' });
      setUserSettings(prev => ({ ...prev, [docId]: newEnabled }));
    } catch (err) {
      console.error('Toggle error:', err);
    }
    setTogglingId(null);
  };

  const handleFilterChange = (cat) => {
    setFilter(cat);
    setShowUpload(false);
  };

  // ── Upload ──────────────────────────────────────────────────────────────────
  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('title', uploadForm.title || file.name.replace(/\.[^.]+$/, ''));
    fd.append('category', filter === 'Project' ? 'Project' : filter === 'My Documents' ? uploadForm.category : filter);
    fd.append('domain', 'General');
    fd.append('jurisdiction', uploadForm.jurisdiction);
    fd.append('userId', session.user.id);
    if (uploadForm.description) fd.append('description', uploadForm.description);
    if (uploadForm.sourceUrl) fd.append('sourceUrl', uploadForm.sourceUrl);
    if (filter === 'Project' && activeProject) fd.append('projectId', activeProject.id);
    else if (uploadForm.projectId) fd.append('projectId', uploadForm.projectId);
    fd.append('file', file);
    try {
      await axios.post(`${API}/api/library/upload`, fd);
      loadDocs();
      setUploadForm({ title: '', category: 'Skills', jurisdiction: 'Queensland', description: '', sourceUrl: '', projectId: '' });
      setUploadSuccess(true);
      setShowUpload(false);
      setTimeout(() => setUploadSuccess(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed. Please try again.');
    }
    setUploading(false);
    e.target.value = '';
  };

  // ── Edit ────────────────────────────────────────────────────────────────────
  const openEdit = (doc) => {
    setEditingDoc(doc);
    setEditForm({
      title: doc.title || '',
      jurisdiction: doc.jurisdiction || '',
      description: doc.description || '',
      sourceUrl: doc.source_url || '',
      projectId: doc.project_id || '',
    });
  };

  const saveEdit = async () => {
    if (!editingDoc) return;
    setSaving(true);
    try {
      await axios.patch(`${API}/api/library/${editingDoc.id}`, {
        title: editForm.title,
        jurisdiction: editForm.jurisdiction,
        description: editForm.description,
        sourceUrl: editForm.sourceUrl,
        projectId: editForm.projectId || null,
        userId: session.user.id,
      });
      setEditingDoc(null);
      loadDocs();
    } catch {
      setError('Save failed. Please try again.');
    }
    setSaving(false);
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteDoc = async (id) => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await axios.delete(`${API}/api/library/${id}?userId=${session.user.id}`);
      setDocs(prev => prev.filter(d => d.id !== id));
    } catch {
      setError('Delete failed. Please try again.');
    }
    setDeletingId(null);
  };

  // ── View ────────────────────────────────────────────────────────────────────
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

  // ── Filtering ───────────────────────────────────────────────────────────────
  const filtered = (() => {
    if (filter === 'All') return docs;
    if (filter === 'Project') {
      if (!activeProject) return [];
      return docs.filter(d => d.project_id === activeProject.id);
    }
    if (filter === 'My Documents') {
      return docs.filter(d => d.user_id === session.user.id && !d.project_id);
    }
    return docs.filter(d => d.category === filter && !d.user_id);
  })();

  // Can the current user edit/delete this doc?
  const canEdit = (doc) => {
    if (isAdmin) return true;
    return doc.user_id === session.user.id;
  };

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
      'Project': { bg: '#f0f4ff', color: '#2563eb' },
    };
    return colours[cat] || { bg: '#f0f0ec', color: '#6b6b6b' };
  };

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
          <button className='mobile-back' onClick={() => setView('chat')}>‹ Chat</button>
          <div className='page-title' style={{ margin: 0 }}>Library</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {uploadSuccess && <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 500 }}>Document uploaded ✓</span>}
          {error && <button className='btn btn-secondary' style={{ fontSize: 12 }} onClick={() => { setError(null); loadDocs(); }}>Retry</button>}
          {(filter === 'Project' || filter === 'My Documents') && !showUpload && (
            <button className='btn btn-primary' style={{ fontSize: 13 }} onClick={() => setShowUpload(true)}>
              + Upload
            </button>
          )}
        </div>
      </div>

      {/* View modal */}
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
                  {viewingDoc.category}{viewingDoc.jurisdiction ? ` · ${viewingDoc.jurisdiction}` : ''}
                  {viewingDoc.project_id && projectNameMap[viewingDoc.project_id] ? ` · ${projectNameMap[viewingDoc.project_id]}` : ''}
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

      {/* Edit modal */}
      {editingDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setEditingDoc(null)}>
          <div style={{ background: 'var(--bg)', borderRadius: 8, maxWidth: 560, width: '100%',
            maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 32px rgba(0,0,0,0.16)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Edit document</div>
              <button onClick={() => setEditingDoc(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20,
                  color: 'var(--text-muted)', padding: '0 4px', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className='form-group' style={{ margin: 0 }}>
                  <label className='form-label'>Title</label>
                  <input className='form-input' value={editForm.title}
                    onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div className='form-group' style={{ margin: 0 }}>
                  <label className='form-label'>Jurisdiction</label>
                  <input className='form-input' value={editForm.jurisdiction}
                    onChange={e => setEditForm(f => ({ ...f, jurisdiction: e.target.value }))} />
                </div>
                <div className='form-group' style={{ margin: 0 }}>
                  <label className='form-label'>Source URL (optional)</label>
                  <input className='form-input' value={editForm.sourceUrl}
                    onChange={e => setEditForm(f => ({ ...f, sourceUrl: e.target.value }))} />
                </div>
                <div className='form-group' style={{ margin: 0, gridColumn: '1 / -1' }}>
                  <label className='form-label'>Description (optional)</label>
                  <input className='form-input' value={editForm.description}
                    onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className='form-group' style={{ margin: 0, gridColumn: '1 / -1' }}>
                  <label className='form-label'>Link to project (optional)</label>
                  <select className='form-select' value={editForm.projectId}
                    onChange={e => setEditForm(f => ({ ...f, projectId: e.target.value }))}>
                    <option value=''>No project -- personal document</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <button className='btn btn-primary' onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button className='btn btn-secondary' onClick={() => setEditingDoc(null)}>Cancel</button>
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

      {/* Upload panel -- shown for Project and My Documents tabs */}
      {showUpload && (filter === 'Project' || filter === 'My Documents') && (
        <div className='card' style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {filter === 'Project' ? `Upload to ${activeProject?.name || 'project'}` : 'Upload personal document'}
            </div>
            <button onClick={() => setShowUpload(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Title (optional -- uses filename if blank)</label>
              <input className='form-input' value={uploadForm.title} placeholder={filter === 'Project' ? 'e.g. Project Risk Register' : 'e.g. My reference guide'}
                onChange={e => setUploadForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            {filter === 'My Documents' && (
              <div className='form-group' style={{ margin: 0 }}>
                <label className='form-label'>Category</label>
                <select className='form-select' value={uploadForm.category}
                  onChange={e => setUploadForm(f => ({ ...f, category: e.target.value }))}>
                  {UPLOAD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Jurisdiction</label>
              <input className='form-input' value={uploadForm.jurisdiction}
                onChange={e => setUploadForm(f => ({ ...f, jurisdiction: e.target.value }))} />
            </div>
            <div className='form-group' style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className='form-label'>Description (optional)</label>
              <input className='form-input' value={uploadForm.description} placeholder='Brief description of what this document contains'
                onChange={e => setUploadForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            {filter === 'My Documents' && (
              <div className='form-group' style={{ margin: 0, gridColumn: '1 / -1' }}>
                <label className='form-label'>Link to project (optional)</label>
                <select className='form-select' value={uploadForm.projectId}
                  onChange={e => setUploadForm(f => ({ ...f, projectId: e.target.value }))}>
                  <option value=''>No project -- personal document</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            PDF, DOCX, TXT, or MD. Maximum 20MB. The document will be embedded and available to the AI.
          </div>
          <label className='btn btn-primary' style={{ cursor: 'pointer', fontSize: 13, display: 'inline-block' }}>
            {uploading ? 'Uploading and embedding...' : 'Choose file and upload'}
            <input type='file' style={{ display: 'none' }} accept='.pdf,.docx,.txt,.md'
              onChange={upload} disabled={uploading} />
          </label>
        </div>
      )}

      {/* Admin upload button for non-user tabs */}
      {isAdmin && !['Project', 'My Documents', 'All'].includes(filter) && !showUpload && (
        <div style={{ marginBottom: 20 }}>
          <button className='btn btn-secondary' style={{ fontSize: 13 }} onClick={() => setShowUpload(true)}>
            + Upload {filter} document
          </button>
        </div>
      )}

      {/* Admin upload panel for global tabs */}
      {isAdmin && showUpload && !['Project', 'My Documents'].includes(filter) && (
        <div className='card' style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Upload {filter} document (admin)</div>
            <button onClick={() => setShowUpload(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Title</label>
              <input className='form-input' value={uploadForm.title}
                onChange={e => setUploadForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Jurisdiction</label>
              <input className='form-input' value={uploadForm.jurisdiction}
                onChange={e => setUploadForm(f => ({ ...f, jurisdiction: e.target.value }))} />
            </div>
            <div className='form-group' style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className='form-label'>Description (optional)</label>
              <input className='form-input' value={uploadForm.description}
                onChange={e => setUploadForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <label className='btn btn-primary' style={{ cursor: 'pointer', fontSize: 13, display: 'inline-block' }}>
            {uploading ? 'Uploading and embedding...' : 'Choose file and upload'}
            <input type='file' style={{ display: 'none' }} accept='.pdf,.docx,.txt,.md' onChange={upload} />
          </label>
        </div>
      )}

      {/* Project tab -- no active project message */}
      {filter === 'Project' && !activeProject && (
        <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--text-muted)' }}>
          No active project selected. Activate a project from the sidebar to see its documents here.
        </div>
      )}

      {/* Project tab header */}
      {filter === 'Project' && activeProject && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{activeProject.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {filtered.length} document{filtered.length !== 1 ? 's' : ''} · used by the AI when this project is active
          </div>
        </div>
      )}

      {/* My Documents tab header */}
      {filter === 'My Documents' && (
        <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
          Your personal documents. These are available to the AI in all sessions regardless of active project.
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading library...</p>}

      {error && !loading && (
        <div style={{ padding: 16, background: 'var(--surface)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Document list */}
      {!loading && !error && filtered.map(d => {
        const badge = categoryBadgeStyle(d.category);
        const isUserDoc = d.user_id === session.user.id;
        const isProjectDoc = !!d.project_id;
        const isAutoInjected = ['Skills', 'Templates', 'Organisation'].includes(d.category) && !d.user_id;
        const enabled = isDocEnabled(d.id);
        const toggling = togglingId === d.id;
        const editable = canEdit(d);

        return (
          <div key={d.id} className='card' style={{ opacity: enabled ? 1 : 0.6, transition: 'opacity 0.2s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <div className='card-title' style={{ margin: 0 }}>{d.title}</div>

                  {/* Category badge */}
                  <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                    background: badge.bg, color: badge.color, fontWeight: 500 }}>
                    {d.category}
                  </span>

                  {/* Project badge */}
                  {isProjectDoc && projectNameMap[d.project_id] && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: '#f0f4ff', color: '#2563eb', fontWeight: 500 }}>
                      {projectNameMap[d.project_id]}
                    </span>
                  )}

                  {/* User doc badge */}
                  {isUserDoc && !isProjectDoc && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: '#f0faf0', color: '#2e7d32', fontWeight: 500 }}>
                      My document
                    </span>
                  )}

                  {/* Always on badge */}
                  {isAutoInjected && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: '#e8f4f8', color: '#0091a4', fontWeight: 500 }}>
                      Always on
                    </span>
                  )}

                  {/* Disabled badge */}
                  {!enabled && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: '#fae8e8', color: 'var(--danger)', fontWeight: 500 }}>
                      Disabled
                    </span>
                  )}
                </div>

                <div className='card-meta'>{d.jurisdiction}</div>
                {d.description && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{d.description}</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginLeft: 16, flexShrink: 0, alignItems: 'center' }}>
                {/* Enable/disable toggle -- only for non-admin docs */}
                {!d.is_admin_managed && (
                  <button
                    onClick={() => toggleDoc(d.id)}
                    disabled={toggling}
                    title={enabled ? 'Disable this document' : 'Enable this document'}
                    style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius)',
                      border: '1px solid ' + (enabled ? 'var(--accent)' : 'var(--border)'),
                      background: enabled ? 'rgba(0,145,164,0.08)' : 'var(--surface)',
                      color: enabled ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: toggling ? 'not-allowed' : 'pointer',
                      fontWeight: 500, transition: 'all 0.15s', opacity: toggling ? 0.5 : 1,
                    }}>
                    {toggling ? '...' : enabled ? 'On' : 'Off'}
                  </button>
                )}

                {d.source_url && (
                  <a href={d.source_url} target='_blank' rel='noopener noreferrer'
                    style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                    Source →
                  </a>
                )}

                <button onClick={() => viewDoc(d)} className='btn btn-secondary'
                  style={{ fontSize: 12, padding: '4px 10px' }}>View</button>

                {editable && (
                  <>
                    <button onClick={() => openEdit(d)} className='btn btn-secondary'
                      style={{ fontSize: 12, padding: '4px 10px' }}>Edit</button>
                    <button onClick={() => deleteDoc(d.id)} disabled={deletingId === d.id}
                      className='btn btn-danger' style={{ fontSize: 12, padding: '4px 10px',
                        opacity: deletingId === d.id ? 0.5 : 1 }}>
                      {deletingId === d.id ? '...' : 'Delete'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {!loading && !error && filtered.length === 0 && filter !== 'Project' && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {filter === 'My Documents'
            ? 'No personal documents yet. Upload a document using the button above.'
            : filter === 'All'
              ? 'No documents in the library yet.'
              : `No ${filter} documents yet.`}
        </p>
      )}

      {!loading && !error && filtered.length === 0 && filter === 'Project' && activeProject && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          No documents uploaded to this project yet. Use the Upload button to add documents.
        </p>
      )}
    </div>
  );
}
