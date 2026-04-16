import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const NAV = [
  { id: 'chat', label: 'New Chat', icon: '💬' },
  { id: 'profile', label: 'Profile', icon: '👤' },
  { id: 'projects', label: 'Projects', icon: '📁' },
  { id: 'library', label: 'Library', icon: '📚' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

function getDateGroup(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'This week';
  if (diffDays <= 30) return 'This month';
  return date.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

function formatTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  if (diffDays <= 7) return date.toLocaleDateString('en-AU', { weekday: 'short' });
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function groupSessions(sessions) {
  const groups = {};
  const order = [];
  for (const s of sessions) {
    const group = getDateGroup(s.created_at);
    if (!groups[group]) { groups[group] = []; order.push(group); }
    groups[group].push(s);
  }
  return order.map(g => ({ label: g, sessions: groups[g] }));
}

export default function Sidebar({ view, setView, session, activeSessionId, setActiveSessionId, activeProject, setActiveProject, isOpen, onClose }) {
  const [sessions, setSessions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectFilter, setProjectFilter] = useState('all');

  useEffect(() => {
    if (!session) return;
    // Use RPC to only fetch sessions that have at least one message
    supabase.rpc('get_sessions_with_messages', { p_user_id: session.user.id })
      .limit(60)
      .then(({ data }) => { if (data) setSessions(data); });

    supabase.from('projects')
      .select('id, name, parent_id')
      .eq('user_id', session.user.id)
      .order('name')
      .then(({ data }) => { if (data) setProjects(data); });
  }, [session, activeSessionId]);

  useEffect(() => {
    if (!activeProject) setProjectFilter('all');
    else setProjectFilter(activeProject.id);
  }, [activeProject]);

  const handleNav = (id) => {
    if (id === 'chat') { setActiveSessionId(null); setView('chat'); }
    else setView(id);
    onClose && onClose();
  };

  const handleSession = (id) => {
    setActiveSessionId(id);
    setView('chat');
    onClose && onClose();
  };

  const handleProjectPill = (projectId) => {
    setProjectFilter(projectId);
    if (projectId === 'all' || projectId === 'none') {
      setActiveProject(null);
    } else {
      const fullProject = projects.find(p => p.id === projectId);
      if (fullProject) setActiveProject(fullProject);
    }
  };

  const topLevel = projects.filter(p => !p.parent_id);
  const subProjects = projects.filter(p => p.parent_id);

  const filteredSessions = sessions.filter(s => {
    if (projectFilter === 'all') return true;
    if (projectFilter === 'none') return !s.project_id;
    if (s.project_id === projectFilter) return true;
    const sub = subProjects.find(sp => sp.id === s.project_id);
    return sub?.parent_id === projectFilter;
  });

  const groups = groupSessions(filteredSessions);

  return (
    <>
      <div className={`sidebar-overlay ${isOpen ? 'visible' : ''}`} onClick={onClose} />
      <div className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <div className='sidebar-header'>
          <span className='sidebar-logo'>AdvisoryHub</span>
        </div>
        <nav className='sidebar-nav'>
          {NAV.map(item => (
            <div key={item.id}
              className={`nav-item ${view === item.id && item.id !== 'chat' ? 'active' : ''}`}
              onClick={() => handleNav(item.id)}>
              <span>{item.icon}</span><span>{item.label}</span>
            </div>
          ))}
        </nav>
        <div className='project-filter'>
          <button
            className={`project-filter-pill ${projectFilter === 'all' ? 'active' : ''}`}
            onClick={() => handleProjectPill('all')}>
            All
          </button>
          <button
            className={`project-filter-pill ${projectFilter === 'none' ? 'active' : ''}`}
            onClick={() => handleProjectPill('none')}>
            No project
          </button>
          {topLevel.map(p => (
            <div key={p.id} style={{ display: 'contents' }}>
              <button
                className={`project-filter-pill ${projectFilter === p.id ? 'active' : ''}`}
                onClick={() => handleProjectPill(p.id)}>
                {p.name.length > 18 ? p.name.slice(0, 18) + '…' : p.name}
              </button>
              {subProjects.filter(sp => sp.parent_id === p.id).map(sp => (
                <button key={sp.id}
                  className={`project-filter-pill project-filter-pill-sub ${projectFilter === sp.id ? 'active' : ''}`}
                  onClick={() => handleProjectPill(sp.id)}>
                  ↳ {sp.name.length > 15 ? sp.name.slice(0, 15) + '…' : sp.name}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className='sidebar-sessions'>
          {groups.map(group => (
            <div key={group.label}>
              <div className='sidebar-section'>{group.label}</div>
              {group.sessions.map(s => (
                <div key={s.id}
                  className={`session-item ${activeSessionId === s.id ? 'active' : ''}`}
                  title={(s.title || 'New session') + ' · ' + new Date(s.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  onClick={() => handleSession(s.id)}>
                  <span className='session-title'>{s.title || 'New session'}</span>
                  <span className='session-time' style={{ flexShrink: 0 }}>{formatTime(s.created_at)}</span>
                </div>
              ))}
            </div>
          ))}
          {filteredSessions.length === 0 && (
            <div style={{ padding: '16px', fontSize: 12, color: 'var(--text-muted)' }}>
              {projectFilter === 'all' ? 'No sessions yet' : 'No sessions for this filter'}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <button className='btn btn-secondary' style={{ width: '100%', fontSize: 12 }}
            onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    </>
  );
}