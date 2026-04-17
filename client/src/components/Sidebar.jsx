import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const NAV = [
  { id: 'chat', label: 'New Chat', icon: '💬' },
  { id: 'profile', label: 'Profile', icon: '👤' },
  { id: 'projects', label: 'Projects', icon: '📁' },
  { id: 'library', label: 'Library', icon: '📚' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'archive', label: 'Archive', icon: '◫' },
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

export default function Sidebar({
  view, setView, session,
  activeSessionId, setActiveSessionId,
  activeProject, setActiveProject,
  activeModule, modules, onSwitchModule,
  isOpen, onClose,
}) {
  const [sessions, setSessions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectFilter, setProjectFilter] = useState('all');
  const [expandedProjectId, setExpandedProjectId] = useState(null);
  const [sessionMenuId, setSessionMenuId] = useState(null);
  const [firstName, setFirstName] = useState('');

  const loadSessions = () => {
    supabase.rpc('get_sessions_with_messages', { p_user_id: session.user.id })
      .limit(60)
      .then(({ data }) => { if (data) setSessions(data); });
  };

  useEffect(() => {
    if (!session) return;
    loadSessions();
    supabase.from('projects')
      .select('id, name, parent_id')
      .eq('user_id', session.user.id)
      .order('name')
      .then(({ data }) => { if (data) setProjects(data); });
    supabase.from('profiles')
      .select('first_name')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => { if (data?.first_name) setFirstName(data.first_name); });
  }, [session, activeSessionId]);

  const topLevel = projects.filter(p => !p.parent_id);
  const subProjects = projects.filter(p => p.parent_id);

  useEffect(() => {
    if (!activeProject) {
      setProjectFilter('all');
      setExpandedProjectId(null);
    } else {
      setProjectFilter(activeProject.id);
      const isSubProject = subProjects.some(sp => sp.id === activeProject.id);
      if (isSubProject) {
        const parent = projects.find(p => p.id === activeProject.parent_id);
        if (parent) setExpandedProjectId(parent.id);
      } else {
        setExpandedProjectId(activeProject.id);
      }
    }
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

  const handleArchiveSession = async (e, sessionId) => {
    e.stopPropagation();
    setSessionMenuId(null);
    try {
      await fetch(`${import.meta.env.VITE_API_URL}/api/sessions/${sessionId}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.user.id }),
      });
      if (activeSessionId === sessionId) setActiveSessionId(null);
      loadSessions();
    } catch (err) {
      console.error('Archive session error:', err);
    }
  };

  const handleTopLevelPill = (projectId) => {
    if (projectId === 'all' || projectId === 'none') {
      setProjectFilter(projectId);
      setExpandedProjectId(null);
      setActiveProject(null);
      return;
    }
    const fullProject = projects.find(p => p.id === projectId);
    if (projectFilter === projectId && expandedProjectId === projectId) {
      setExpandedProjectId(null);
    } else {
      setExpandedProjectId(projectId);
    }
    setProjectFilter(projectId);
    if (fullProject) setActiveProject(fullProject);
  };

  const handleSubProjectPill = (subProjectId) => {
    const fullProject = projects.find(p => p.id === subProjectId);
    setProjectFilter(subProjectId);
    if (fullProject) setActiveProject(fullProject);
  };

  const filteredSessions = sessions.filter(s => {
    if (projectFilter === 'all') return true;
    if (projectFilter === 'none') return !s.project_id;
    const filterIsSubProject = subProjects.some(sp => sp.id === projectFilter);
    if (filterIsSubProject) return s.project_id === projectFilter;
    if (s.project_id === projectFilter) return true;
    const sub = subProjects.find(sp => sp.id === s.project_id);
    return sub?.parent_id === projectFilter;
  });

  const groups = groupSessions(filteredSessions);
  const showSwitchModule = modules && modules.length > 1;

  return (
    <>
      <div className={`sidebar-overlay ${isOpen ? 'visible' : ''}`} onClick={onClose} />
      <div className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <div className='sidebar-header'>
          <div>
            <span className='sidebar-logo'>AdvisoryHub</span>
            {firstName && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Hi {firstName}
              </div>
            )}
          </div>
          {activeModule && (
            <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--accent)',
              background: 'rgba(0,145,164,0.08)', padding: '2px 8px', borderRadius: 10,
              fontWeight: 500, flexShrink: 0 }}>
              {activeModule.name}
            </div>
          )}
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
            onClick={() => handleTopLevelPill('all')}>All</button>
          <button
            className={`project-filter-pill ${projectFilter === 'none' ? 'active' : ''}`}
            onClick={() => handleTopLevelPill('none')}>No project</button>
          {topLevel.map(p => {
            const subs = subProjects.filter(sp => sp.parent_id === p.id);
            const isExpanded = expandedProjectId === p.id;
            const isActive = projectFilter === p.id;
            return (
              <div key={p.id} style={{ display: 'contents' }}>
                <button
                  className={`project-filter-pill ${isActive ? 'active' : ''}`}
                  onClick={() => handleTopLevelPill(p.id)}>
                  {p.name.length > 16 ? p.name.slice(0, 16) + '…' : p.name}
                  {subs.length > 0 && (
                    <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.7 }}>
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  )}
                </button>
                {isExpanded && subs.map(sp => (
                  <button key={sp.id}
                    className={`project-filter-pill project-filter-pill-sub ${projectFilter === sp.id ? 'active' : ''}`}
                    onClick={() => handleSubProjectPill(sp.id)}>
                    ↳ {sp.name.length > 14 ? sp.name.slice(0, 14) + '…' : sp.name}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className='sidebar-sessions' onClick={() => setSessionMenuId(null)}>
          {groups.map(group => (
            <div key={group.label}>
              <div className='sidebar-section'>{group.label}</div>
              {group.sessions.map(s => {
                const menuOpen = sessionMenuId === s.id;
                const tooltipText = (s.title || 'New session') + ' · ' +
                  new Date(s.created_at).toLocaleString('en-AU', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                  });
                return (
                  <div
                    key={s.id}
                    className={`session-item ${activeSessionId === s.id ? 'active' : ''}`}
                    title={tooltipText}
                    onClick={() => handleSession(s.id)}
                  >
                    <span className='session-title'>{s.title || 'New session'}</span>
                    <span className='session-time'>{formatTime(s.created_at)}</span>
                    <button
                      className='session-menu-btn'
                      onClick={(e) => {
                        e.stopPropagation();
                        setSessionMenuId(menuOpen ? null : s.id);
                      }}
                      title='Session options'
                    >
                      ···
                    </button>
                    {menuOpen && (
                      <div className='session-menu-dropdown' onClick={e => e.stopPropagation()}>
                        <button onClick={(e) => handleArchiveSession(e, s.id)}>
                          Archive session
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {filteredSessions.length === 0 && (
            <div style={{ padding: '16px', fontSize: 12, color: 'var(--text-muted)' }}>
              {projectFilter === 'all' ? 'No sessions yet' : 'No sessions for this filter'}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 8 }}>
          {showSwitchModule && (
            <button className='btn btn-secondary' style={{ width: '100%', fontSize: 12 }}
              onClick={() => { onSwitchModule && onSwitchModule(); onClose && onClose(); }}>
              ⇄ Switch domain
            </button>
          )}
          <button className='btn btn-secondary' style={{ width: '100%', fontSize: 12 }}
            onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    </>
  );
}
