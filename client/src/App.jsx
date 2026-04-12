import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Sidebar from './components/Sidebar';
import Auth from './components/Auth';
import ProfilePage from './pages/ProfilePage';
import ChatPage from './pages/ChatPage';
import ProjectsPage from './pages/ProjectsPage';
import LibraryPage from './pages/LibraryPage';

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
  if (!session) return <Auth />;

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
          <div className='page'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <button className='hamburger' onClick={() => setSidebarOpen(true)} aria-label='Open menu'>
                <svg width='20' height='20' viewBox='0 0 20 20' fill='none'>
                  <rect x='2' y='4' width='16' height='2' rx='1' fill='currentColor'/>
                  <rect x='2' y='9' width='16' height='2' rx='1' fill='currentColor'/>
                  <rect x='2' y='14' width='16' height='2' rx='1' fill='currentColor'/>
                </svg>
              </button>
            </div>
            <ProfilePage session={session} />
          </div>
        )}
        {view === 'projects' && (
          <ProjectsPage
            session={session} activeProject={activeProject}
            setActiveProject={setActiveProject} setView={setView}
            onMenuOpen={() => setSidebarOpen(true)}
          />
        )}
        {view === 'library' && (
          <LibraryPage session={session} onMenuOpen={() => setSidebarOpen(true)} />
        )}
      </div>
    </>
  );
}