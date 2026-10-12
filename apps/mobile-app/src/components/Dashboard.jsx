import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { notificationService } from '../lib/notificationService';
import {
  ShieldCheck, AlertTriangle, Fingerprint, ScanFace,
  RefreshCw, Clock, PackageCheck, ExternalLink, Activity, Info, Bell, Sparkles, Send, Users
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export default function Dashboard({ user, onUserUpdated, onNavigateToBookings }) {
  const { t } = useLanguage();
  const [currentUser, setCurrentUser] = useState(user);
  const [recentClaims, setRecentClaims] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Listening to Realtime stream');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [notifPermGranted, setNotifPermGranted] = useState(false);

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

  // Evaluate biometrics verification status
  const hasFace = isValidFaceVector(currentUser?.face_encoding);
  const hasFingerprint = Boolean(currentUser?.fingerprint_id && String(currentUser.fingerprint_id).trim() !== '');
  const isBiometricsVerified = hasFace || hasFingerprint;

  useEffect(() => {
    // Check OS system notification permissions
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPermGranted(Notification.permission === 'granted');
    }
  }, []);

  // Realtime subscription to live changes on this user row from the Kiosk / ESP32 Hardware
  useEffect(() => {
    if (!currentUser || currentUser.is_demo) return;

    const subscription = supabase
      .channel(`user-updates-${currentUser.ration_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users',
          filter: `ration_id=eq.${currentUser.ration_id}`
        },
        (payload) => {
          console.log('Realtime biometric change detected:', payload.new);

          // Trigger System Notifications when biometrics get verified!
          const oldVerified = Boolean(currentUser?.face_encoding) && Boolean(currentUser?.fingerprint_id);
          const newVerified = Boolean(payload.new?.face_encoding) && Boolean(payload.new?.fingerprint_id);

          if (!oldVerified && newVerified) {
            notificationService.sendAlert({
              type: 'biometric',
              title: '✅ Biometric Authentication Complete!',
              body: 'Your 128-pt facial encoding & ESP32 fingerprint have been verified by Shop Admin. Authorized for commodity claims!'
            });
          } else if (!currentUser?.is_enrolling && payload.new?.is_enrolling) {
            notificationService.sendAlert({
              type: 'hardware',
              title: '⚡ ESP32 Biometric Scanner Ready',
              body: 'Shop admin activated the IoT hardware sensor at the kiosk. Please place your finger on the scanner now.'
            });
          }

          setCurrentUser(payload.new);
          onUserUpdated?.(payload.new);
          setSyncStatus('Live biometric update received from Kiosk!');
          setLastUpdated(new Date());
          setTimeout(() => setSyncStatus('Listening to Realtime stream'), 5000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [currentUser?.ration_id, currentUser?.face_encoding, currentUser?.fingerprint_id, currentUser?.is_enrolling]);

  // Fetch recent claims history
  useEffect(() => {
    async function fetchClaims() {
      if (currentUser?.is_demo) {
        setRecentClaims([
          { id: 'CLAIM-701', slot_time: '2026-07-15T10:30:00Z', status: 'claimed', items: '15kg Rice, 10kg Wheat, 2L Kerosene' },
          { id: 'CLAIM-602', slot_time: '2026-06-12T14:00:00Z', status: 'claimed', items: '15kg Rice, 10kg Wheat, 3kg Sugar' },
        ]);
        return;
      }

      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('ration_id', currentUser.ration_id)
        .eq('status', 'claimed')
        .order('slot_time', { ascending: false })
        .limit(5);

      if (!error && data) {
        setRecentClaims(data);
      }
    }
    if (currentUser?.ration_id) {
      fetchClaims();
    }
  }, [currentUser?.ration_id]);

  const handleManualRefresh = async () => {
    if (currentUser?.is_demo) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('ration_id', currentUser.ration_id)
      .single();
    if (!error && data) {
      setCurrentUser(data);
      onUserUpdated?.(data);
      setLastUpdated(new Date());
    }
    setLoading(false);
  };

  const handleTestNotification = async (type) => {
    const granted = await notificationService.requestPermission();
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPermGranted(Notification.permission === 'granted');
    }

    if (type === 'biometric') {
      notificationService.sendAlert({
        type: 'biometric',
        title: '✅ Biometric Authentication Complete!',
        body: 'Your 128-pt facial encoding & ESP32 hardware fingerprint have just been verified by Shop Admin!'
      });
    } else if (type === 'inventory') {
      notificationService.sendAlert({
        type: 'inventory',
        title: '🌾 Subsidized Commodity Update!',
        body: 'Shop Admin just replenished Subsidized Rice (500 KG available at ₹3.00/kg). Book your pickup slot now!'
      });
    } else if (type === 'booking') {
      notificationService.sendAlert({
        type: 'booking',
        title: '🕒 Ration Pickup Slot Confirmed',
        body: 'Your reservation is locked in using Atomic RPC protocol. Please present your Digital Card ID at the kiosk.'
      });
    } else if (type === 'hardware') {
      notificationService.sendAlert({
        type: 'hardware',
        title: '⚡ ESP32 Biometric Scanner Awakening',
        body: 'The Admin Kiosk has initiated hardware enrollment. Please place your finger on the physical scanner now.'
      });
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Realtime Connection Indicator banner */}
      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-xs">
        <div className="flex items-center gap-2 text-blue-700">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600"></span>
          </span>
          <span className="font-mono">{syncStatus}</span>
        </div>
        <button
          onClick={handleManualRefresh}
          disabled={loading}
          className="text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-1 font-medium"
          title="Refresh database sync"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{t('syncBtn', 'Sync')}</span>
        </button>
      </div>

      {/* Digital Ration Card - Hero Glassmorphic Container */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border border-gray-200 shadow-lg bg-white">
        <div className="absolute right-0 bottom-0 opacity-5 pointer-events-none transform translate-x-10 translate-y-10">
          <ShieldCheck className="w-80 h-80 text-blue-600" />
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-xs font-mono mb-3">
              <Activity className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
              <span>{t('digitalCardBadge', 'DIGITAL SMART RATION CARD')}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              {currentUser?.name || 'Beneficiary Card'}
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-500 font-mono">
              <span>ID: <strong className="text-gray-900">{currentUser?.ration_id}</strong></span>
              <span>•</span>
              <span>Tel: <strong className="text-gray-900">{currentUser?.phone}</strong></span>
              <span>•</span>
              <span className="inline-flex items-center gap-1.5 text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-xs font-semibold">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                <span>{currentUser?.family_members || 1} Members ({(currentUser?.family_members || 1) * 100}g Quota)</span>
              </span>
            </div>
          </div>

          {/* Biometrics Verification Status Badge */}
          <div className="flex flex-col items-start md:items-end">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              {t('verificationStatus', 'Verification Status')}
            </span>
            {isBiometricsVerified ? (
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-green-50 border border-green-200 text-green-700 font-bold shadow-sm transition-all">
                <ShieldCheck className="w-5 h-5 text-green-600 flex-shrink-0" />
                <span className="tracking-wide">{t('verified', 'Biometrics Verified')}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-orange-50 border border-orange-200 text-orange-700 font-bold shadow-sm animate-pulse-subtle">
                <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0" />
                <span className="tracking-wide">{t('pending', 'Pending Biometrics')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Biometrics Breakdown Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8 pt-6 border-t border-gray-200 relative z-10">
          <div className={`p-4 rounded-2xl border transition-all ${hasFace ? 'bg-green-50/50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${hasFace ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                  <ScanFace className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-gray-900">{t('facialVector', 'Facial Recognition Vector')}</h4>
                  <p className="text-xs font-mono text-gray-500">
                    {hasFace ? t('facialReady', '128-pt vector encoded in database') : t('facialMissing', 'Pending Kiosk Face-API capture')}
                  </p>
                </div>
              </div>
              {hasFace ? (
                <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-bold">{t('readyBadge', 'READY')}</span>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded-full bg-gray-200 text-gray-600">{t('missingBadge', 'MISSING')}</span>
              )}
            </div>
          </div>

          <div className={`p-4 rounded-2xl border transition-all ${hasFingerprint ? 'bg-green-50/50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${hasFingerprint ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                  <Fingerprint className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-gray-900">{t('fingerprintHardware', 'ESP32 Hardware Fingerprint')}</h4>
                  <p className="text-xs font-mono text-gray-500">
                    {hasFingerprint ? `${t('fingerprintReady', 'Hardware ID')}: ${currentUser.fingerprint_id}` : t('fingerprintMissing', 'Pending ESP32 biometric scanner')}
                  </p>
                </div>
              </div>
              {hasFingerprint ? (
                <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-bold">{t('readyBadge', 'READY')}</span>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded-full bg-gray-200 text-gray-600">{t('missingBadge', 'MISSING')}</span>
              )}
            </div>
          </div>
        </div>

        {!isBiometricsVerified && (
          <div className="mt-6 p-4 rounded-2xl bg-orange-50 border border-orange-200 flex items-start sm:items-center justify-between flex-col sm:flex-row gap-3 relative z-10 text-xs text-orange-800">
            <div className="flex items-center gap-2.5">
              <Info className="w-5 h-5 text-orange-600 flex-shrink-0" />
              <span>{t('biometricNotice', 'Please visit your local Smart Ration Shop Kiosk to quickly record your facial & fingerprint biometrics.')}</span>
            </div>
            <span className="font-mono font-bold bg-orange-100 px-3 py-1 rounded-lg text-orange-700 flex-shrink-0">
              {t('liveAutoUpdate', 'Live Auto-Update Enabled')}
            </span>
          </div>
        )}
      </div>

      {/* NEW: Interactive OS System Notifications & Alert Testing Suite */}
      <div className="bg-white border border-gray-200 p-6 rounded-3xl shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <Bell className="w-5 h-5 animate-bounce" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
                <span>{t('notifEngineTitle', 'Push & In-App Notification Engine')}</span>
              </h3>
            </div>
          </div>
          <span className="px-3 py-1 rounded-xl bg-gray-50 text-gray-600 border border-gray-200 text-xs font-mono flex items-center gap-1.5">
            <span>{t('osPermissions', 'OS Permissions:')}</span>
            <strong className={notifPermGranted ? 'text-green-600 font-bold' : 'text-orange-500'}>
              {notifPermGranted ? t('grantedReady', 'GRANTED (READY)') : t('clickToGrant', 'CLICK TO GRANT')}
            </strong>
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            onClick={() => handleTestNotification('biometric')}
            className="p-3 rounded-2xl bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-blue-400 transition-all flex flex-col items-center text-center group"
          >
            <ShieldCheck className="w-6 h-6 text-green-500 mb-2 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold text-gray-900">{t('bioAlertBtn', 'Biometrics Verified Alert')}</span>
            <span className="text-[10px] font-mono text-gray-500 mt-0.5">{t('bioAlertSub', 'Auth Success')}</span>
          </button>

          <button
            onClick={() => handleTestNotification('inventory')}
            className="p-3 rounded-2xl bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-orange-400 transition-all flex flex-col items-center text-center group"
          >
            <PackageCheck className="w-6 h-6 text-orange-500 mb-2 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold text-gray-900">{t('stockAlertBtn', 'Stock & Price Update')}</span>
            <span className="text-[10px] font-mono text-gray-500 mt-0.5">{t('stockAlertSub', 'Inventory Sync')}</span>
          </button>

          <button
            onClick={() => handleTestNotification('booking')}
            className="p-3 rounded-2xl bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-blue-400 transition-all flex flex-col items-center text-center group"
          >
            <Clock className="w-6 h-6 text-blue-500 mb-2 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold text-gray-900">{t('slotAlertBtn', 'Slot Reserved Confirm')}</span>
            <span className="text-[10px] font-mono text-gray-500 mt-0.5">{t('slotAlertSub', 'Atomic Booking')}</span>
          </button>

          <button
            onClick={() => handleTestNotification('hardware')}
            className="p-3 rounded-2xl bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-indigo-400 transition-all flex flex-col items-center text-center group"
          >
            <Fingerprint className="w-6 h-6 text-indigo-500 mb-2 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold text-gray-900">{t('hwAlertBtn', 'ESP32 Hardware Trigger')}</span>
            <span className="text-[10px] font-mono text-gray-500 mt-0.5">{t('hwAlertSub', 'Sensor Signal')}</span>
          </button>
        </div>
      </div>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4 border border-blue-100">
              <Clock className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">{t('reserveSlotTitle', 'Reserve Distribution Slot')}</h3>
            <p className="text-sm text-gray-500 mt-1">
              {t('reserveSlotDesc', 'Book a guaranteed distribution pickup slot using our real-time reservation protocol to avoid wait times.')}
            </p>
          </div>
          <button
            onClick={onNavigateToBookings}
            className="mt-6 w-full py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <span>{t('bookNextSlotBtn', 'Book Next Pickup Slot')}</span>
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>

        {/* Last Month's Claim Audit Log */}
        <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gray-50 text-green-600 flex items-center justify-center border border-gray-100">
                <PackageCheck className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-gray-900 text-sm">{t('lastMonthHistory', "Last Month's History")}</h3>
            </div>
            <span className="text-xs font-mono text-gray-500">{t('auditLog', 'Audit Log')}</span>
          </div>

          <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
            {recentClaims.length === 0 ? (
              <p className="text-xs text-gray-500 italic py-4 text-center">{t('noPastLogs', 'No past claim logs recorded yet.')}</p>
            ) : (
              recentClaims.map((claim) => (
                <div key={claim.id} className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-xs text-gray-900">
                      {(() => {
                        let items = claim.items_claimed || claim.items;
                        if (typeof items === 'string') {
                          try { items = JSON.parse(items); } catch(e) {}
                        }
                        if (Array.isArray(items)) {
                          return items.map(item => `${item.quantity} ${item.unit} ${item.item_name}`).join(' • ');
                        }
                        return t('standardQuota', 'Standard Commodity Quota');
                      })()}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {t('dispensedViaKiosk', 'Dispensed via Smart Kiosk')}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-green-100 text-green-700 border border-green-200">
                      {t('claimedBadge', 'CLAIMED')}
                    </span>
                    <div className="text-[11px] text-gray-500 font-mono mt-1">
                      {new Date(claim.slot_time || claim.claimed_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
