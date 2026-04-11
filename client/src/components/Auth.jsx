import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    setLoading(true); setMessage('');
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setMessage(error.message);
      else setMessage('Check your email to confirm your account.');
    }
    setLoading(false);
  };

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--bg)' }}>
      <div style={{ width: 340 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>AdvisoryHub</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 32 }}>Risk, Audit and Insurance</div>
        <div className='form-group'>
          <label className='form-label'>Email</label>
          <input className='form-input' type='email' value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className='form-group'>
          <label className='form-label'>Password</label>
          <input className='form-input' type='password' value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
        {message && <p style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 12 }}>{message}</p>}
        <button className='btn btn-primary' style={{ width:'100%', marginBottom: 12 }}
          onClick={handleSubmit} disabled={loading}>
          {loading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          {mode === 'signin' ? 'No account? ' : 'Have an account? '}
          <span style={{ color: 'var(--accent)', cursor: 'pointer' }}
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </span>
        </p>
      </div>
    </div>
  );
}
