import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;
const CATS = ['All', 'Framework', 'Legislation', 'Best Practice', 'Consulting', 'Skills', 'Templates', 'Organisation', 'Communication'];

export default function LibraryPage({ session }) {
  const [docs, setDocs] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('All');
  const [form, setForm] = useState({
    title: '', category: 'Framework', domain: 'Risk & Audit',
    jurisdiction: 'Queensland', description: '', sourceUrl: ''
  });

  const loadDocs = () => {
    setLoading(true);
    setError(null);
    axios.get(API + '/api/library')
      .then(r => { setDocs(r.data); setLoading(false); })
      .catch(() => { setError('Could not load library. The server may be starting up -- try again in 30 seconds.'); setLoading(false); });
  };

  useEffect(() => {
    loadDocs();
    supabase.from('profiles').select('access_tier').eq('id', session.user.id).single()
      .then(({ data }) => setIsAdmin(data?.access_tier === 'admin'));
  }, []);

  const upload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    fd.append('file', file);
    await axios.post(API + '/api/library/upload', fd);
    loadDocs();
    setUploading(false);
  };

  const filtered = filter === 'All' ? docs : docs.filter(d => d.category === filter);

  const categoryBadgeStyle = (cat) => {
    const colours = {
      'Framework': { bg: '#e8f4f8', color: '#0091a4' },
      'Legislation': { bg: '#fdf0e8', color: '#c67a2e' },
      'Best Practice': { bg: '#eaf4ea', color: '#2e7d32' },
      'Consulting': { bg: '#f3eafa', color: '#6a3aab' },
      'Skills': { bg: '#e8f0fa', color: '#1a5cb5' },
      'Templates': { bg: '#fdf5e8', color: '#b57a1a' },
      'Organisation': { bg: '#fae8e8', color: '#b52a2a' },
      'Communication': { bg: '#f0f0ec', color: '#6b6b6b' },
    };
    return colours[cat] || { bg: '#f0f0ec', color: '#6b6b6b' };
  };

  return (
    <div className='page'>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div className='page-title' style={{ margin: 0 }}>Library</div>
        {error && (
          <button className='btn btn-secondary' style={{ fontSize: 12 }} onClick={loadDocs}>Retry</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {CATS.map(c => (
          <button key={c} className={'btn ' + (filter === c ? 'btn-primary' : 'btn-secondary')}
            style={{ fontSize: 12 }} onClick={() => setFilter(c)}>{c}</button>
        ))}
      </div>

      {isAdmin && (
        <div className='card' style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>Upload document</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Skills, Templates, and Organisation documents are injected into every Guided mode response automatically.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Title</label>
              <input className='form-input' value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Category</label>
              <select className='form-select' value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATS.slice(1).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Jurisdiction</label>
              <input className='form-input' value={form.jurisdiction} onChange={e => setForm(f => ({ ...f, jurisdiction: e.target.value }))} />
            </div>
            <div className='form-group' style={{ margin: 0 }}>
              <label className='form-label'>Source URL (optional)</label>
              <input className='form-input' value={form.sourceUrl} onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))} />
            </div>
          </div>
          <div className='form-group'>
            <label className='form-label'>Description</label>
            <input className='form-input' value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <label className='btn btn-primary' style={{ cursor: 'pointer', fontSize: 13 }}>
            {uploading ? 'Uploading and embedding...' : 'Choose file and upload'}
            <input type='file' style={{ display: 'none' }} accept='.pdf,.docx,.txt,.md' onChange={upload} />
          </label>
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading library...</p>}

      {error && !loading && (
        <div style={{ padding: 16, background: 'var(--surface)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!loading && !error && filtered.map(d => {
        const badge = categoryBadgeStyle(d.category);
        const isAutoInjected = ['Skills', 'Templates', 'Organisation'].includes(d.category);
        return (
          <div key={d.id} className='card'>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <div className='card-title' style={{ margin: 0 }}>{d.title}</div>
                  <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                    background: badge.bg, color: badge.color, fontWeight: 500 }}>
                    {d.category}
                  </span>
                  {isAutoInjected && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: '#e8f4f8', color: '#0091a4', fontWeight: 500 }}>
                      Always on
                    </span>
                  )}
                </div>
                <div className='card-meta'>{d.jurisdiction}</div>
                {d.description && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{d.description}</div>
                )}
              </div>
              {d.source_url && (
                <a href={d.source_url} target='_blank' rel='noopener noreferrer'
                  style={{ fontSize: 12, color: 'var(--accent)', marginLeft: 16, whiteSpace: 'nowrap' }}>
                  Source &rarr;
                </a>
              )}
            </div>
          </div>
        );
      })}

      {!loading && !error && filtered.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>No documents in this category yet.</p>
      )}
    </div>
  );
}