import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Search, Loader2, UserCheck, UserX, Sparkles, QrCode, Camera } from 'lucide-react';
import FaceLookupModal from './FaceLookupModal';

export default function SearchBar({ onBeneficiaryFound }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isFaceModalOpen, setIsFaceModalOpen] = useState(false);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const targetId = query.trim().toUpperCase();

      const { data, error: searchError } = await supabase
        .from('users')
        .select('*')
        .eq('ration_id', targetId)
        .single();

      if (searchError || !data) {
        if (searchError?.message?.includes('fetch') || searchError?.code === 'PGRST301' || searchError?.code === 'PGRST116') {
          // Fallback demo user if database is empty or offline
          if (targetId === 'RAT-1001' || targetId === 'DEMO') {
            const demoUser = {
              id: 'demo-uuid-1001',
              ration_id: 'RAT-1001',
              name: 'Rahul Kumar',
              phone: '+91 98765 43210',
              face_encoding: null,
              is_demo: true
            };
            onBeneficiaryFound(demoUser);
            setLoading(false);
            return;
          } else if (targetId === 'RAT-9999') {
            const verifiedDemo = {
              id: 'demo-uuid-9999',
              ration_id: 'RAT-9999',
              name: 'Anjali Sharma',
              phone: '+91 91234 56789',
              face_encoding: Array(128).fill(0.245),
              is_demo: true
            };
            onBeneficiaryFound(verifiedDemo);
            setLoading(false);
            return;
          }
        }
        setError(`No active beneficiary found with Ration ID "${targetId}". Verify card number.`);
        onBeneficiaryFound(null);
      } else {
        onBeneficiaryFound(data);
      }
    } catch (err) {
      console.error(err);
      setError('Error querying Supabase database. Check connection.');
    } finally {
      setLoading(false);
    }
  };

  const loadDemoUser = (id) => {
    setQuery(id);
    // Simulate direct lookup
    if (id === 'RAT-1001') {
      onBeneficiaryFound({
        id: 'demo-uuid-1001',
        ration_id: 'RAT-1001',
        name: 'Rahul Kumar',
        phone: '+91 98765 43210',
        face_encoding: null,
        is_demo: true
      });
      setError(null);
    } else if (id === 'RAT-9999') {
      onBeneficiaryFound({
        id: 'demo-uuid-9999',
        ration_id: 'RAT-9999',
        name: 'Anjali Sharma',
        phone: '+91 91234 56789',
        face_encoding: Array(128).fill(0.245),
        is_demo: true
      });
      setError(null);
    }
  };

  return (
    <div className="bg-gray-50 border border-gray-200 p-6 rounded-2xl animate-fadeIn shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <span className="text-xs font-mono font-bold uppercase text-blue-600 tracking-wider">
            KIOSK BENEFICIARY LOOKUP TERMINAL
          </span>
          <h2 className="text-2xl font-extrabold text-gray-900 mt-1 flex items-center gap-2">
            <QrCode className="w-7 h-7 text-blue-800" />
            <span>Search Digital Ration Card</span>
          </h2>
        </div>

      </div>

      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            placeholder="Enter Ration ID (e.g. RAT-1001)..."
            className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-white border border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 text-gray-900 placeholder-gray-400 font-mono text-base transition-all outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="bg-blue-700 hover:bg-blue-800 text-white font-bold py-3.5 px-8 rounded-xl sm:w-auto flex items-center justify-center gap-2 shadow-sm transition-all"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin text-white" />
              <span>Querying...</span>
            </>
          ) : (
            <>
              <UserCheck className="w-5 h-5 text-white font-bold" />
              <span>Lookup Record</span>
            </>
          )}
        </button>
      </form>

      <div className="mt-4 flex items-center gap-4">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs font-mono text-gray-400 uppercase tracking-wider font-bold">OR</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <button
        type="button"
        onClick={() => setIsFaceModalOpen(true)}
        className="w-full mt-4 py-3.5 px-4 rounded-xl bg-gray-50 border border-blue-200 hover:bg-blue-50 text-blue-800 font-extrabold text-sm transition-all flex items-center justify-center gap-2"
      >
        <Camera className="w-5 h-5" />
        <span>Face Scanner</span>
      </button>

      {error && (
        <div className="mt-4 p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center gap-3 text-rose-300 text-sm">
          <UserX className="w-5 h-5 flex-shrink-0 text-rose-400" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <FaceLookupModal
        isOpen={isFaceModalOpen}
        onClose={() => setIsFaceModalOpen(false)}
        onUserFound={onBeneficiaryFound}
      />

      {loading && (
        <div className="mt-8 bg-white border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-sm animate-pulse space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-start gap-4 flex-1">
              <div className="w-16 h-16 rounded-2xl bg-gray-200 flex-shrink-0"></div>
              <div className="space-y-3 w-full max-w-sm">
                <div className="h-5 bg-gray-200 rounded w-1/3"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-100 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-48 bg-gray-100 rounded-2xl border border-gray-200"></div>
            <div className="h-48 bg-gray-100 rounded-2xl border border-gray-200"></div>
          </div>
        </div>
      )}
    </div>
  );
}
