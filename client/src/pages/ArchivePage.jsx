import { useState, useEffect } from 'react';

export default function ArchivePage({ session, setActiveSessionId, setView }) {
  const [archivedSessions, setArchivedSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  const apiUrl = import.meta.env.VITE_API_URL;
  const userId = session.user.id;

  useEffect(() => {
    loadArchived();
  }, []);

  const loadArchived = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/sessions/archived?userId=${userId}`);
      const data = await res.json();
      setArchivedSessions(data);
    } catch (err) {
      console.error('Load archived error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (sessionId) => {
    setActionLoading(sessionId + '-restore');
    try {
      await fetch(`${apiUrl}/api/sessions/${sessionId}/restore`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      setArchivedSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch (err) {
      console.error('Restore error:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (sessionId) => {
    setActionLoading(sessionId + '-delete');
    try {
      await fetch(`${apiUrl}/api/sessions/${sessionId}?userId=${userId}`, {
        method: 'DELETE',
      });
      setArchivedSessions(prev => prev.filter(s => s.id !== sessionId));
      setConfirmDeleteId(null);
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Archive</h1>
        {!loading && archivedSessions.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {archivedSessions.length} session{archivedSessions.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
      )}

      {!loading && archivedSessions.length === 0 && (
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '32px 24px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}>
          No archived sessions. Archive a session from the sidebar or session menu.
        </div>
      )}

      {!loading && archivedSessions.map(s => (
        <div key={s.id} className="card" style={{ cursor: 'default' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="card-title"
                style={{ cursor: 'pointer', color: 'var(--text-primary)' }}
                onClick={() => {
                  setActiveSessionId(s.id);
                  setView('chat');
                }}
              >
                {s.title || 'Untitled session'}
              </div>
              {s.summary && (
                <div className="card-meta" style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'normal' }}>
                  {s.summary}
                </div>
              )}
              <div className="card-meta" style={{ marginTop: 6 }}>
                <span>Archived {formatDate(s.archived_at)}</span>
                {s.project_id && (
                  <span style={{ marginLeft: 8, color: 'var(--accent)' }}>· Project session</span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: '5px 12px' }}
                disabled={actionLoading === s.id + '-restore'}
                onClick={() => handleRestore(s.id)}
              >
                {actionLoading === s.id + '-restore' ? 'Restoring...' : 'Restore'}
              </button>
              <button
                className="btn"
                style={{ fontSize: 12, padding: '5px 12px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                onClick={() => setConfirmDeleteId(s.id)}
              >
                Delete
              </button>
            </div>
          </div>

          {/* Inline confirm delete */}
          {confirmDeleteId === s.id && (
            <div style={{
              marginTop: 12,
              padding: '10px 14px',
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                Permanently delete this session and all its messages? This cannot be undone.
              </span>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  className="btn btn-danger"
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  disabled={actionLoading === s.id + '-delete'}
                  onClick={() => handleDelete(s.id)}
                >
                  {actionLoading === s.id + '-delete' ? 'Deleting...' : 'Delete permanently'}
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  onClick={() => setConfirmDeleteId(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
