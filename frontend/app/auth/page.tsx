'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { validateInviteCodeAction, finalizeTeamMemberAction } from '@/app/actions';
import {
  ACCOUNT_TYPE_METADATA,
  ALL_ACCOUNT_TYPES,
  generateInviteCode,
  type AccountType,
} from '@/lib/rbac';
import { Building2, Users, Ticket } from 'lucide-react';

const ACCOUNT_ICONS: Record<AccountType, typeof Building2> = {
  admin: Building2,
  standard: Users,
};

function AuthForm() {
  const [accountType, setAccountType] = useState<AccountType>('admin');
  const [tenantName, setTenantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const searchParams = useSearchParams();
  const router = useRouter();
  const intent = searchParams.get('intent');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const supabase = createClient();

    try {
      if (isSignUp) {
        // ── Sign Up ──
        if (accountType === 'admin') {
          // Admin: creates a new workspace, becomes owner
          const { data, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                tenant_name: tenantName,
                role: 'admin',
                account_type: 'admin',
              },
            },
          });

          if (signUpError) throw signUpError;

          if (data.session) {
            // Set workspace_id = own user id, generate invite code
            if (data.user) {
              await supabase
                .from('profiles')
                .update({
                  workspace_id: data.user.id,
                  account_type: 'admin',
                  role: 'admin',
                  invite_code: generateInviteCode(),
                })
                .eq('id', data.user.id);
            }
            router.push('/dashboard');
            router.refresh();
          } else {
            setError('Account created! Check your email to confirm, then log in.');
            setIsSignUp(false);
          }
        } else {
          // Standard user: joins an existing workspace via invite code
          const normalizedCode = inviteCode.trim().toUpperCase();
          if (!normalizedCode) {
            throw new Error('Please enter the invite code from your workspace admin.');
          }

          // Validate BEFORE creating the account (service role bypasses RLS) so an invalid
          // code never leaves behind an orphan admin account.
          const check = await validateInviteCodeAction(normalizedCode);
          if (!check.valid) {
            throw new Error('Invalid invite code. Check with your workspace admin.');
          }

          const { data, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                tenant_name: tenantName || email.split('@')[0],
                role: 'viewer',
                account_type: 'standard',
              },
            },
          });

          if (signUpError) throw signUpError;

          // Link this user to the admin's workspace via the service role (the new user's
          // own client cannot read/update the admin's row because of RLS).
          if (data.user) {
            await finalizeTeamMemberAction(data.user.id, normalizedCode);
          }

          if (data.session) {
            router.push('/dashboard');
            router.refresh();
          } else {
            setError('Account created! Check your email to confirm, then log in.');
            setIsSignUp(false);
          }
        }
      } else {
        // ── Sign In ──
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw new Error('Invalid email or password');

        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
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

          {/* Error message */}
          {error && (
            <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* ── Account Type Toggle (signup only) ── */}
            {isSignUp && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground ml-1">Account Type</label>
                <div className="grid grid-cols-1 gap-2">
                  {ALL_ACCOUNT_TYPES.map((type) => {
                    const meta = ACCOUNT_TYPE_METADATA[type];
                    const Icon = ACCOUNT_ICONS[type];
                    const selected = accountType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setAccountType(type)}
                        className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                          selected
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'border-border bg-card hover:border-primary/50'
                        }`}
                      >
                        <span className={`flex size-8 items-center justify-center rounded-lg ${selected ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                          <Icon className="size-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground">{meta.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
                        </div>
                        {selected && (
                          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Tenant Name (admin only during signup) ── */}
            {isSignUp && accountType === 'admin' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Workspace Name</label>
                <input
                  type="text" required
                  className="w-full p-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary outline-none transition-all"
                  onChange={(e) => setTenantName(e.target.value)}
                  placeholder="e.g. Acme Inc."
                />
              </div>
            )}

            {/* ── Invite Code (standard user only during signup) ── */}
            {isSignUp && accountType === 'standard' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1 flex items-center gap-1">
                  <Ticket className="size-3" />
                  Invite Code
                </label>
                <input
                  type="text" required
                  className="w-full p-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary outline-none transition-all font-mono uppercase tracking-wider"
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="ABCD1234"
                  maxLength={8}
                />
                <p className="text-xs text-muted-foreground ml-1">Enter the 8-character code from your workspace admin.</p>
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

            {/* ── Role Selection removed: team members join as viewer until an admin changes their role ── */}

            <button
              type="submit" disabled={loading}
              className="w-full py-3 mt-4 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? "Processing..." : (isSignUp ? "Create Account" : "Access Platform")}
            </button>
          </form>

          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError('');
            }}
            className="mt-6 text-sm text-muted-foreground hover:text-primary transition-colors block w-full text-center"
          >
            {isSignUp ? "Already have an account? Sign in" : "New here? Register"}
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