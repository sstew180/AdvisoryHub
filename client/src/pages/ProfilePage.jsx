import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;

export default function ProfilePage({ session, onMenuOpen }) {
  const [profile, setProfile] = useState({
    role: '', service_area: '', goals: '', organisation: 'City of Gold Coast',
    preferences: '', artefact_preference: 'briefing note', high_scrutiny: false
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => { if (data) setProfile(p => ({ ...p, ...data })); });
    loadDocs();
  }, [session]);

  const loadDocs = () => {
    axios.get(API + '/api/user-documents/' + session.user.id)
      .then(r => setDocs(r.data))
      .catch(() => setDocs([]));
  };

  const save = async () => {
    setSaving(true);
    await supabase.from('profiles').upsert({ id: session.user.id, ...profile });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const uploadDoc = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('userId', session.user.id);
    try {
      await axios.post(API + '/api/user-documents/upload', fd);
      loadDocs();
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 2000);
    } catch { }
    setUploading(false);
    e.target.value = '';
  };

  const deleteDoc = async (id) => {
    await axios.delete(API + '/api/user-documents/' + id);
    loadDocs();
  };

  const u = (field, value) => setProfile(p => ({ ...p, [field]: value }));

  return (
    <div className='page'>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button className='hamburger' onClick={onMenuOpen} aria-label='Open menu'>
          <svg width='20' height='20' viewBox='0 0 20 20' fill='none'>
            <rect x='2' y='4' width='16' height='2' rx='1' fill='currentColor'/>
            <rect x='2' y='9' width='16' height='2' rx='1' fill='currentColor'/>
            <rect x='2' y='14' width='16' height='2' rx='1' fill='currentColor'/>
          </svg>
        </button>
        <div className='page-title' style={{ margin: 0 }}>Profile</div>
      </div>
      <div className='page-content'>
        <div className='form-group'>
          <label className='form-label'>Role</label>
          <input className='form-input' value={profile.role}
            onChange={e => u('role', e.target.value)} placeholder='e.g. Manager Risk and Insurance' />
        </div>
        <div className='form-group'>
          <label className='form-label'>Service Area</label>
          <input className='form-input' value={profile.service_area}
            onChange={e => u('service_area', e.target.value)} placeholder='e.g. Corporate Governance' />
        </div>
        <div className='form-group'>
          <label className='form-label'>Current Objectives</label>
          <textarea className='form-textarea' value={profile.goals}
            onChange={e => u('goals', e.target.value)}
            placeholder='What are you currently working on?' />
        </div>
        <div className='form-group'>
          <label className='form-label'>Communication Style and Writing Preferences</label>
          <textarea className='form-textarea' value={profile.preferences}
            onChange={e => u('preferences', e.target.value)}
            placeholder='e.g. Plain English, no jargon, active voice, concise.' />
        </div>
        <div className='form-group'>
          <label className='form-label'>Default Output Format</label>
          <select className='form-select' value={profile.artefact_preference}
            onChange={e => u('artefact_preference', e.target.value)}>
            <option value='briefing note'>Briefing Note</option>
            <option value='risk assessment'>Risk Assessment</option>
            <option value='audit finding'>Audit Finding</option>
            <option value='options paper'>Options Paper</option>
            <option value='memo'>Memo</option>
          </select>
        </div>
        <div className='form-group' style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type='checkbox' id='scrutiny' checked={profile.high_scrutiny}
            onChange={e => u('high_scrutiny', e.target.checked)} />
          <label htmlFor='scrutiny' style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            High scrutiny mode (AI flags assumptions and recommends verification)
          </label>
        </div>
        <button className='btn btn-primary' onClick={save} disabled={saving} style={{ marginBottom: 32 }}>
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
        </button>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>My Documents</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Available in every session regardless of project. Upload your business unit plan, style guide, or any reference document you always want the AI to draw on.
              </div>
            </div>
            {uploadSuccess && (
              <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 500, flexShrink: 0, marginLeft: 12 }}>
                Uploaded
              </span>
            )}
          </div>
          <label className='btn btn-secondary' style={{ cursor: 'pointer', fontSize: 13, marginTop: 12, display: 'inline-block' }}>
            {uploading ? 'Uploading...' : 'Upload document (PDF, DOCX, TXT)'}
            <input type='file' style={{ display: 'none' }} accept='.pdf,.docx,.txt,.md' onChange={uploadDoc} />
          </label>
          <div style={{ marginTop: 12 }}>
            {docs.map(d => (
              <div key={d.id} className='card'
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div className='card-title'>{d.filename}</div>
                  <div className='card-meta'>{new Date(d.created_at).toLocaleDateString('en-AU')}</div>
                </div>
                <button className='btn btn-danger' style={{ fontSize: 12 }} onClick={() => deleteDoc(d.id)}>
                  Remove
                </button>
              </div>
            ))}
            {docs.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>No documents uploaded yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}