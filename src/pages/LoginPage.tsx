import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (el: HTMLElement, config: any) => void;
        };
      };
    };
  }
}

interface User {
  id: string;
  username: string;
  name: string;
  role: string;
  email?: string | null;
  permissions: Record<string, boolean>;
  shop?: { id: string; slug: string; name: string } | null;
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

export default function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.google && googleBtnRef.current) {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleLogin,
      });

      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
      });
    }
  }, []);

  const handleGoogleLogin = async (response: any) => {
    try {
      setLoading(true);

      const mockUser: User = {
        id: '1',
        username: 'google_user',
        name: 'Google User',
        role: 'admin',
        email: 'google@gmail.com',
        permissions: {},
        shop: null,
      };

      console.log('Google login:', response.credential);
      navigate('/dashboard');
    } catch (err) {
      setError('Google login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ထည့်ပါ။');
      return;
    }

    try {
      setLoading(true);

      const mockUser = {
        email,
        shopName: 'Demo Shop',
      };

      console.log('Login success:', mockUser);
      navigate('/dashboard');
    } catch {
      setError('Login မအောင်မြင်ပါ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md bg-white p-8 rounded-xl shadow">
        <h2 className="text-2xl font-bold mb-4">Login</h2>

        {error && <p className="text-red-500 mb-3">{error}</p>}

        <form onSubmit={handleLogin} className="space-y-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full border p-2 rounded"
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full border p-2 rounded"
          />

          <button
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded"
          >
            {loading ? 'Loading...' : 'Login'}
          </button>
        </form>

        <div ref={googleBtnRef} className="mt-4" />
      </div>
    </div>
  );
}
