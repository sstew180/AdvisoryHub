import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const NAV = [
  { id: 'chat', label: 'New Chat', icon: '💬' },
  { id: 'profile', label: 'Profile', icon: '👤' },
  { id: 'projects', label: 'Projects', icon: '📁' },
  { id: 'library', label: 'Library', icon: '📚' },
];

export default function Sidebar({ view, setView, session, activeSessionId, setActiveSessionId }) {
  const [sessions, setSessions] = useState([]);
  const [favorites, setFavorites] = useState([]);

  useEffect(() => {
    if (!session) return;
    supabase.from('sessions')
      .select('id, title, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (data) {
          setFavorites(data.slice(0, 2));
          setSessions(data.slice(2));
        }
      });
  }, [session, activeSessionId]);

  return (
    <div className='sidebar'>
      <div className='sidebar-header'>
        <span className='sidebar-logo'>AdvisoryHub</span>
      </div>
      <nav className='sidebar-nav'>
        {NAV.map(item => (
          <div key={item.id}
            className={`nav-item ${view === item.id && item.id !== 'chat' ? 'active' : ''}`}
            onClick={() => item.id === 'chat' ? (setActiveSessionId(null), setView('chat')) : setView(item.id)}>
            <span>{item.icon}</span><span>{item.label}</span>
          </div>
        ))}
      </nav>
      <div className='sidebar-sessions'>
        {favorites.length > 0 && <>
          <div className='sidebar-section'>Favorites</div>
          {favorites.map(s => (
            <div key={s.id}
              className={`session-item ${activeSessionId === s.id ? 'active' : ''}`}
              onClick={() => { setActiveSessionId(s.id); setView('chat'); }}>
              {s.title || 'New session'}
            </div>
          ))}
        </>}
        {sessions.length > 0 && <>
          <div className='sidebar-section'>Recents</div>
          {sessions.map(s => (
            <div key={s.id}
              className={`session-item ${activeSessionId === s.id ? 'active' : ''}`}
              onClick={() => { setActiveSessionId(s.id); setView('chat'); }}>
              {s.title || 'New session'}
            </div>
          ))}
        </>}
      </div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
        <button className='btn btn-secondary' style={{ width: '100%', fontSize: 12 }}
          onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  );
}
