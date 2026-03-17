import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, User, Mail, Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Register() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [otpInfo, setOtpInfo] = useState<{ email: string; expiresInMinutes: number } | null>(null);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'Registration failed. Please try again.');
      }
      const data = await res.json();
      setOtpInfo({
        email: data.email || form.email,
        expiresInMinutes: data.expiresInMinutes || 10,
      });
      setStep('otp');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, otp }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'OTP verification failed');
      }
      const data = await res.json();
      login(data.accessToken, data.refreshToken, data.user);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <span className="text-2xl font-bold text-white">AI Gym Coach</span>
        </div>

        <div className="card">
          <h1 className="text-xl font-semibold text-white mb-1">Create account</h1>
          <p className="text-sm text-zinc-400 mb-6">Start your fitness journey today</p>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
          )}

          {step === 'form' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">First Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input type="text" value={form.firstName} onChange={set('firstName')}
                      className="input pl-9" placeholder="Alex" required />
                  </div>
                </div>
                <div>
                  <label className="label">Last Name</label>
                  <input type="text" value={form.lastName} onChange={set('lastName')}
                    className="input" placeholder="Nguyen" required />
                </div>
              </div>

              <div>
                <label className="label">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input type="email" value={form.email} onChange={set('email')}
                    className="input pl-9" placeholder="you@example.com" required />
                </div>
              </div>

              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input type="password" value={form.password} onChange={set('password')}
                    className="input pl-9" placeholder="Min. 8 characters" minLength={8} required />
                </div>
              </div>

              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Sending code…' : 'Send OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="text-sm text-zinc-400">
                We sent a 6-digit code to <span className="text-zinc-200">{otpInfo?.email}</span>.
                {' '}It expires in {otpInfo?.expiresInMinutes ?? 10} minutes.
              </div>
              <div>
                <label className="label">Verification Code</label>
                <input
                  type="text"
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  className="input"
                  placeholder="Enter 6-digit code"
                  minLength={6}
                  maxLength={6}
                  required
                />
              </div>
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Verifying…' : 'Verify & Create Account'}
              </button>
            </form>
          )}



          <p className="mt-5 text-center text-sm text-zinc-500">
            Already have an account?{' '}
            <Link to="/login" className="text-emerald-400 hover:text-emerald-300 font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
