import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Sidebar from './components/Sidebar';
import Auth from './components/Auth';
import ProfilePage from './pages/ProfilePage';
import ChatPage from './pages/ChatPage';
import ProjectsPage from './pages/ProjectsPage';
import LibraryPage from './pages/LibraryPage';
import SettingsPage from './pages/SettingsPage';
import ArchivePage from './pages/ArchivePage';

const API = import.meta.env.VITE_API_URL;

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('chat');
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeProject, setActiveProject] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modules, setModules] = useState([]);
  const [activeModule, setActiveModule] = useState(null);
  const [modulesLoading, setModulesLoading] = useState(false);

  useEffect(() => {
    const setVh = () => {
      document.documentElement.style.setProperty('--real-vh', window.innerHeight + 'px');
    };
    setVh();
    window.addEventListener('resize', setVh);
    window.addEventListener('orientationchange', setVh);
    return () => {
      window.removeEventListener('resize', setVh);
      window.removeEventListener('orientationchange', setVh);
    };
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // Load modules when session is available
  useEffect(() => {
    if (!session) return;
    setModulesLoading(true);
    fetch(`${API}/api/modules?userId=${session.user.id}`)
      .then(r => r.json())
      .then(data => {
        const mods = Array.isArray(data) ? data : [];
        setModules(mods);
        if (mods.length === 1) {
          // Only one module -- auto-select it
          selectModule(mods[0], session.user.id);
        } else if (mods.length > 1) {
          // Multiple modules -- check last active
          supabase.from('profiles')
            .select('last_active_module')
            .eq('id', session.user.id)
            .single()
            .then(({ data: profile }) => {
              if (profile?.last_active_module) {
                const last = mods.find(m => m.id === profile.last_active_module);
                if (last) { selectModule(last, session.user.id); return; }
              }
              // No last active -- show selector (activeModule stays null)
            });
        }
        setModulesLoading(false);
      })
      .catch(() => setModulesLoading(false));
  }, [session]);

  const selectModule = (mod, userId) => {
    setActiveModule(mod);
    // Save last active
    fetch(`${API}/api/modules/last-active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId || session?.user?.id, moduleId: mod.id }),
    }).catch(() => {});
  };

  if (loading || modulesLoading) return (
    <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading...</div>
  );

  if (!session) return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg)' }}>
      <Auth />
    </div>
  );

  // Module selector -- shown when user has multiple modules and none is active yet
  if (modules.length > 1 && !activeModule) return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 480, width: '100%', padding: '0 24px' }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
            AdvisoryHub
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Select a domain to get started
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {modules.map(mod => (
            <button key={mod.id} onClick={() => selectModule(mod)}
              style={{ padding: '20px 24px', background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 8, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                boxShadow: 'var(--shadow)' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                {mod.name}
              </div>
              {mod.description && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {mod.description}
                </div>
              )}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <button onClick={() => supabase.auth.signOut()}
            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none',
              cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );

  // No modules licensed -- show a plain error state
  if (modules.length === 0) return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--surface)' }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 15, color: 'var(--text-secondary)', marginBottom: 16 }}>
          No modules are assigned to your account. Contact your administrator.
        </div>
        <button className='btn btn-secondary' onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  );

  return (
    <>
      <Sidebar
        view={view} setView={setView} session={session}
        activeSessionId={activeSessionId} setActiveSessionId={setActiveSessionId}
        activeProject={activeProject} setActiveProject={setActiveProject}
        activeModule={activeModule} modules={modules} onSwitchModule={() => setActiveModule(null)}
        isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}
      />
      <div className='main'>
        {view === 'chat' && (
          <ChatPage
            session={session} activeSessionId={activeSessionId}
            setActiveSessionId={setActiveSessionId} activeProject={activeProject}
            activeModule={activeModule}
            onMenuOpen={() => setSidebarOpen(true)}
          />
        )}
        {view === 'profile' && (
          <ProfilePage
            session={session}
            setView={setView}
            activeModule={activeModule}
            onMenuOpen={() => setSidebarOpen(true)}
          />
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
          <LibraryPage
            session={session}
            setView={setView}
            onMenuOpen={() => setSidebarOpen(true)}
          />
        )}
        {view === 'settings' && (
          <SettingsPage session={session} onMenuOpen={() => setSidebarOpen(true)} />
        )}
        {view === 'archive' && (
          <ArchivePage
            session={session}
            setActiveSessionId={setActiveSessionId}
            setView={setView}
            onMenuOpen={() => setSidebarOpen(true)}
          />
        )}
      </div>
    </>
  );
}
