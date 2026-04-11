import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import axios from 'axios';
const API = import.meta.env.VITE_API_URL;
const CATS = ['All','Framework','Legislation','Best Practice','Consulting','Skills','Communication'];

export default function LibraryPage({ session }) {
  const [docs, setDocs] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState('All');
  const [form, setForm] = useState({
    title:'', category:'Framework', domain:'Risk & Audit',
    jurisdiction:'Queensland', description:'', sourceUrl:''
  });

  useEffect(() => {
    axios.get(API + '/api/library').then(r => setDocs(r.data));
    supabase.from('profiles').select('access_tier').eq('id', session.user.id).single()
      .then(({ data }) => setIsAdmin(data?.access_tier === 'admin'));
  }, []);

  const upload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true);
    const fd = new FormData();
    Object.entries(form).forEach(([k,v]) => fd.append(k, v));
    fd.append('file', file);
    await axios.post(API + '/api/library/upload', fd);
    const r = await axios.get(API + '/api/library');
    setDocs(r.data); setUploading(false);
  };

  const filtered = filter === 'All' ? docs : docs.filter(d => d.category === filter);

  return (
    <div className='page'>
      <div className='page-title'>Library</div>
      <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
        {CATS.map(c => (
          <button key={c} className={'btn ' + (filter===c ? 'btn-primary' : 'btn-secondary')}
            style={{ fontSize:12 }} onClick={() => setFilter(c)}>{c}</button>
        ))}
      </div>
      {isAdmin && (
        <div className='card' style={{ marginBottom:24 }}>
          <div style={{ fontWeight:600, marginBottom:12, fontSize:14 }}>Upload document</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <div className='form-group' style={{ margin:0 }}>
              <label className='form-label'>Title</label>
              <input className='form-input' value={form.title} onChange={e => setForm(f=>({...f,title:e.target.value}))} /></div>
            <div className='form-group' style={{ margin:0 }}>
              <label className='form-label'>Category</label>
              <select className='form-select' value={form.category} onChange={e => setForm(f=>({...f,category:e.target.value}))}>
                {CATS.slice(1).map(c => <option key={c}>{c}</option>)}
              </select></div>
            <div className='form-group' style={{ margin:0 }}>
              <label className='form-label'>Jurisdiction</label>
              <input className='form-input' value={form.jurisdiction} onChange={e => setForm(f=>({...f,jurisdiction:e.target.value}))} /></div>
            <div className='form-group' style={{ margin:0 }}>
              <label className='form-label'>Source URL (optional)</label>
              <input className='form-input' value={form.sourceUrl} onChange={e => setForm(f=>({...f,sourceUrl:e.target.value}))} /></div>
          </div>
          <div className='form-group'>
            <label className='form-label'>Description</label>
            <input className='form-input' value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} /></div>
          <label className='btn btn-primary' style={{ cursor:'pointer', fontSize:13 }}>
            {uploading ? 'Uploading and embedding...' : 'Choose file and upload'}
            <input type='file' style={{ display:'none' }} accept='.pdf,.docx,.txt,.md' onChange={upload} />
          </label>
        </div>
      )}
      {filtered.map(d => (
        <div key={d.id} className='card'>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div className='card-title'>{d.title}</div>
              <div className='card-meta'>{d.category} &middot; {d.jurisdiction}</div>
              {d.description && <div style={{ fontSize:13, color:'var(--text-secondary)', marginTop:4 }}>{d.description}</div>}
            </div>
            {d.source_url && <a href={d.source_url} target='_blank' rel='noopener noreferrer'
              style={{ fontSize:12, color:'var(--accent)', marginLeft:16, whiteSpace:'nowrap' }}>
              Source &rarr;
            </a>}
          </div>
        </div>
      ))}
      {filtered.length === 0 && <p style={{ color:'var(--text-muted)' }}>No documents in this category yet.</p>}
    </div>
  );
}
