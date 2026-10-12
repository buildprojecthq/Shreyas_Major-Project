import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import FaceLoginModal from './FaceLoginModal';
import { UserPlus, LogIn, ShieldCheck, AlertCircle, Loader2, Sparkles, Scan, Users, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';

export default function RegistrationForm({ onUserLogin, onOpenLanguageSelect }) {
  const { t, language, languages } = useLanguage();
  const [isRegistering, setIsRegistering] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [familyMembers, setFamilyMembers] = useState(1);
  const [rationId, setRationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [isFaceModalOpen, setIsFaceModalOpen] = useState(false);
  const [pendingUser, setPendingUser] = useState(null);

  // OTP State
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [generatedOtp, setGeneratedOtp] = useState('');
  const [enteredOtp, setEnteredOtp] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice('');

    if (!rationId.trim()) {
      setError('Ration Card ID is required.');
      return;
    }

    setLoading(true);

    try {
      if (isRegistering) {
        if (!name.trim() || !phone.trim()) {
          setError('All fields are required for new beneficiary registration.');
          setLoading(false);
          return;
        }

        // Check if ration ID already exists
        const { data: existing, error: checkError } = await supabase
          .from('users')
          .select('*')
          .eq('ration_id', rationId.trim())
          .single();

        if (existing) {
          setError('An account with this Ration ID already exists. Try signing in instead.');
          setLoading(false);
          return;
        }

        // Check if phone number already exists
        const { data: existingPhone } = await supabase
          .from('users')
          .select('ration_id')
          .eq('phone', phone.trim());

        if (existingPhone && existingPhone.length > 0) {
          setError(`This phone number is already registered. Please check the number.`);
          setLoading(false);
          return;
        }

        // Create new beneficiary user - AFTER OTP is verified
        // Instead of inserting now, we trigger the OTP mock SMS flow
        const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
        setGeneratedOtp(newOtp);
        setShowOtpInput(true);
        setLoading(false);

        // Trigger Toast after a 1.5s delay to simulate network delay
        setTimeout(() => {
          setToastMessage(`Message from Smart PDS: Your verification code is ${newOtp}`);
          setShowToast(true);
          // Auto-hide toast after 7 seconds
          setTimeout(() => setShowToast(false), 7000);
        }, 1500);

        return;
      } else {
        // Sign in with existing Ration ID
        const { data: user, error: fetchError } = await supabase
          .from('users')
          .select('*')
          .eq('ration_id', rationId.trim())
          .single();

        if (fetchError || !user) {
          setError('No beneficiary found with this Ration ID. Please register first.');
          setLoading(false);
          return;
        }

        // If the user has a registered face, force biometric verification
        if (user.face_encoding) {
          setPendingUser(user);
          setIsFaceModalOpen(true);
        } else {
          // Otherwise login directly (or they could be forced to register a face at kiosk)
          onUserLogin(user);
        }
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'An unexpected database error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (enteredOtp !== generatedOtp) {
      setError("Incorrect OTP. Please try again.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{
          ration_id: rationId.trim(),
          name: name.trim(),
          phone: phone.trim(),
          family_members: parseInt(familyMembers, 10) || 1,
          face_encoding: null,
          fingerprint_id: null,
          is_enrolling: false
        }])
        .select()
        .single();

      if (insertError) {
        if (insertError.message.includes('fetch') || insertError.message.includes('connection') || insertError.code === 'PGRST301') {
          const demoUser = {
            ration_id: rationId.trim(),
            name: name.trim(),
            phone: phone.trim(),
            family_members: parseInt(familyMembers, 10) || 1,
            face_encoding: null,
            fingerprint_id: null,
            is_enrolling: false,
            is_demo: true
          };
          onUserLogin(demoUser);
          return;
        }
        throw insertError;
      }
      onUserLogin(newUser);
    } catch (err) {
      console.error(err);
      setError(err.message || 'An unexpected database error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = (type) => {
    if (type === 'pending') {
      onUserLogin({
        ration_id: 'RAT-1001',
        name: 'Rahul Kumar',
        phone: '+91 9876543210',
        face_encoding: null,
        fingerprint_id: null,
        is_enrolling: false,
        is_demo: true
      });
    } else {
      onUserLogin({
        ration_id: 'RAT-9999',
        name: 'Anjali Sharma',
        phone: '+91 9123456789',
        face_encoding: Array(128).fill(0.123),
        fingerprint_id: 'ESP32_FP_7788',
        is_enrolling: false,
        is_demo: true
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 md:p-8 relative overflow-hidden bg-gray-50">
      {/* Background Image Layer */}
      <div
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-60"
        style={{ backgroundImage: 'url("/login_reg_bg.jpg")' }}
      ></div>

      {/* Light Overlay */}
      <div className="absolute inset-0 bg-white/30 z-10 backdrop-blur-sm" />

      {/* Top-Right Language Switcher Button */}
      {onOpenLanguageSelect && (
        <button
          type="button"
          onClick={onOpenLanguageSelect}
          className="absolute top-4 right-4 sm:top-6 sm:right-6 z-30 px-3.5 py-2 rounded-2xl bg-white/70 hover:bg-white text-gray-800 hover:text-blue-700 border border-white/60 shadow-lg backdrop-blur-md transition-all flex items-center gap-2 text-xs font-bold hover:scale-105 active:scale-95 group"
          title={t('changeLanguage', 'Change Language')}
        >
          <Globe className="w-4 h-4 text-blue-600 transition-transform group-hover:rotate-12" />
          <span>{languages.find(l => l.id === language)?.native || 'English'}</span>
        </button>
      )}

      {/* Mock SMS Toast */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 20, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-0 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none"
          >
            <div className="bg-gray-900 text-white px-6 py-4 rounded-2xl shadow-2xl border border-gray-700 flex items-start gap-4 max-w-sm w-full pointer-events-auto">
              <div className="bg-blue-600 rounded-full p-2 mt-0.5">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">New SMS Message</p>
                <p className="text-sm font-medium text-gray-100">{toastMessage}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div
          key={isRegistering ? 'register' : 'login'}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="w-full max-w-md bg-white/30 backdrop-blur-xl border border-white/40 shadow-2xl rounded-3xl p-6 sm:p-8 relative overflow-hidden z-20"
        >

          <div className="text-center mb-6 relative z-10">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
              {t('loginTitle', 'Smart Ration Portal')}
            </h1>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-blue-600/10 border border-blue-600/30 flex items-start gap-3 text-blue-800 text-sm">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <span className="font-semibold">{error}</span>
            </div>
          )}

          {showOtpInput ? (
            <form onSubmit={handleVerifyOtp} className="space-y-4 relative z-10">
              <div className="text-center mb-6">
                <ShieldCheck className="w-12 h-12 text-blue-600 mx-auto mb-2" />
                <h2 className="text-xl font-bold text-gray-900">Verify Phone Number</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Enter the 6-digit code sent to <br /> <strong>+91 {phone}</strong>
                </p>
              </div>

              <div>
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="------"
                  value={enteredOtp}
                  onChange={(e) => setEnteredOtp(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-4 rounded-xl bg-white/60 border border-white/60 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 text-gray-900 font-mono text-center text-3xl tracking-[0.5em] transition-all outline-none backdrop-blur-sm"
                />
              </div>

              <button
                type="submit"
                disabled={loading || enteredOtp.length !== 6}
                className="w-full btn-primary mt-6 group flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                <span>Verify & Complete</span>
              </button>
              <button
                type="button"
                onClick={() => setShowOtpInput(false)}
                className="w-full mt-4 text-sm text-gray-500 hover:text-blue-600 font-medium transition-colors"
              >
                ← Back to Registration
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-2">
                  {t('cardIdOrPhone', 'Ration Card ID')}
                </label>
                <input
                  type="text"
                  required
                  maxLength={12}
                  placeholder={t('cardIdPlaceholder', 'e.g. 123456789012')}
                  value={rationId}
                  onChange={(e) => setRationId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  className="w-full px-4 py-3 rounded-xl bg-white/60 border border-white/60 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 text-gray-900 placeholder-gray-500 font-mono transition-all outline-none backdrop-blur-sm"
                />
              </div>

              {isRegistering && (
                <>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-2">
                      Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Rahul Kumar"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-white/60 border border-white/60 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 text-gray-900 placeholder-gray-500 transition-all outline-none backdrop-blur-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-2">
                      Phone Number
                    </label>
                    <div className="flex items-center rounded-xl bg-white/60 border border-white/60 focus-within:bg-white focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/20 transition-all backdrop-blur-sm overflow-hidden">
                      <div className="pl-4 pr-3 py-3 text-gray-600 font-mono font-bold flex items-center border-r border-gray-300">
                        <span>+91</span>
                      </div>
                      <input
                        type="tel"
                        required
                        maxLength={10}
                        placeholder="9876543210"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                        className="w-full px-3 py-3 bg-transparent text-gray-900 placeholder-gray-500 font-mono outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                        Family Members
                      </label>
                    </div>
                    <div className="flex items-center rounded-xl bg-white/60 border border-white/60 focus-within:bg-white focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/20 transition-all backdrop-blur-sm overflow-hidden">
                      <div className="pl-4 pr-3 py-3 text-gray-600 flex items-center border-r border-gray-300">
                        <Users className="w-5 h-5 text-blue-600" />
                      </div>
                      <input
                        type="number"
                        required
                        min={1}
                        max={10}
                        value={familyMembers}
                        onChange={(e) => {
                          const val = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
                          setFamilyMembers(val);
                        }}
                        className="w-full px-3 py-3 bg-transparent text-gray-900 font-mono outline-none"
                      />
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">
                      Dynamic PDS allotment: 100g subsidized rice allocated per household member.
                    </p>
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary mt-6 group flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Connecting...</span>
                  </>
                ) : isRegistering ? (
                  <>
                    <UserPlus className="w-5 h-5 transition-transform group-hover:scale-110" />
                    <span>Register User</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-5 h-5 transition-transform group-hover:scale-110" />
                    <span>{t('enterPortal', 'Access Digital Card')}</span>
                  </>
                )}
              </button>
            </form>
          )}

          {!showOtpInput && (
            <div className="mt-6 text-center border-t border-gray-300/50 pt-6 relative z-10">
              <button
                type="button"
                onClick={() => {
                  setIsRegistering(!isRegistering);
                  setError(null);
                }}
                className="text-sm text-gray-500 hover:text-blue-800 font-medium transition-colors"
              >
                {isRegistering ? (
                  <span>Already registered? <strong className="text-blue-800 underline">Sign in</strong></span>
                ) : (
                  <span>New user? <strong className="text-blue-800 underline">Create account</strong></span>
                )}
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Face Login Modal */}
      <FaceLoginModal
        isOpen={isFaceModalOpen}
        user={pendingUser}
        onClose={() => {
          setIsFaceModalOpen(false);
          setPendingUser(null);
        }}
        onUserLogin={onUserLogin}
      />
    </div>
  );
}
