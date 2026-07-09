'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const searchParams = useSearchParams();
  
  // This captures the 'intent' we passed from the AI Chat
  const intent = searchParams.get('intent'); 

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) alert(error.message);
    else window.location.href = '/dashboard'; // Redirect after success
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-lg">
        
        {/* The "Salesman" Hook: Change text based on AI intent */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            {intent === 'claims_automation' 
              ? "Let's automate your fleet claims." 
              : "Welcome back to Allianz."}
          </h1>
          <p className="text-gray-500 mt-2">
            Log in to securely access your AI-powered dashboard.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4 text-black">
          <input 
            type="email" placeholder="Email" required
            className="w-full p-3 border rounded-lg"
            onChange={(e) => setEmail(e.target.value)}
          />
          <input 
            type="password" placeholder="Password" required
            className="w-full p-3 border rounded-lg"
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">
            Secure Login
          </button>
        </form>
      </div>
    </div>
  );
}