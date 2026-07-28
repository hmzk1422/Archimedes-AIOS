'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

function AuthForm() {
  const [tenantName, setTenantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();
  const intent = searchParams.get('intent');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { tenant_name: tenantName },
          },
        });

        if (error) throw error;

        if (data.session) {
          router.push('/dashboard');
          router.refresh();
        } else {
          alert('Account created! Check your email to confirm, then log in.');
          setIsSignUp(false);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error('Invalid email or password');

        router.push('/dashboard');
        router.refresh();
      }
    } catch (err: any) {
      alert(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      <div className="flex w-full lg:w-1/2 items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h2 className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-widest">
              {isSignUp ? "Onboarding" : "Start your journey"}
            </h2>
            <h1 className="text-4xl font-bold text-foreground tracking-tight">
              {isSignUp ? "Register" : (intent === 'claims_automation' ? "Automate Fleet" : "Sign in to Seneca")}
            </h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Tenant Name</label>
                <input
                  type="text" required
                  className="w-full p-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary outline-none transition-all"
                  onChange={(e) => setTenantName(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">Email</label>
              <input
                type="email" required
                className="w-full p-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary outline-none transition-all"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">Password</label>
              <input
                type="password" required
                className="w-full p-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary outline-none transition-all"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit" disabled={loading}
              className="w-full py-3 mt-4 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? "Processing..." : (isSignUp ? "Create Account" : "Access Platform")}
            </button>
          </form>

          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="mt-6 text-sm text-muted-foreground hover:text-primary transition-colors block w-full text-center"
          >
            {isSignUp ? "Already have an account? Sign in" : "New tenant? Register"}
          </button>
        </div>
      </div>

      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary via-transparent to-transparent"></div>
        <div className="space-y-4 text-center z-10">
           <div className="text-6xl font-display text-primary/80 tracking-tighter">S</div>
           <p className="text-muted-foreground/80 font-medium tracking-widest uppercase text-xs">
             Institutional Intelligence
           </p>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background"><div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
      <AuthForm />
    </Suspense>
  );
}
