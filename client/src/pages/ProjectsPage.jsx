function ProjectMemoriesTab({ projectId }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    // Get all session IDs for this project
    const { data: projectSessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('project_id', projectId);

    const sessionIds = new Set((projectSessions || []).map(s => s.id));

    // Fetch embeddings -- include those with a matching session_id
    // OR those with null session_id that belong to this user
    // (catches memories stored before a session had messages)
    const { data: allEmbeddings } = await supabase
      .from('session_embeddings')
      .select('id, content, created_at, session_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (allEmbeddings) {
      setMemories(allEmbeddings.filter(m =>
        m.session_id && sessionIds.has(m.session_id)
      ));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [projectId]);

  const deleteMemory = async (id) => {
    await supabase.from('session_embeddings').delete().eq('id', id);
    load();
  };

  const formatContent = (content) => content
    .replace('[PINNED NOTE] ', '').replace('[AUTO-CAPTURED] ', '').trim();

  const getTag = (content) => {
    if (content.startsWith('[PINNED NOTE]')) return { label: 'Pinned', color: 'var(--accent)' };
    if (content.startsWith('[AUTO-CAPTURED]')) return { label: 'Auto-captured', color: '#2e7d32' };
    return { label: 'Memory', color: 'var(--text-muted)' };
  };

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading memories...</p>;

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Notes and memories the AI has captured from sessions in this project.
      </div>
      {memories.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No memories yet. They are created automatically as you work in this project.</p>
      )}
      {memories.map(m => {
        const tag = getTag(m.content);
        return (
          <div key={m.id} className='card'
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: tag.color, fontWeight: 600 }}>{tag.label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {new Date(m.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                {formatContent(m.content)}
              </div>
            </div>
            <button className='btn btn-danger' style={{ fontSize: 11, marginLeft: 12, flexShrink: 0 }}
              onClick={() => deleteMemory(m.id)}>Delete</button>
          </div>
        );
      })}
    </div>
  );
}

function ProjectHistoryTab({ projectId, setActiveSessionId, setView, onClose }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Use RPC to only fetch sessions that have at least one message
    supabase.rpc('get_sessions_with_messages', {
      p_user_id: (async () => (await supabase.auth.getUser()).data.user.id)()
    }).then(async ({ data }) => {
      // Filter to this project and get user id properly
      const { data: { user } } = await supabase.auth.getUser();
      const { data: sessions } = await supabase
        .from('sessions')
        .select('id, title, summary, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      // Cross-reference with sessions that have messages
      const withMessages = await supabase.rpc('get_sessions_with_messages', { p_user_id: user.id });
      const messageSessionIds = new Set((withMessages.data || []).map(s => s.id));
      setSessions((sessions || []).filter(s => messageSessionIds.has(s.id)));
      setLoading(false);
    });
  }, [projectId]);

  const groupByDate = (sessions) => {
    const groups = {}; const order = [];
    for (const s of sessions) {
      const diffDays = Math.floor((new Date() - new Date(s.created_at)) / (1000 * 60 * 60 * 24));
      const label = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Yesterday' : diffDays <= 7 ? 'This week' :
        diffDays <= 30 ? 'This month' : new Date(s.created_at).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      if (!groups[label]) { groups[label] = []; order.push(label); }
      groups[label].push(s);
    }
    return order.map(g => ({ label: g, sessions: groups[g] }));
  };

  const openSession = (sessionId) => { setActiveSessionId(sessionId); setView('chat'); onClose(); };

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading sessions...</p>;
  if (sessions.length === 0) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No sessions in this project yet.</p>;

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
        All sessions linked to this project. Click a session to open it.
      </div>
      {groupByDate(sessions).map(group => (
        <div key={group.label} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
            {group.label}
          </div>
          {group.sessions.map(s => (
            <div key={s.id} className='card' onClick={() => openSession(s.id)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className='card-title' style={{ marginBottom: 4 }}>{s.title || 'Untitled session'}</div>
                  {s.summary && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      {s.summary.slice(0, 120)}{s.summary.length > 120 ? '...' : ''}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 12, flexShrink: 0 }}>
                  {new Date(s.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}