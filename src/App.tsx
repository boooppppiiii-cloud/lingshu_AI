/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AuthProvider } from './lib/AuthContext';
import { ToastProvider } from './lib/ToastContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import AuthModal from './components/AuthModal';
import CreativeWorkshop from './components/CreativeWorkshop';
import InspirationMarket from './components/InspirationMarket';
import AssetCardView from './components/AssetCardView';
import UserProfileView from './components/UserProfileView';
import { ViewState } from './types';

function AppShell() {
  const [activeView, setActiveView] = useState<ViewState>('workshop');
  const [authModalOpen, setAuthModalOpen] = useState(false);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-accent-blue/10 selection:text-accent-blue">
        <Sidebar activeView={activeView} onViewChange={setActiveView} />

        <Header onAuthClick={() => setAuthModalOpen(true)} />

        {/* Main Content Area */}
        <main className="ml-64 min-h-[calc(100vh-80px)] relative">
          {/* Background Decorative Gradient - Subtle for light version */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none overflow-hidden -z-10 opacity-40">
            <div className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] bg-accent-blue/5 rounded-full blur-[120px]" />
            <div className="absolute top-[20%] -right-[10%] w-[50%] h-[50%] bg-blue-400/5 rounded-full blur-[120px]" />
          </div>

          <div className="p-8 max-w-7xl mx-auto">
            <AnimatePresence mode="wait">
              {activeView === 'market' && (
                <motion.div
                  key="market"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <InspirationMarket />
                </motion.div>
              )}
              {activeView === 'workshop' && (
                <motion.div
                  key="workshop"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <CreativeWorkshop />
                </motion.div>
              )}
              {activeView === 'assets' && (
                <motion.div
                  key="assets"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <AssetCardView />
                </motion.div>
              )}
              {activeView === 'profile' && (
                <motion.div
                  key="profile"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <UserProfileView onRequestLogin={() => setAuthModalOpen(true)} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </ToastProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
