import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function RegisterPage() {
  const navigate = useNavigate();

  const [shopName, setShopName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!shopName || !username || !email || !password || !confirmPassword) {
      setError('ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ဖြည့်ပါ။');
      return;
    }

    if (password !== confirmPassword) {
      setError('Password မတူပါ');
      return;
    }

    console.log('Register success', { shopName, username, email });

    sessionStorage.setItem(
      'register_prefill',
      JSON.stringify({ username, shopName })
    );

    navigate('/login');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md bg-white p-8 rounded-xl shadow">
        <h2 className="text-2xl font-bold mb-4">Register</h2>

        {error && <p className="text-red-500 mb-3">{error}</p>}

        <form onSubmit={handleRegister} className="space-y-3">
          <input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Shop Name" className="w-full border p-2 rounded" />
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="w-full border p-2 rounded" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full border p-2 rounded" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full border p-2 rounded" />
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm Password" className="w-full border p-2 rounded" />

          <button type="submit" className="w-full bg-green-600 text-white py-2 rounded">
            Create Account
          </button>
        </form>

        <button onClick={() => navigate('/login')} className="mt-4 text-blue-600 hover:underline w-full">
          Back to Login
        </button>
      </div>
    </div>
  );
}
