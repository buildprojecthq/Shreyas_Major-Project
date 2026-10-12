import React, { useState, useEffect } from 'react';
import RegistrationForm from './components/RegistrationForm';
import LanguageSelectionScreen from './components/LanguageSelectionScreen';
import Dashboard from './components/Dashboard';
import InventoryView from './components/InventoryView';
import SlotBooking from './components/SlotBooking';
import NotificationToast from './components/NotificationToast';
import { notificationService } from './lib/notificationService';
import { supabase } from './lib/supabaseClient';
import { ShieldCheck, LayoutDashboard, Package, Calendar, LogOut, Smartphone, User, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LanguageProvider, useLanguage } from './context/LanguageContext';

function MainApp() {
  const { language, setLanguage, languages, t } = useLanguage();
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('smart_ration_active_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [languageSelected, setLanguageSelected] = useState(() => {
    return Boolean(localStorage.getItem('smart_ration_language'));
  });

  // Global subscriber for Supabase WebSockets & local BroadcastChannel
  useEffect(() => {
    const channel = supabase.channel('smart-ration-global')
      .on('broadcast', { event: 'INVENTORY_UPDATE' }, (data) => {
        const payload = data.payload;
        if (payload) {
          const isZero = parseFloat(payload.quantity_available) === 0;
          notificationService.sendAlert({
            type: 'inventory',
            title: isZero ? `⚠️ Out of Stock: ${payload.item_name}` : `🌾 Stock Replenished: ${payload.item_name}`,
            body: isZero ? `${payload.item_name} is currently out of stock.` : `Stock updated to ${payload.quantity_available} ${payload.unit || 'kg'}.`
          });
        }
      })
      .on('broadcast', { event: 'INVENTORY_ADD' }, (data) => {
        const payload = data.payload;
        if (payload) {
          notificationService.sendAlert({
            type: 'inventory',
            title: `✨ New Commodity Added!`,
            body: `Now offering "${payload.item_name}" at ₹${Number(payload.unit_price).toFixed(2)}/${payload.unit || 'unit'}.`
          });
        }
      })
      .on('broadcast', { event: 'BIOMETRICS_VERIFIED' }, (data) => {
        const payload = data.payload;
        if (payload) {
          notificationService.sendAlert({
            type: 'biometric',
            title: `🛡️ Biometrics Verified!`,
            body: `Ration Card ${payload.ration_id || 'ID'} verified via 128-pt neural face encoding.`
          });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('smart_ration_active_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('smart_ration_active_user');
    }
  }, [currentUser]);

  const handleLogout = () => {
    setCurrentUser(null);
    setActiveTab('dashboard');
  };

  if (!currentUser) {
    if (!languageSelected) {
      return (
        <LanguageSelectionScreen
          onLanguageSelect={(lang) => {
            setLanguage(lang);
            setLanguageSelected(true);
          }}
          onBack={Boolean(localStorage.getItem('smart_ration_language')) ? () => setLanguageSelected(true) : undefined}
        />
      );
    }
    return (
      <>
        <NotificationToast />
        <RegistrationForm
          onUserLogin={(user) => setCurrentUser(user)}
          onOpenLanguageSelect={() => setLanguageSelected(false)}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen pb-20 sm:pb-12 relative z-0">
      {/* Animated Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-gray-50">
        <motion.div
          className="absolute top-[-20%] left-[-20%] w-[70vw] h-[70vw] rounded-full bg-blue-500/15 blur-[100px]"
          animate={{ x: [0, 50, 0], y: [0, 100, 0] }}
          transition={{ repeat: Infinity, duration: 18, ease: "linear" }}
        />
        <motion.div
          className="absolute bottom-[-10%] right-[-20%] w-[70vw] h-[70vw] rounded-full bg-cyan-400/15 blur-[100px]"
          animate={{ x: [0, -50, 0], y: [0, -50, 0] }}
          transition={{ repeat: Infinity, duration: 22, ease: "linear" }}
        />
      </div>

      <NotificationToast />

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 bg-white/70 backdrop-blur-2xl border-b border-gray-200 px-4 sm:px-8 py-3.5 transition-all shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-200 shadow-sm">
              <Smartphone className="w-5 h-5 text-blue-700 font-bold" />
            </div>
            <div>
              <h1 className="font-extrabold text-base sm:text-lg text-gray-900 tracking-tight">
                {t('appName', 'Smart Ration App')}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-4">
            {/* Language Switcher Button */}
            <button
              onClick={() => setShowLanguageModal(true)}
              className="px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-blue-50 text-gray-700 hover:text-blue-700 border border-gray-200 transition-all flex items-center gap-1.5 text-xs font-bold shadow-sm"
              title={t('changeLanguage', 'Change Language')}
            >
              <Globe className="w-3.5 h-3.5 text-blue-600" />
              <span>{languages.find(l => l.id === language)?.native || 'English'}</span>
            </button>

            <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200 shadow-sm">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                <User className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-bold text-gray-700">{currentUser.name}</span>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-gray-200 text-blue-700">{currentUser.ration_id}</span>
            </div>

            <button
              onClick={handleLogout}
              className="px-3 py-2 text-xs rounded-xl bg-gray-50 hover:bg-red-50 text-gray-600 hover:text-red-600 border border-gray-200 hover:border-red-200 transition-all flex items-center gap-1.5 font-bold shadow-sm"
              title="Sign out of digital card"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t('signOut', 'Sign Out')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Language Switcher Modal */}
      {showLanguageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-gray-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2 text-gray-900 font-bold">
                <Globe className="w-5 h-5 text-blue-600" />
                <span>{t('selectLanguage', 'Select Language')}</span>
              </div>
              <button
                onClick={() => setShowLanguageModal(false)}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto">
              {languages.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setLanguage(item.id);
                    setShowLanguageModal(false);
                  }}
                  className={`px-4 py-3 rounded-xl flex items-center justify-between transition-all text-left ${
                    language === item.id
                      ? 'bg-blue-50 border border-blue-300 text-blue-800 font-bold'
                      : 'hover:bg-gray-50 border border-transparent text-gray-700'
                  }`}
                >
                  <span className="text-base">{item.native}</span>
                  <span className="text-xs text-gray-500 font-medium">{item.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 sm:px-8 mt-6 relative overflow-x-hidden pb-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-full"
          >
            {activeTab === 'dashboard' && (
              <Dashboard
                user={currentUser}
                onUserUpdated={(updated) => setCurrentUser(updated)}
                onNavigateToBookings={() => setActiveTab('bookings')}
              />
            )}
            {activeTab === 'inventory' && <InventoryView user={currentUser} />}
            {activeTab === 'bookings' && <SlotBooking user={currentUser} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Floating Navigation Tabs */}
      <nav className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 bg-white/90 backdrop-blur-xl border border-gray-200 shadow-xl rounded-2xl p-1.5 flex items-center gap-2 w-full max-w-sm px-3">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${activeTab === 'dashboard' ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          <span>{t('myCard', 'My Card')}</span>
        </button>

        <button
          onClick={() => setActiveTab('inventory')}
          className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${activeTab === 'inventory' ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
        >
          <Package className="w-4 h-4" />
          <span>{t('shopStock', 'Shop Stock')}</span>
        </button>

        <button
          onClick={() => setActiveTab('bookings')}
          className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${activeTab === 'bookings' ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
        >
          <Calendar className="w-4 h-4" />
          <span>{t('slots', 'Slots')}</span>
        </button>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <MainApp />
    </LanguageProvider>
  );
}

