import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { USER_ROLE_LABELS } from '../lib/userRoles';
import { useGameProfile } from '../lib/GameProfileContext';
import { gameProfileScopeFilterExpr } from '../lib/gameProfiles';
import { pb } from '../lib/pb';
import { UserProfile } from '../types';
import { User, Mail, Heart, Edit3, Save, LogOut, LogIn } from 'lucide-react';
import AssistantChatCardsSection from './AssistantChatCardsSection';
import AssistantAvatarCustomizer from './AssistantAvatarCustomizer';

interface UserProfileViewProps {
  onRequestLogin?: () => void;
}

export default function UserProfileView({ onRequestLogin }: UserProfileViewProps) {
  const { user, signOut } = useAuth();
  const { gameProfileId } = useGameProfile();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [totalLikes, setTotalLikes] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const fetchProfileAndLikes = async () => {
      const savedProfile = localStorage.getItem(`profile_${user.uid}`);
      if (savedProfile) {
        const data = JSON.parse(savedProfile) as UserProfile;
        setProfile(data);
        setNickname(data.nickname);
      } else {
        const defaultProfile: UserProfile = {
          uid: user.uid,
          nickname: user.displayName || '指挥官',
          email: user.email || 'mock@script.ai',
          likesReceived: 0
        };
        localStorage.setItem(`profile_${user.uid}`, JSON.stringify(defaultProfile));
        setProfile(defaultProfile);
        setNickname(defaultProfile.nickname);
      }

      try {
        const records = await pb.collection('market').getFullList({
          filter: `userId = ${JSON.stringify(user.uid)} && (${gameProfileScopeFilterExpr('gameProfileId', gameProfileId)})`,
        });
        let count = 0;
        records.forEach((r) => {
          count += Number(r.likes ?? 0);
        });
        setTotalLikes(count);
      } catch (err) {
        console.error('Error fetching market likes:', err);
      }

      setLoading(false);
    };

    void fetchProfileAndLikes();
  }, [user, gameProfileId]);

  const handleUpdateNickname = () => {
    if (!user || !nickname.trim()) return;
    try {
      const updatedProfile = { ...profile!, nickname };
      localStorage.setItem(`profile_${user.uid}`, JSON.stringify(updatedProfile));
      setProfile(updatedProfile);
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating nickname:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-sea-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-lg mx-auto py-24 px-4 text-center">
        <div className="glass-card p-10">
          <User className="w-12 h-12 text-accent-blue mx-auto mb-4" />
          <h2 className="text-xl font-bold text-primary-blue mb-2">请先登录</h2>
          <p className="text-slate-500 text-sm mb-6">登录后可查看个人资料与收到的点赞。</p>
          {onRequestLogin && (
            <button type="button" onClick={onRequestLogin} className="btn-primary inline-flex items-center gap-2">
              <LogIn className="w-4 h-4" />
              登录 / 注册
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="glass-card overflow-hidden relative bg-white">
        {/* Profile Header Background */}
        <div className="h-48 bg-gradient-to-r from-primary-blue via-accent-blue/10 to-blue-300/10 relative">
          <div className="absolute inset-0 backdrop-blur-3xl opacity-30" />
        </div>

        <div className="px-8 pb-12 -mt-16 relative">
          <div className="flex flex-col md:flex-row items-end gap-6 mb-8">
            <div className="w-32 h-32 rounded-3xl bg-white border-4 border-white overflow-hidden shadow-xl flex items-center justify-center">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <User className="w-16 h-16 text-accent-blue" />
              )}
            </div>
            
            <div className="flex-1 mb-2">
              <div className="flex items-center gap-3">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-2xl font-bold text-primary-blue outline-none focus:border-accent-blue/50"
                      autoFocus
                    />
                    <button
                      onClick={handleUpdateNickname}
                      className="p-2 bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 transition-colors cursor-pointer"
                    >
                      <Save className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <h2 className="text-3xl font-bold text-primary-blue tracking-tight">{profile?.nickname}</h2>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="p-1.5 text-slate-400 hover:text-primary-blue transition-colors cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
              <p className="text-slate-500 mt-1 flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-accent-blue/10 px-2 py-0.5 text-[11px] font-bold text-primary-blue">
                  {USER_ROLE_LABELS[user.role]}
                </span>
                <Mail className="w-4 h-4 text-slate-400" />
                {profile?.email}
              </p>
            </div>

            <div className="flex items-center gap-2 bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100 mb-2">
              <div className="text-right">
                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">收到的点赞</div>
                <div className="text-2xl font-black text-red-500">{totalLikes}</div>
              </div>
              <Heart className="w-8 h-8 text-red-500 fill-red-500/10 ml-2" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 border-t border-slate-100 pt-8 lg:grid-cols-2 lg:items-start">
            <AssistantAvatarCustomizer />
            <AssistantChatCardsSection onRequestLogin={onRequestLogin} />
          </div>

          <div className="border-t border-slate-100 pt-8">
            <button
              type="button"
              onClick={signOut}
              className="group flex w-full cursor-pointer items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-4 transition-all hover:border-red-100 hover:bg-red-50"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-red-50 p-2 text-red-500 group-hover:bg-red-100">
                  <LogOut className="h-5 w-5" />
                </div>
                <span className="font-bold text-slate-600 group-hover:text-red-600">退出登录</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
