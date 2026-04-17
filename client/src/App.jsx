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

const FUTURE_MODULES = [
  { name: 'Procurement' },
  { name: 'Asset Management' },
  { name: 'Cyber Security' },
  { name: 'Insurance' },
  { name: 'Council and Policymaking' },
  { name: 'Environmental' },
  { name: 'Safety' },
  { name: 'Communications' },
  { name: 'Financial Management' },
  { name: 'Technology Management' },
];

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

  useEffect(() => {
    if (!session) return;
    setModulesLoading(true);
    fetch(`${API}/api/modules?userId=${session.user.id}`)
      .then(r => r.json())
      .then(data => {
        const mods = Array.isArray(data) ? data : [];
        setModules(mods);
        if (mods.length === 1) {
          selectModule(mods[0], session.user.id);
        } else if (mods.length > 1) {
          supabase.from('profiles')
            .select('last_active_module')
            .eq('id', session.user.id)
            .single()
            .then(({ data: profile }) => {
              if (profile?.last_active_module) {
                const last = mods.find(m => m.id === profile.last_active_module);
                if (last) { selectModule(last, session.user.id); return; }
              }
            });
        }
        setModulesLoading(false);
      })
      .catch(() => setModulesLoading(false));
  }, [session]);

  const selectModule = (mod, userId) => {
    setActiveModule(mod);
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

  // Module selector
  if (modules.length > 1 && !activeModule) return (
    <div style={{ width: '100vw', height: '100vh', overflowY: 'auto',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      background: 'var(--surface)', padding: '48px 24px' }}>
      <div style={{ maxWidth: 600, width: '100%' }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
            AdvisoryHub
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Select a domain to get started
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {/* Licensed modules -- full colour, clickable */}
          {modules.map(mod => (
            <button key={mod.id} onClick={() => selectModule(mod)}
              style={{ padding: '18px 16px', background: 'var(--bg)',
                border: '1px solid var(--border)', borderRadius: 8,
                cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                boxShadow: 'var(--shadow)', minHeight: 80,
                display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,145,164,0.12)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                lineHeight: 1.3, marginBottom: mod.description ? 4 : 0 }}>
                {mod.name}
              </div>
              {mod.description && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {mod.description.length > 60 ? mod.description.slice(0, 60) + '…' : mod.description}
                </div>
              )}
            </button>
          ))}

          {/* Future modules -- same size, greyed out, not clickable */}
          {FUTURE_MODULES.map(mod => (
            <div key={mod.name}
              style={{ padding: '18px 16px', background: 'var(--bg)',
                border: '1px solid var(--border)', borderRadius: 8,
                cursor: 'default', minHeight: 80,
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                opacity: 0.35 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                lineHeight: 1.3 }}>
                {mod.name}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <button onClick={() => supabase.auth.signOut()}
            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none',
              border: 'none', cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );

  // No modules licensed
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
