
import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Sidebar from './components/Sidebar';
import Auth from './components/Auth';
import ProfilePage from './pages/ProfilePage';


export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('chat');
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeProject, setActiveProject] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading...</div>;
if (!session) return <Auth />;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar view={view} setView={setView} session={session}
        activeSessionId={activeSessionId} setActiveSessionId={setActiveSessionId}
        activeProject={activeProject} />
      <div className='main'>
        <div style={{ padding: 40, color: 'var(--text-muted)' }}>
          {view === 'chat' && <p>Chat coming in Phase 4</p>}
          {view === 'profile' && <ProfilePage session={session} />}
          {view === 'projects' && <p>Projects coming in Phase 5</p>}
          {view === 'library' && <p>Library coming in Phase 7</p>}
        </div>
      </div>
    </div>
  );
}
