import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function ProfilePage({ session, onMenuOpen }) {
  const [profile, setProfile] = useState({
    role: '', service_area: '', goals: '', organisation: 'City of Gold Coast',
    preferences: '', artefact_preference: 'briefing note', high_scrutiny: false
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => { if (data) setProfile(p => ({ ...p, ...data })); });
  }, [session]);

  const save = async () => {
    setSaving(true);
    await supabase.from('profiles').upsert({ id: session.user.id, ...profile });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
        <button className='btn btn-primary' onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
        </button>
      </div>
    </div>
  );
}