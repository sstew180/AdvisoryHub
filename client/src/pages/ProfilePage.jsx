import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const API = import.meta.env.VITE_API_URL;

export default function ProfilePage({ session, onMenuOpen, setView, activeModule }) {
  const [profile, setProfile] = useState({
    first_name: '', last_name: '', organisation: 'City of Gold Coast',
  });
  const [persona, setPersona] = useState({
    role: '', service_area: '', goals: '', preferences: '', high_scrutiny: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Load profile (name, organisation)
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (data) setProfile({
          first_name: data.first_name || '',
          last_name: data.last_name || '',
          organisation: data.organisation || 'City of Gold Coast',
        });
      });
  }, [session]);

  useEffect(() => {
    // Load persona for active module
    if (!activeModule) return;
    fetch(`${API}/api/modules/${activeModule.id}/persona?userId=${session.user.id}`)
      .then(r => r.json())
      .then(data => {
        if (data) setPersona({
          role: data.role || '',
          service_area: data.service_area || '',
          goals: data.goals || '',
          preferences: data.preferences || '',
          high_scrutiny: data.high_scrutiny || false,
        });
      })
      .catch(() => {});
  }, [activeModule, session]);

  const save = async () => {
    setSaving(true);
    // Save name and organisation to profiles
    await supabase.from('profiles').upsert({
      id: session.user.id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      organisation: profile.organisation,
    });
    // Save role/objectives/preferences to persona
    if (activeModule) {
      await fetch(`${API}/api/modules/${activeModule.id}/persona`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.user.id, ...persona }),
      });
    }
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const up = (field, value) => setProfile(p => ({ ...p, [field]: value }));
  const ua = (field, value) => setPersona(p => ({ ...p, [field]: value }));

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
        <button className='mobile-back' onClick={() => setView('chat')}>‹ Chat</button>
        <div className='page-title' style={{ margin: 0 }}>Profile</div>
        {activeModule && (
          <span style={{ fontSize: 11, color: 'var(--accent)', background: 'rgba(0,145,164,0.08)',
            padding: '2px 8px', borderRadius: 10, fontWeight: 500 }}>
            {activeModule.name}
          </span>
        )}
      </div>

      <div className='page-content'>

        {/* Account section -- shared across all modules */}
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12 }}>
          Account
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div className='form-group' style={{ margin: 0 }}>
            <label className='form-label'>First Name</label>
            <input className='form-input' value={profile.first_name}
              onChange={e => up('first_name', e.target.value)} placeholder='e.g. Scott' />
          </div>
          <div className='form-group' style={{ margin: 0 }}>
            <label className='form-label'>Last Name</label>
            <input className='form-input' value={profile.last_name}
              onChange={e => up('last_name', e.target.value)} placeholder='e.g. Stewart' />
          </div>
        </div>
        <div className='form-group'>
          <label className='form-label'>Organisation</label>
          <input className='form-input' value={profile.organisation}
            onChange={e => up('organisation', e.target.value)} />
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--border)', margin: '24px 0 20px' }} />

        {/* Persona section -- scoped to active module */}
        {activeModule ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12 }}>
              {activeModule.name} persona
            </div>
            <div className='form-group'>
              <label className='form-label'>Role</label>
              <input className='form-input' value={persona.role}
                onChange={e => ua('role', e.target.value)}
                placeholder='e.g. Manager Risk and Insurance' />
            </div>
            <div className='form-group'>
              <label className='form-label'>Service Area</label>
              <input className='form-input' value={persona.service_area}
                onChange={e => ua('service_area', e.target.value)}
                placeholder='e.g. Corporate Governance' />
            </div>
            <div className='form-group'>
              <label className='form-label'>Current Objectives</label>
              <textarea className='form-textarea' value={persona.goals}
                onChange={e => ua('goals', e.target.value)}
                placeholder='What are you currently working on in this domain?' />
            </div>
            <div className='form-group'>
              <label className='form-label'>Communication Style and Writing Preferences</label>
              <textarea className='form-textarea' value={persona.preferences}
                onChange={e => ua('preferences', e.target.value)}
                placeholder='e.g. Plain English, no jargon, active voice, concise.' />
            </div>
            <div className='form-group' style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type='checkbox' id='scrutiny' checked={persona.high_scrutiny}
                onChange={e => ua('high_scrutiny', e.target.checked)} />
              <label htmlFor='scrutiny' style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                High scrutiny mode (AI flags assumptions and recommends verification)
              </label>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>
            No active module -- select a domain from the module selector to configure your persona.
          </div>
        )}

        <button className='btn btn-primary' onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  );
}
