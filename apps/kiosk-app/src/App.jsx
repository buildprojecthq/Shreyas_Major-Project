import React, { useState } from 'react';
import SearchBar from './components/SearchBar';
import BeneficiaryCard from './components/BeneficiaryCard';
import AdminInventory from './components/AdminInventory';
import { QrCode, Shield, Package, Terminal, Cpu, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import AdminLogin from './components/AdminLogin';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState(null);
  const [activeTab, setActiveTab] = useState('kiosk'); // 'kiosk' or 'inventory'

  const [esp32Ip, setEsp32Ip] = useState(() => localStorage.getItem('esp32_ip') || '');

  const handleIpChange = (val) => {
    setEsp32Ip(val);
    localStorage.setItem('esp32_ip', val.trim());
  };

  if (!isAuthenticated) {
    return <AdminLogin onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen flex flex-col justify-between relative z-0">
      {/* Animated Deep Glassmorphism Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-gray-50">
        <motion.div
          className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-blue-400/20 blur-[120px]"
          animate={{ x: [0, 100, 0], y: [0, 50, 0] }}
          transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
        />
        <motion.div
          className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-green-400/20 blur-[120px]"
          animate={{ x: [0, -100, 0], y: [0, -50, 0] }}
          transition={{ repeat: Infinity, duration: 25, ease: "linear" }}
        />
      </div>

      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-2xl border-b border-gray-200 px-4 sm:px-8 py-3 shadow-sm">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-100 flex items-center justify-center border border-blue-200 shadow-sm">
              <QrCode className="w-6 h-6 text-blue-800 font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold text-gray-900 tracking-tight">
                  Admin Portal
                </h1>
              </div>
              <p className="text-xs text-gray-600 font-mono mt-0.5 flex items-center gap-2">
                <span>Biometric Authentication</span>
              </p>
            </div>
          </div>

          {/* Right Controls: ESP32 Hardware IP + Tab Pills */}
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            {/* Global ESP32 IP input */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-xs">
              <Cpu className="w-4 h-4 text-blue-600" />
              <span className="font-bold text-blue-900 font-mono">ESP32:</span>
              <input
                type="text"
                placeholder="192.168.x.x"
                value={esp32Ip}
                onChange={(e) => handleIpChange(e.target.value)}
                className="w-32 px-2 py-0.5 rounded bg-white border border-blue-300 font-mono text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
              />
            </div>

            {/* Navigation Tab Pills */}
            <div className="flex items-center gap-2 bg-gray-100 p-1.5 rounded-2xl border border-gray-200">
              <button
                onClick={() => setActiveTab('kiosk')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'kiosk' ? 'bg-white text-blue-800 border border-gray-300 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                <Users className="w-4 h-4" />
                <span>Beneficiary Lookup</span>
              </button>

              <button
                onClick={() => setActiveTab('inventory')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'inventory' ? 'bg-white text-blue-800 border border-gray-300 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                <Package className="w-4 h-4" />
                <span>Inventory Admin</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8 relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab + (selectedBeneficiary ? '-beneficiary' : '-search')}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="w-full"
          >
            {activeTab === 'kiosk' ? (
              <div>
                {!selectedBeneficiary ? (
                  <SearchBar onBeneficiaryFound={(user) => setSelectedBeneficiary(user)} />
                ) : (
                  <BeneficiaryCard
                    user={selectedBeneficiary}
                    onResetSearch={() => setSelectedBeneficiary(null)}
                  />
                )}
              </div>
            ) : (
              <AdminInventory />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer Info */}
      <footer className="border-t border-gray-200 py-6 bg-white mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500 font-mono">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-600" />
            <span>Face-API Biometric Sync</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
