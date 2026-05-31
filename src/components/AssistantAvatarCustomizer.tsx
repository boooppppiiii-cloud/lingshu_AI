import { useMemo, useState } from 'react';
import { ChevronDown, RotateCcw, Scissors } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useAssistantAvatar } from '../lib/AssistantAvatarContext';
import {
  ASSISTANT_AVATAR_CATEGORIES,
  type AssistantAvatarCategory,
  type AssistantAvatarConfig,
  type AssistantAvatarOption,
} from '../lib/assistantAvatar';
import SanBotAvatar from './SanBotAvatar';

function previewConfig(
  base: AssistantAvatarConfig,
  key: AssistantAvatarCategory,
  value: AssistantAvatarOption,
): AssistantAvatarConfig {
  return { ...base, [key]: value };
}

export default function AssistantAvatarCustomizer() {
  const { user } = useAuth();
  const { avatar, setAvatarOption, resetAvatar } = useAssistantAvatar();
  const [salonOpen, setSalonOpen] = useState(false);

  const previewAvatar = useMemo(() => avatar, [avatar]);

  if (!user) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center text-sm text-slate-500">
        登录后可进入小三郎的发廊
      </div>
    );
  }

  if (!salonOpen) {
    return (
      <button
        type="button"
        onClick={() => setSalonOpen(true)}
        className="group flex w-full flex-col items-center gap-4 rounded-2xl border border-accent-blue/25 bg-gradient-to-br from-sky-50 via-white to-violet-50/40 p-8 text-center shadow-sm transition hover:border-accent-blue/45 hover:shadow-md"
      >
        <div className="flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 shadow-sm ring-1 ring-accent-blue/15">
          <Scissors className="h-4 w-4 text-primary-blue" />
          <span className="text-sm font-black text-primary-blue">小三郎的发廊</span>
        </div>
        <SanBotAvatar avatar={previewAvatar} waving className="!h-[96px] !w-[84px]" />
        <div>
          <p className="text-sm font-bold text-slate-700 group-hover:text-primary-blue">点击进入 · 定制形象</p>
          <p className="mt-1 text-xs text-slate-500">发型、姿势、配色与配饰，同步至侧栏 SA小三郎</p>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-blue">
          进入发廊
          <ChevronDown className="h-3.5 w-3.5 -rotate-90 transition group-hover:translate-x-0.5" />
        </span>
      </button>
    );
  }

  return (
    <section className="space-y-5 rounded-2xl border border-accent-blue/20 bg-gradient-to-b from-sky-50/50 to-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-primary-blue" />
          <div>
            <h3 className="text-sm font-black text-primary-blue">小三郎的发廊</h3>
            <p className="mt-0.5 text-xs text-slate-500">换装会同步到侧栏，设置保存在本机浏览器</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSalonOpen(false)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
          >
            收起发廊
          </button>
          <button
            type="button"
            onClick={resetAvatar}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 rounded-xl border border-accent-blue/15 bg-white/80 px-4 py-6">
        <SanBotAvatar avatar={previewAvatar} waving className="!h-[88px] !w-[76px]" />
        <p className="text-[11px] font-medium text-slate-500">当前形象预览</p>
      </div>

      <div className="max-h-[min(52vh,480px)] space-y-5 overflow-y-auto pr-1 custom-scrollbar">
        {ASSISTANT_AVATAR_CATEGORIES.map((cat) => (
          <div key={cat.key}>
            <p className="mb-2 text-xs font-bold text-slate-600">{cat.label}</p>
            <div className="grid grid-cols-3 gap-2">
              {cat.options.map((label, idx) => {
                const option = idx as AssistantAvatarOption;
                const selected = avatar[cat.key] === option;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setAvatarOption(cat.key, option)}
                    className={`flex flex-col items-center gap-2 rounded-xl border px-2 py-3 transition ${
                      selected
                        ? 'border-accent-blue bg-accent-blue/10 ring-2 ring-accent-blue/30'
                        : 'border-slate-200 bg-white hover:border-accent-blue/40'
                    }`}
                  >
                    <SanBotAvatar
                      avatar={previewConfig(avatar, cat.key, option)}
                      compact
                      className="pointer-events-none"
                    />
                    <span
                      className={`text-center text-[10px] font-bold leading-tight ${
                        selected ? 'text-primary-blue' : 'text-slate-600'
                      }`}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
