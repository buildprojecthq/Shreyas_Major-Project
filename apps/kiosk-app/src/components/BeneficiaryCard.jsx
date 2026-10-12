import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  ShieldCheck, AlertTriangle, ScanFace, Fingerprint,
  User, Phone, Activity, RefreshCw, CheckCircle, Package, ArrowRight, Users, Plus, Minus
} from 'lucide-react';
import FaceCaptureModal from './FaceCaptureModal';
import HardwareTrigger from './HardwareTrigger';
import DevSimulator from './DevSimulator';

export default function BeneficiaryCard({ user: initialUser, onResetSearch }) {
  const [user, setUser] = useState(initialUser);
  const [familyMembers, setFamilyMembers] = useState(initialUser?.family_members || 1);
  const [isFaceModalOpen, setIsFaceModalOpen] = useState(false);
  const [claimStatus, setClaimStatus] = useState('');
  const [loadingClaim, setLoadingClaim] = useState(false);
  const [syncIndicator, setSyncIndicator] = useState('Listening for Realtime updates');
  const [esp32Ip, setEsp32Ip] = useState(() => localStorage.getItem('esp32_ip') || '');
  const [monthlyClaims, setMonthlyClaims] = useState([]);
  const [loadingQuota, setLoadingQuota] = useState(true);

  // Helper to reliably check face vector validity
  const isValidFaceVector = (vec) => {
    if (!vec) return false;
    if (Array.isArray(vec)) return vec.length >= 64;
    if (typeof vec === 'string') {
      try {
        const parsed = JSON.parse(vec);
        return Array.isArray(parsed) && parsed.length >= 64;
      } catch (e) {
        return false;
      }
    }
    return false;
  };

  const hasFace = isValidFaceVector(user?.face_encoding);
  const hasFingerprint = Boolean(user?.fingerprint_id && String(user.fingerprint_id).trim() !== '');
  const isBiometricVerified = hasFace || hasFingerprint;
  const isDualVerified = hasFace && hasFingerprint;

  // Fetch monthly quota history
  const fetchQuotaStatus = async () => {
    if (!user || user.is_demo) {
      setLoadingQuota(false);
      return;
    }
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('ration_id', user.ration_id)
        .gte('claimed_at', startOfMonth)
        .order('claimed_at', { ascending: false });

      if (!error && data) {
        setMonthlyClaims(data);
      }
    } catch (e) {
      console.error('Error fetching quota history:', e);
    } finally {
      setLoadingQuota(false);
    }
  };

  useEffect(() => {
    setUser(initialUser);
    setFamilyMembers(initialUser?.family_members || 1);
    fetchQuotaStatus();
  }, [initialUser]);

  const handleUpdateFamilyMembers = async (count) => {
    const newCount = Math.max(1, Math.min(10, count));
    setFamilyMembers(newCount);
    if (user.is_demo) {
      setUser(prev => ({ ...prev, family_members: newCount }));
      return;
    }
    try {
      const { data, error } = await supabase
        .from('users')
        .update({ family_members: newCount, updated_at: new Date().toISOString() })
        .eq('ration_id', user.ration_id)
        .select()
        .single();
      if (!error && data) {
        setUser(data);
      }
    } catch (err) {
      console.error('Error updating family members:', err);
    }
  };

  const targetGrams = (familyMembers || 1) * 100;
  const targetKg = targetGrams / 1000;

  // Realtime subscription to live updates on this beneficiary
  useEffect(() => {
    if (!user || user.is_demo) return;

    const channel = supabase
      .channel(`kiosk-user-${user.ration_id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `ration_id=eq.${user.ration_id}` },
        (payload) => {
          console.log('Kiosk Realtime Update Received:', payload.new);
          setUser(payload.new);
          setSyncIndicator('⚡ Live biometric state updated from Realtime!');
          setTimeout(() => setSyncIndicator('Listening for Realtime updates'), 4000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.ration_id]);

  const MONTHLY_QUOTA_LIMIT = 1000; // Allow 1000 dispenses per month for testing
  const hasClaimedThisMonth = monthlyClaims.length >= MONTHLY_QUOTA_LIMIT;
  const quotaRemainingGrams = hasClaimedThisMonth ? 0 : (MONTHLY_QUOTA_LIMIT - monthlyClaims.length) * 100;

  const handleFaceCaptured = async (descriptorArray) => {
    console.log('Updating face_encoding in database with standard array:', descriptorArray.slice(0, 5), '... length:', descriptorArray.length);

    if (user.is_demo) {
      setUser((prev) => ({ ...prev, face_encoding: descriptorArray }));
      setIsFaceModalOpen(false);
      return;
    }

    const { data, error } = await supabase
      .from('users')
      .update({ face_encoding: descriptorArray, updated_at: new Date().toISOString() })
      .eq('ration_id', user.ration_id)
      .select()
      .single();

    if (!error && data) {
      setUser(data);
      setClaimStatus('✅ Face biometric successfully enrolled and verified!');
    } else {
      console.error('Failed to update face vector in Supabase:', error);
      alert('Error updating face vector in database: ' + (error?.message || 'Unknown error'));
    }
    setIsFaceModalOpen(false);
  };

  const handleSimulatedHardwareScan = async (dummyFingerprintId) => {
    if (user.is_demo) {
      setUser((prev) => ({ ...prev, fingerprint_id: dummyFingerprintId, is_enrolling: false }));
      return;
    }

    const { data, error } = await supabase
      .from('users')
      .update({
        fingerprint_id: dummyFingerprintId,
        is_enrolling: false,
        updated_at: new Date().toISOString()
      })
      .eq('ration_id', user.ration_id)
      .select()
      .single();

    if (!error && data) {
      setUser(data);
      setClaimStatus('✅ Fingerprint biometric enrolled!');
    }
  };

  const handleToggleEnrolling = async (newState) => {
    if (user.is_demo) {
      setUser((prev) => ({ ...prev, is_enrolling: newState }));
      return;
    }

    const { data, error } = await supabase
      .from('users')
      .update({ is_enrolling: newState, updated_at: new Date().toISOString() })
      .eq('ration_id', user.ration_id)
      .select()
      .single();

    if (!error && data) {
      setUser(data);
    }
  };

  const handleIpChange = (e) => {
    const val = e.target.value;
    setEsp32Ip(val);
    localStorage.setItem('esp32_ip', val.trim());
  };

  const handleProcessDistribution = async () => {
    if (!isBiometricVerified) {
      alert('⚠️ Biometrics are pending! Please enroll Face ID or Fingerprint first before dispensing.');
      return;
    }

    if (hasClaimedThisMonth) {
      alert(`⚠️ Quota already claimed for this month on ${new Date(monthlyClaims[0].claimed_at).toLocaleDateString()}! Cannot dispense again.`);
      return;
    }

    setLoadingClaim(true);
    setClaimStatus('');

    try {
      let hardwareTriggered = false;

      // 1. Send physical trigger signal to ESP32 via HTTP with dynamic weight
      if (esp32Ip.trim()) {
        const cleanIp = esp32Ip.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
        try {
          console.log(`Sending hardware trigger signal to http://${cleanIp}/dispense?weight=${targetGrams}`);
          fetch(`http://${cleanIp}/dispense?weight=${targetGrams}`, {
            method: 'GET',
            mode: 'no-cors'
          }).catch(e => console.warn('Fetch to ESP32:', e));
          hardwareTriggered = true;
        } catch (hwErr) {
          console.warn('Could not contact ESP32 via HTTP:', hwErr);
        }
      }

      // 2. Record distribution claim in bookings table with dynamic quota
      if (user.is_demo) {
        setTimeout(() => {
          setClaimStatus(hardwareTriggered
            ? `✅ Hardware Signal Dispatched! ESP32 valve opening to dispense ${targetGrams}g (${familyMembers} Members)...`
            : `Rations claim recorded for ${targetGrams}g! (Connect ESP32 IP to trigger physical valve)`);
          setMonthlyClaims([{ id: 'demo-claim-1', claimed_at: new Date().toISOString() }]);
          setLoadingClaim(false);
        }, 1000);
        return;
      }

      const { data: newClaim, error: insertError } = await supabase
        .from('bookings')
        .insert([{
          ration_id: user.ration_id,
          slot_time: new Date().toISOString(),
          status: 'PENDING_DISPENSE',
          items_claimed: [
            { item_name: 'Subsidized Rice', quantity: targetKg, unit: 'kg' }
          ],
          claimed_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (!insertError) {
        setMonthlyClaims(prev => [newClaim || { claimed_at: new Date().toISOString() }, ...prev]);
        setClaimStatus(hardwareTriggered
          ? `✅ Dispense Signal Dispatched! ESP32 valve opening to dispense ${targetGrams}g (${familyMembers} Members)...`
          : `✅ Quota deducted (${targetGrams}g for ${familyMembers} Members) and claim logged in database!`);
      } else {
        throw insertError;
      }
    } catch (err) {
      console.error(err);
      setClaimStatus('Error processing distribution: ' + err.message);
    } finally {
      setLoadingClaim(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn mt-6">
      {/* Realtime Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-500 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span className="font-mono">{syncIndicator}</span>
        </div>
        <button onClick={onResetSearch} className="text-blue-600 hover:underline font-bold font-mono uppercase">
          ← Lookup Another Card
        </button>
      </div>

      {/* Beneficiary Hero Profile */}
      <div className="bg-white border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center font-bold text-2xl flex-shrink-0 shadow-sm">
              <User className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
                <span>RATION ID:</span>
                <strong className="px-2 py-0.5 rounded bg-gray-100 text-blue-800 border border-gray-200 text-sm">
                  {user.ration_id}
                </strong>
              </div>
              <h2 className="text-3xl font-extrabold text-gray-900 mt-1.5">{user.name}</h2>
              <div className="flex flex-wrap items-center gap-3 text-gray-600 text-sm font-mono mt-1">
                <div className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-blue-600" />
                  <span>{user.phone}</span>
                </div>
                <span>•</span>
                <div className="flex items-center gap-1.5 bg-blue-50 text-blue-800 px-2 py-0.5 rounded border border-blue-200 text-xs">
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  <span>{familyMembers} Members ({targetGrams}g Quota)</span>
                </div>
                {/* Household Stepper */}
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 border border-gray-200">
                  <button
                    type="button"
                    onClick={() => handleUpdateFamilyMembers(familyMembers - 1)}
                    disabled={familyMembers <= 1}
                    className="p-1 hover:bg-white rounded text-gray-700 disabled:opacity-40 transition-colors"
                    title="Decrease family members"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="px-1 text-xs font-bold text-gray-800">{familyMembers}</span>
                  <button
                    type="button"
                    onClick={() => handleUpdateFamilyMembers(familyMembers + 1)}
                    disabled={familyMembers >= 10}
                    className="p-1 hover:bg-white rounded text-gray-700 disabled:opacity-40 transition-colors"
                    title="Increase family members"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Verification Badge */}
          <div className="flex flex-col md:items-end">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
              Platform Authentication Status
            </span>
            {isDualVerified ? (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-green-50 border border-green-200 text-green-800 font-extrabold shadow-sm">
                <ShieldCheck className="w-5 h-5 text-green-600" />
                <span className="text-sm">DUAL BIOMETRICS VERIFIED</span>
              </div>
            ) : hasFace ? (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-green-50 border border-green-200 text-green-800 font-extrabold shadow-sm">
                <ScanFace className="w-5 h-5 text-green-600" />
                <span className="text-sm">FACE BIOMETRICS VERIFIED</span>
              </div>
            ) : hasFingerprint ? (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-green-50 border border-green-200 text-green-800 font-extrabold shadow-sm">
                <Fingerprint className="w-5 h-5 text-green-600" />
                <span className="text-sm">FINGERPRINT VERIFIED</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-orange-50 border border-orange-200 text-orange-800 font-extrabold shadow-sm animate-pulse">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
                <span className="text-sm">PENDING BIOMETRICS</span>
              </div>
            )}
          </div>
        </div>

        {/* Biometrics Action Center */}
        <div className="mt-8 pt-8 border-t border-gray-100 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Facial Recognition Module */}
          <div className={`p-5 rounded-2xl border transition-all flex flex-col justify-between ${hasFace ? 'bg-green-50/60 border-green-200' : 'bg-gray-50 border-gray-200'
            }`}>
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <ScanFace className={`w-6 h-6 ${hasFace ? 'text-green-600' : 'text-gray-500'}`} />
                  <div>
                    <h3 className="font-bold text-base text-gray-900">Face Recognition</h3>
                    <p className="text-xs text-gray-500 font-mono">128-pt Neural Vector</p>
                  </div>
                </div>
                {hasFace ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-200 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" /> REGISTERED
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800 border border-orange-200 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> NOT REGISTERED
                  </span>
                )}
              </div>
              {hasFace && (
                <div className="mt-3 p-2.5 rounded-xl bg-white border border-green-200 text-[11px] font-mono text-gray-600 truncate">
                  Vector Active: [{Array.isArray(user.face_encoding) ? user.face_encoding.slice(0, 4).map(n => typeof n === 'number' ? n.toFixed(3) : n).join(', ') : '128-pt array'} ...]
                </div>
              )}
            </div>

            <button
              onClick={() => setIsFaceModalOpen(true)}
              className={`mt-5 w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${hasFace ? 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-blue-700 hover:bg-blue-800 text-white shadow-sm'
                }`}
            >
              <ScanFace className="w-4 h-4" />
              <span>{hasFace ? 'Recapture / Update Face' : 'Activate WebCam & Capture Face'}</span>
            </button>
          </div>

          {/* ESP32 Hardware Fingerprint Module */}
          <div className={`p-5 rounded-2xl border transition-all flex flex-col justify-between ${hasFingerprint ? 'bg-green-50/60 border-green-200' : 'bg-gray-50 border-gray-200'
            }`}>
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <Fingerprint className={`w-6 h-6 ${hasFingerprint ? 'text-green-600' : 'text-gray-500'}`} />
                  <div>
                    <h3 className="font-bold text-base text-gray-900">Fingerprint Scanner</h3>
                    <p className="text-xs text-gray-500 font-mono">AS608 / R307 Module</p>
                  </div>
                </div>
                {hasFingerprint ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-200 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" /> ENROLLED
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-600 border border-gray-200 flex items-center gap-1">
                    OPTIONAL
                  </span>
                )}
              </div>
              {hasFingerprint && (
                <div className="mt-3 p-2.5 rounded-xl bg-white border border-green-200 text-[11px] font-mono text-gray-600 flex items-center justify-between">
                  <span>Hardware Fingerprint ID:</span>
                  <strong className="text-green-700 font-mono">{user.fingerprint_id}</strong>
                </div>
              )}
            </div>

            <div className="mt-5 space-y-3">
              <HardwareTrigger
                isEnrolling={user.is_enrolling}
                hasFingerprint={hasFingerprint}
                onToggleEnrolling={handleToggleEnrolling}
              />
              <DevSimulator
                isEnrolling={user.is_enrolling}
                onSimulateComplete={handleSimulatedHardwareScan}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Rations Monthly Quota & Distribution Dispensing Bar */}
      <div className={`p-6 rounded-2xl border transition-all ${hasClaimedThisMonth
        ? 'bg-amber-50/70 border-amber-200 shadow-sm'
        : isBiometricVerified
          ? 'bg-blue-50 border-blue-200 shadow-sm'
          : 'bg-gray-100 border-gray-200 opacity-80'
        }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-blue-700 uppercase">MONTHLY QUOTA STATUS</span>
              {hasClaimedThisMonth ? (
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold text-xs">
                  CLAIMED FOR THIS MONTH (0g LEFT)
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-green-100 text-green-800 border border-green-300 font-bold text-xs">
                  AVAILABLE ({targetGrams}g - {familyMembers} MEMBERS)
                </span>
              )}
            </div>

            <h3 className="text-xl font-extrabold text-gray-900 flex items-center gap-2 mt-1.5">
              <Package className="w-6 h-6 text-blue-600" />
              <span>Dispense Subsidized Ration ({targetGrams}g)</span>
            </h3>

            <p className="text-sm text-gray-600 mt-0.5">
              {hasClaimedThisMonth
                ? `Beneficiary has already claimed their monthly quota on ${new Date(monthlyClaims[0].claimed_at).toLocaleDateString()}. Next allotment next month.`
                : isBiometricVerified
                  ? `Biometrics verified. Ready for automatic or manual distribution (${targetGrams}g for ${familyMembers} household members).`
                  : 'Biometrics pending. Please capture Face ID or Fingerprint first to enable dispensing.'}
            </p>
          </div>

          <button
            onClick={handleProcessDistribution}
            disabled={!isBiometricVerified || hasClaimedThisMonth || loadingClaim}
            className={`px-8 py-3.5 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 shadow-sm ${hasClaimedThisMonth
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed border border-gray-300'
              : isBiometricVerified
                ? 'bg-blue-700 hover:bg-blue-800 text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed border border-gray-300'
              }`}
          >
            {loadingClaim ? (
              <span>Dispensing Rations...</span>
            ) : hasClaimedThisMonth ? (
              <span>Quota Exhausted</span>
            ) : (
              <>
                <span>Manual Dispense ({targetGrams}g)</span>
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </div>

        {/* ESP32 Hardware IP Configuration */}
        <div className="mt-4 pt-4 border-t border-blue-200/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600" />
            <span className="font-bold text-gray-700">ESP32 Hardware IP:</span>
            <input
              type="text"
              placeholder="e.g. 192.168.1.100"
              value={esp32Ip}
              onChange={handleIpChange}
              className="px-3 py-1 bg-white border border-gray-300 rounded-lg font-mono text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 w-40"
            />
          </div>
        </div>

        {claimStatus && (
          <div className="mt-4 p-4 rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm font-bold flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span>{claimStatus}</span>
          </div>
        )}
      </div>

      {/* Modal for Webcam Face-API Capture */}
      {isFaceModalOpen && (
        <FaceCaptureModal
          user={user}
          onClose={() => setIsFaceModalOpen(false)}
          onCapture={handleFaceCaptured}
        />
      )}
    </div>
  );
}
