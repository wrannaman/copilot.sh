"use client";

import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';

export default function TestAuth() {
  const [status, setStatus] = useState('Ready to test');

  const testConnection = async () => {
    setStatus('Testing connection...');
    console.log('Starting connection test...');

    try {
      const supabase = createClient();
      console.log('Client created, testing basic query...');

      // Test with a timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout after 5 seconds')), 5000)
      );

      const queryPromise = supabase.from('organizations').select('count').limit(1);

      const result = await Promise.race([queryPromise, timeoutPromise]);

      console.log('Query result:', result);
      setStatus('✅ Connection successful');
    } catch (error) {
      console.error('Connection failed:', error);
      setStatus(`❌ Failed: ${error.message}`);
    }
  };

  const testAuth = async () => {
    setStatus('Testing auth...');
    console.log('Starting auth test...');

    try {
      const supabase = createClient();
      console.log('Getting current session...');

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Auth timeout after 5 seconds')), 5000)
      );

      const authPromise = supabase.auth.getSession();

      const result = await Promise.race([authPromise, timeoutPromise]);

      console.log('Auth result:', result);
      setStatus('✅ Auth test successful');
    } catch (error) {
      console.error('Auth test failed:', error);
      setStatus(`❌ Auth failed: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-bold">Supabase Debug</h1>

        <div className="p-4 border rounded">
          <p className="mb-4">Status: {status}</p>

          <div className="space-y-2">
            <button
              onClick={testConnection}
              className="w-full p-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Test Database Connection
            </button>

            <button
              onClick={testAuth}
              className="w-full p-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              Test Auth System
            </button>
          </div>
        </div>

        <div className="text-sm text-gray-600">
          <p>Check browser console for detailed logs.</p>
        </div>
      </div>
    </div>
  );
}
