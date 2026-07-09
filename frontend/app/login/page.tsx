'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export default function AuthPage() {
  const [tenantName, setTenantName] = useState('');
  const [tenantId, setTenantId] = useState('');
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

    if (isSignUp) {
      // 1. Insert into your custom table
      const { error: dbError } = await supabase
        .from('user-database') // CORRECT: Use the table name exactly as it appears in Supabase
        .insert([{ tenant_name: tenantName, tenant_id: tenantId, password: password }]);
      if (dbError) {
        alert("Error creating account: " + dbError.message);
      } else {
        alert("Account registered successfully!");
        setIsSignUp(false);
      }
    } else {
      // 2. Logic to check credentials in your custom table
      const { data, error } = await supabase
        .from('user-database')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('password', password)
        .single();
      
      if (error || !data) {
        alert("Invalid Tenant ID or Password");
      } else {
        router.push('/dashboard');
        router.refresh();
      }
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-lg">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            {intent === 'claims_automation' ? "Let's automate your fleet." : "Allianz Login"}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-black">
          {isSignUp && (
            <input 
              type="text" placeholder="Tenant Name" required
              className="w-full p-3 border rounded-lg"
              onChange={(e) => setTenantName(e.target.value)}
            />
          )}
          <input 
            type="text" placeholder="Tenant ID" required
            className="w-full p-3 border rounded-lg"
            onChange={(e) => setTenantId(e.target.value)}
          />
          <input 
            type="password" placeholder="Password" required
            className="w-full p-3 border rounded-lg"
            onChange={(e) => setPassword(e.target.value)}
          />
          
          <button 
            type="submit" disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Processing..." : (isSignUp ? "Register" : "Login")}
          </button>
        </form>

        <button 
          onClick={() => setIsSignUp(!isSignUp)}
          className="w-full mt-4 text-sm text-blue-600 hover:underline"
        >
          {isSignUp ? "Already registered? Login" : "New tenant? Register"}
        </button>
      </div>
    </div>
  );
}