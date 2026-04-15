import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Sidebar from './components/Sidebar';
import Auth from './components/Auth';
import ProfilePage from './pages/ProfilePage';
import ChatPage from './pages/ChatPage';
import ProjectsPage from './pages/ProjectsPage';
import LibraryPage from './pages/LibraryPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('chat');
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeProject, setActiveProject] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading...</div>;

  if (!session) return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg)' }}>
      <Auth />
    </div>
  );

  return (
    <>
      <Sidebar
        view={view} setView={setView} session={session}
        activeSessionId={activeSessionId} setActiveSessionId={setActiveSessionId}
        activeProject={activeProject}
        isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}
      />
      <div className='main'>
        {view === 'chat' && (
          <ChatPage
            session={session} activeSessionId={activeSessionId}
            setActiveSessionId={setActiveSessionId} activeProject={activeProject}
            onMenuOpen={() => setSidebarOpen(true)}
          />
        )}
        {view === 'profile' && (
          <ProfilePage session={session} onMenuOpen={() => setSidebarOpen(true)} />
        )}
        {view === 'projects' && (
          <ProjectsPage
            session={session} activeProject={activeProject}
            setActiveProject={setActiveProject} setView={setView}
            onMenuOpen={() => setSidebarOpen(true)}
            setActiveSessionId={setActiveSessionId}
          />
        )}
        {view === 'library' && (
          <LibraryPage session={session} onMenuOpen={() => setSidebarOpen(true)} />
        )}
        {view === 'settings' && (
          <SettingsPage session={session} onMenuOpen={() => setSidebarOpen(true)} />
        )}
      </div>
    </>
  );
}