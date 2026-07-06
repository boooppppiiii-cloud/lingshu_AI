/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ToastProvider } from './lib/ToastContext';
import { GameProfileProvider, useGameProfile } from './lib/GameProfileContext';
import { PageAssistantProvider } from './lib/PageAssistantContext';
import { AssistantAvatarProvider } from './lib/AssistantAvatarContext';
import { prefetchBuyingVideosList } from './lib/buyingVideosList';
import {
  getDefaultViewForRole,
  isViewAllowedForRole,
  resolveEffectiveRole,
} from './lib/userRoles';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import AuthModal from './components/AuthModal';
import DailyBriefingModal from './components/DailyBriefingModal';
import type { IterationHandoff, IterationVideoPayload } from './lib/iterationHandoff';
import { ViewState } from './types';

const CreativeWorkshop = lazy(() => import('./components/CreativeWorkshop'));
const InspirationMarket = lazy(() => import('./components/InspirationMarket'));
const BuyingDashboard = lazy(() => import('./components/BuyingDashboard'));
const AssetCardView = lazy(() => import('./components/AssetCardView'));
const UserProfileView = lazy(() => import('./components/UserProfileView'));
const VolumeSpaceView = lazy(() => import('./components/VolumeSpaceView'));
const TeamCasesView = lazy(() => import('./components/TeamCasesView'));

function ViewLoadingFallback() {
  return (
    <div className="flex justify-center py-24" role="status" aria-label="加载中">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent-blue/25 border-t-accent-blue" />
    </div>
  );
}

function AppShell() {
  const { user, loading: authLoading } = useAuth();
  const effectiveRole = resolveEffectiveRole(user?.role);
  const [activeView, setActiveView] = useState<ViewState>(() => getDefaultViewForRole(effectiveRole));
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [iterationHandoff, setIterationHandoff] = useState<IterationHandoff | null>(null);
  const { gameProfileId } = useGameProfile();
  const themeAttr = gameProfileId;
  const canAccessWorkshop = isViewAllowedForRole('workshop', effectiveRole);

  const sendBuyingVideoToIteration = useCallback(
    (video: IterationVideoPayload) => {
      if (!canAccessWorkshop) return;
      setIterationHandoff({ video, autoAnalyze: true });
      setActiveView('workshop');
    },
    [canAccessWorkshop],
  );

  const clearIterationHandoff = useCallback(() => {
    setIterationHandoff(null);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    setActiveView((current) =>
      isViewAllowedForRole(current, effectiveRole) ? current : getDefaultViewForRole(effectiveRole),
    );
  }, [authLoading, effectiveRole, user?.uid]);

  /** 登录后预取买量列表，进入买量大屏时可先读 session 缓存再后台同步 */
  useEffect(() => {
    if (authLoading || !user) return;
    prefetchBuyingVideosList(gameProfileId);
  }, [authLoading, user?.uid, gameProfileId]);

  const viewMotion = (key: string, children: React.ReactNode) => (
    <motion.div
      key={key}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      {children}
    </motion.div>
  );

  return (
    <ToastProvider>
      <div
        data-game-theme={themeAttr}
        className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-accent-blue/10 selection:text-accent-blue"
      >
        <Sidebar activeView={activeView} onViewChange={setActiveView} />

        <Header onAuthClick={() => setAuthModalOpen(true)} />

        <main className="ml-64 min-h-[calc(100vh-80px)] relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none overflow-hidden -z-10 opacity-40">
            {gameProfileId === 'xiyou_card' ? (
              <>
                <div className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] bg-emerald-500/10 rounded-full blur-[120px]" />
                <div className="absolute top-[20%] -right-[10%] w-[50%] h-[50%] bg-green-400/10 rounded-full blur-[120px]" />
              </>
            ) : gameProfileId === 'ace_mecha' ? (
              <>
                <div className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] bg-orange-500/10 rounded-full blur-[120px]" />
                <div className="absolute top-[20%] -right-[10%] w-[50%] h-[50%] bg-cyan-400/10 rounded-full blur-[120px]" />
              </>
            ) : (
              <>
                <div className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] bg-accent-blue/5 rounded-full blur-[120px]" />
                <div className="absolute top-[20%] -right-[10%] w-[50%] h-[50%] bg-blue-400/5 rounded-full blur-[120px]" />
              </>
            )}
          </div>

          <div
            className={`p-8 mx-auto ${
              activeView === 'buying_dashboard' ? 'max-w-[min(100%,1920px)]' : 'max-w-7xl'
            }`}
          >
            <AnimatePresence mode="wait">
              <Suspense fallback={<ViewLoadingFallback />}>
                {activeView === 'market' && viewMotion('market', <InspirationMarket />)}
                {activeView === 'buying_dashboard' &&
                  viewMotion(
                    'buying_dashboard',
                    <BuyingDashboard
                      canAccessWorkshop={canAccessWorkshop}
                      onSendToIteration={sendBuyingVideoToIteration}
                      onRequestLogin={() => setAuthModalOpen(true)}
                    />,
                  )}
                {activeView === 'workshop' &&
                  viewMotion(
                    'workshop',
                    <CreativeWorkshop
                      iterationHandoff={iterationHandoff}
                      onIterationHandoffConsumed={clearIterationHandoff}
                    />,
                  )}
                {activeView === 'assets' && viewMotion('assets', <AssetCardView />)}
                {activeView === 'volume_space' && viewMotion('volume_space', <VolumeSpaceView />)}
                {activeView === 'team_cases' && viewMotion('team_cases', <TeamCasesView />)}
                {activeView === 'profile' &&
                  viewMotion('profile', <UserProfileView onRequestLogin={() => setAuthModalOpen(true)} />)}
              </Suspense>
            </AnimatePresence>
          </div>
        </main>
      </div>

      <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      <DailyBriefingModal
        gameProfileId={gameProfileId}
        canAccessWorkshop={canAccessWorkshop}
        onOpenBuyingDashboard={() => setActiveView('buying_dashboard')}
        onOpenWorkshop={() => setActiveView('workshop')}
      />
    </ToastProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <GameProfileProvider>
        <AssistantAvatarProvider>
          <PageAssistantProvider>
            <AppShell />
          </PageAssistantProvider>
        </AssistantAvatarProvider>
      </GameProfileProvider>
    </AuthProvider>
  );
}
