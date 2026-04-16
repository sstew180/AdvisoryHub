import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL;

export default function ArchivePage({ session, setActiveSessionId, setView, onMenuOpen }) {
  const [activeTab, setActiveTab] = useState('sessions');
  const [archivedSessions, setArchivedSessions] = useState([]);
  const [archivedProjects, setArchivedProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  const userId = session.user.id;

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [sessionsRes, projectsRes] = await Promise.all([
        fetch(`${API}/api/sessions/archived?userId=${userId}`),
        fetch(`${API}/api/projects/archived?userId=${userId}`),
      ]);
      const [sessionsData, projectsData] = await Promise.all([
        sessionsRes.json(),
        projectsRes.json(),
      ]);
      setArchivedSessions(Array.isArray(sessionsData) ? sessionsData : []);
      setArchivedProjects(Array.isArray(projectsData) ? projectsData : []);
    } catch (err) {
      console.error('Load archived error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Session actions
  const restoreSession = async (id) => {
    setActionLoading(id + '-restore');
    try {
      await fetch(`${API}/api/sessions/${id}/restore`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      setArchivedSessions(prev => prev.filter(s => s.id !== id));
    } catch (err) { console.error('Restore session error:', err); }
    setActionLoading(null);
  };

  const deleteSession = async (id) => {
    setActionLoading(id + '-delete');
    try {
      await fetch(`${API}/api/sessions/${id}?userId=${userId}`, { method: 'DELETE' });
      setArchivedSessions(prev => prev.filter(s => s.id !== id));
      setConfirmDeleteId(null);
    } catch (err) { console.error('Delete session error:', err); }
    setActionLoading(null);
  };

  // Project actions
  const restoreProject = async (id) => {
    setActionLoading(id + '-restore');
    try {
      await fetch(`${API}/api/projects/${id}/restore`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      setArchivedProjects(prev => prev.filter(p => p.id !== id));
    } catch (err) { console.error('Restore project error:', err); }
    setActionLoading(null);
  };

  const deleteProject = async (id) => {
    setActionLoading(id + '-delete');
    try {
      await fetch(`${API}/api/projects/${id}?userId=${userId}`, { method: 'DELETE' });
      setArchivedProjects(prev => prev.filter(p => p.id !== id));
      setConfirmDeleteId(null);
    } catch (err) { console.error('Delete project error:', err); }
    setActionLoading(null);
  };

  const formatDate = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const tabs = [
    { id: 'sessions', label: 'Sessions', count: archivedSessions.length },
    { id: 'projects', label: 'Projects', count: archivedProjects.length },
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
        <div className='page-title' style={{ margin: 0 }}>Archive</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--border)' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: '8px 14px', fontSize: 13, border: 'none', background: 'transparent', cursor: 'pointer',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.id ? 600 : 400, marginBottom: -1, transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 6 }}>
            {tab.label}
            {!loading && tab.count > 0 && (
              <span style={{ fontSize: 10, background: activeTab === tab.id ? 'var(--accent)' : 'var(--surface)',
                color: activeTab === tab.id ? 'white' : 'var(--text-muted)',
                padding: '1px 6px', borderRadius: 10, fontWeight: 500 }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>}

      {/* Sessions tab */}
      {!loading && activeTab === 'sessions' && (
        <>
          {archivedSessions.length === 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '32px 24px',
              textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No archived sessions.
            </div>
          )}
          {archivedSessions.map(s => (
            <div key={s.id} className='card' style={{ cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className='card-title' style={{ cursor: 'pointer' }}
                    onClick={() => { setActiveSessionId(s.id); setView('chat'); }}>
                    {s.title || 'Untitled session'}
                  </div>
                  {s.summary && (
                    <div className='card-meta' style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'normal' }}>
                      {s.summary}
                    </div>
                  )}
                  <div className='card-meta' style={{ marginTop: 6 }}>
                    Archived {formatDate(s.archived_at)}
                    {s.project_id && <span style={{ marginLeft: 8, color: 'var(--accent)' }}>· Project session</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className='btn btn-secondary' style={{ fontSize: 12 }}
                    disabled={actionLoading === s.id + '-restore'}
                    onClick={() => restoreSession(s.id)}>
                    {actionLoading === s.id + '-restore' ? 'Restoring...' : 'Restore'}
                  </button>
                  <button className='btn btn-secondary' style={{ fontSize: 12 }}
                    onClick={() => setConfirmDeleteId(s.id)}>Delete</button>
                </div>
              </div>
              {confirmDeleteId === s.id && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--surface)',
                  borderRadius: 'var(--radius)', fontSize: 13, display: 'flex',
                  alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    Permanently delete this session? This cannot be undone.
                  </span>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button className='btn btn-danger' style={{ fontSize: 12 }}
                      disabled={actionLoading === s.id + '-delete'}
                      onClick={() => deleteSession(s.id)}>
                      {actionLoading === s.id + '-delete' ? 'Deleting...' : 'Delete permanently'}
                    </button>
                    <button className='btn btn-secondary' style={{ fontSize: 12 }}
                      onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* Projects tab */}
      {!loading && activeTab === 'projects' && (
        <>
          {archivedProjects.length === 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '32px 24px',
              textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No archived projects.
            </div>
          )}
          {archivedProjects.map(p => (
            <div key={p.id} className='card' style={{ cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className='card-title'>{p.name}</div>
                  {p.description && (
                    <div className='card-meta' style={{ marginTop: 4, whiteSpace: 'normal' }}>
                      {p.description.slice(0, 160)}{p.description.length > 160 ? '...' : ''}
                    </div>
                  )}
                  <div className='card-meta' style={{ marginTop: 6 }}>
                    Archived {formatDate(p.archived_at)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className='btn btn-secondary' style={{ fontSize: 12 }}
                    disabled={actionLoading === p.id + '-restore'}
                    onClick={() => restoreProject(p.id)}>
                    {actionLoading === p.id + '-restore' ? 'Restoring...' : 'Restore'}
                  </button>
                  <button className='btn btn-secondary' style={{ fontSize: 12 }}
                    onClick={() => setConfirmDeleteId(p.id)}>Delete</button>
                </div>
              </div>
              {confirmDeleteId === p.id && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--surface)',
                  borderRadius: 'var(--radius)', fontSize: 13, display: 'flex',
                  alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    Permanently delete this project? This cannot be undone.
                  </span>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button className='btn btn-danger' style={{ fontSize: 12 }}
                      disabled={actionLoading === p.id + '-delete'}
                      onClick={() => deleteProject(p.id)}>
                      {actionLoading === p.id + '-delete' ? 'Deleting...' : 'Delete permanently'}
                    </button>
                    <button className='btn btn-secondary' style={{ fontSize: 12 }}
                      onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
