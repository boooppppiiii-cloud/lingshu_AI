import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { AssetType, MarketItem } from '../types';
import { Search, Zap, MessageSquare, FileText, Layout, Heart, Share2, ChevronDown, Check, Trash2, Edit3, X } from 'lucide-react';
import { pb } from '../lib/pb';
import { recordToMarketItem } from '../lib/recordMappers';
import Markdown from 'react-markdown';

const CATEGORIES_BY_TAB: Record<string, string[]> = {
  full_script: ['theme', 'hook', 'selling_point', 'mood'],
  storyboard: ['conflict', 'mood', 'shot', 'camera', 'frame', 'action', 'audio', 'selling_point']
};

const CATEGORY_LABELS: Record<string, string> = {
  theme: '主题',
  plot: '情节',
  mood: '情绪',
  hook: '钩子',
  selling_point: '卖点',
  conflict: '冲突',
  shot: '景别',
  camera: '运镜',
  frame: '画面',
  action: '动作',
  audio: '配音'
};

export default function InspirationMarket() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [items, setItems] = useState<MarketItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AssetType | 'all'>('all');
  const [editingItem, setEditingItem] = useState<MarketItem | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  
  // Tag filters state
  const [filters, setFilters] = useState<Record<string, string>>({
    theme: '',
    plot: '',
    mood: '',
    hook: '',
    selling_point: '',
    conflict: '',
    shot: '',
    camera: '',
    frame: '',
    action: '',
    audio: ''
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const records = await pb.collection('market').getFullList({ sort: '-likes' });
        const mapped = records.map(recordToMarketItem);
        if (!cancelled) {
          setItems(mapped.sort((a, b) => (b.likes || 0) - (a.likes || 0)));
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setItems([]);
          showToast('加载灵感市场失败，请检查 PocketBase 与 market 集合', 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // Extract unique values for each category from existing items
  const filterOptions = useMemo(() => {
    const options: Record<string, string[]> = {};
    
    // Initialize all possible categories
    Object.keys(CATEGORY_LABELS).forEach(cat => {
      options[cat] = [];
    });

    items.forEach(item => {
      item.tags?.forEach(tag => {
        if (tag.includes(':')) {
          const [cat, val] = tag.split(':');
          if (cat && val && options[cat] && !options[cat].includes(val)) {
            options[cat].push(val);
          }
        }
      });
    });

    return options;
  }, [items]);

  const filteredItems = items
    .filter(a => 
      (a.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
       a.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
       a.userNickname.toLowerCase().includes(searchQuery.toLowerCase())) &&
      (activeTab === 'all' || a.type === activeTab) &&
      Object.entries(filters).every(([cat, val]) => !val || a.tags?.includes(`${cat}:${val}`))
    );

  const handleLike = async (itemId: string, liked: boolean) => {
    if (!user) return alert('请先登录以点赞');
    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    const newLikedBy = liked
      ? item.likedBy?.filter((id) => id !== user.uid)
      : [...(item.likedBy || []), user.uid];

    const newLikes = liked ? (item.likes || 0) - 1 : (item.likes || 0) + 1;

    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, likes: newLikes, likedBy: newLikedBy } : i))
    );

    try {
      await pb.collection('market').update(itemId, {
        likes: newLikes,
        likedBy: newLikedBy,
      });
    } catch (e) {
      console.error(e);
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, likes: item.likes, likedBy: item.likedBy } : i))
      );
      showToast('点赞更新失败', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要从灵感市场中删除这个创意吗？')) return;
    try {
      await pb.collection('market').delete(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      showToast('资产已移除', 'info');
    } catch (e) {
      console.error(e);
      showToast('删除失败', 'error');
    }
  };

  const handleEdit = (item: MarketItem) => {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditContent(item.content);
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    try {
      await pb.collection('market').update(editingItem.id, {
        title: editTitle,
        content: editContent,
      });

      setItems((prev) =>
        prev.map((i) =>
          i.id === editingItem.id ? { ...i, title: editTitle, content: editContent } : i
        )
      );
      setShowEditModal(false);
      setEditingItem(null);
      showToast('修改已保存');
    } catch (err) {
      console.error(err);
      showToast('保存失败', 'error');
    }
  };

  const iconMap = {
    prompt: <MessageSquare className="w-5 h-5" />,
    full_script: <FileText className="w-5 h-5" />,
    storyboard: <Layout className="w-5 h-5" />
  };

  const labelMap = {
    all: '全部资产',
    prompt: '提示词卡片',
    full_script: '整篇脚本卡片',
    storyboard: '分镜脚本卡片'
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4">
      <AnimatePresence>
        {showEditModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white border border-slate-200 rounded-[2.5rem] w-full max-w-xl p-10 shadow-2xl relative"
            >
               <button 
                onClick={() => setShowEditModal(false)}
                className="absolute top-8 right-8 p-2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>

              <h2 className="text-3xl font-black text-primary-blue mb-2 flex items-center gap-3">
                <Edit3 className="w-8 h-8 text-accent-blue" />
                编辑灵感市场卡片
              </h2>
              <p className="text-slate-500 mb-8">精修你的公开创意，让它更具吸引力。</p>

              <form onSubmit={handleSaveEdit} className="space-y-6">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-2 mb-2">卡片标题</label>
                  <input
                    required
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 outline-none focus:border-accent-blue/50 transition-all text-slate-800"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-2 mb-2">详细内容</label>
                  <textarea
                    required
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 h-64 outline-none focus:border-accent-blue/50 transition-all text-slate-800 resize-none"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="flex-1 px-8 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-bold transition-all"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-8 py-4 bg-primary-blue text-white rounded-2xl font-bold shadow-lg shadow-slate-200 hover:bg-slate-800 active:scale-95 transition-all"
                  >
                    保存修改
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
        <div className="max-w-2xl">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-4 bg-accent-blue/5 rounded-3xl shadow-inner shadow-accent-blue/10">
              <Zap className="w-10 h-10 text-accent-blue" />
            </div>
            <h1 className="text-5xl font-black text-primary-blue tracking-tighter">灵感市场</h1>
          </div>
          <p className="text-slate-500 text-lg">汇聚全球指挥官的奇思妙想，发现最动人的创意瞬间。</p>
        </div>
        
        <div className="relative group w-full md:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 group-focus-within:text-accent-blue transition-colors" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索创意、作者或内容..."
            className="w-full bg-white border border-slate-200 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-accent-blue transition-all text-slate-700 shadow-sm"
          />
        </div>
      </div>

      <div className="space-y-8 mb-12">
        <div className="flex flex-wrap items-center gap-3">
          {(['all', 'prompt', 'full_script', 'storyboard'] as const).map(tab => (
            <button
              key={`m-tab-${tab}`}
              onClick={() => {
                setActiveTab(tab);
                setFilters({
                  theme: '', plot: '', mood: '', hook: '', selling_point: '',
                  conflict: '', shot: '', camera: '', frame: '', action: '', audio: ''
                });
              }}
              className={`px-8 py-3 rounded-2xl text-sm font-black transition-all border cursor-pointer ${activeTab === tab ? 'bg-primary-blue text-white border-primary-blue shadow-lg shadow-slate-200' : 'bg-white text-slate-500 border-slate-200 hover:text-primary-blue hover:bg-slate-50'}`}
            >
              {labelMap[tab]}
            </button>
          ))}
        </div>

        {activeTab !== 'all' && activeTab !== 'prompt' && CATEGORIES_BY_TAB[activeTab] && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {CATEGORIES_BY_TAB[activeTab].map(cat => (
              <DropdownFilter 
                key={cat}
                label={CATEGORY_LABELS[cat] || cat.toUpperCase()}
                options={filterOptions[cat]}
                value={filters[cat]}
                onChange={(val) => setFilters(prev => ({ ...prev, [cat]: val }))}
              />
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-40">
          <div className="w-12 h-12 border-4 border-sea-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredItems.length > 0 ? (
        <div className="columns-1 md:columns-2 lg:columns-3 gap-6 space-y-6">
          {filteredItems.map(item => (
            <MarketCard 
              key={item.id} 
              item={item} 
              onLike={() =>
                void handleLike(item.id, item.likedBy?.includes(user?.uid || '') ?? false)
              }
              isLiked={item.likedBy?.includes(user?.uid || '')}
              isOwner={user?.uid === item.userId}
              onDelete={() => void handleDelete(item.id)}
              onEdit={() => handleEdit(item)}
              icon={iconMap[item.type as AssetType] || <Zap />}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-60 glass-card border-dashed">
          <Zap className="w-20 h-20 text-slate-700 mx-auto mb-6 opacity-20" />
          <p className="text-xl text-slate-500 font-bold">灵感尚未降临，快去创意工坊分享第一个吧</p>
        </div>
      )}
    </div>
  );
}

function DropdownFilter({ label, options, value, onChange }: { 
  label: string; 
  options: string[]; 
  value: string; 
  onChange: (val: string) => void 
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-4 py-3 bg-white border rounded-2xl text-xs font-black transition-all ${value ? 'border-accent-blue text-accent-blue shadow-sm' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}
      >
        <span>{value ? `${label}: ${value}` : label}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-50" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute left-0 right-0 mt-2 p-2 bg-white border border-slate-200 rounded-2xl shadow-xl z-[60] max-h-60 overflow-y-auto custom-scrollbar"
            >
              <button
                onClick={() => { onChange(''); setIsOpen(false); }}
                className="w-full text-left px-3 py-2 rounded-xl text-[10px] font-bold text-slate-400 hover:bg-slate-50 transition-colors"
              >
                清除筛选
              </button>
              {options.map((opt, idx) => (
                <button
                  key={`${opt}-${idx}`}
                  onClick={() => { onChange(opt); setIsOpen(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <span>{opt}</span>
                  {value === opt && <Check className="w-3 h-3 text-accent-blue" />}
                </button>
              ))}
              {options.length === 0 && (
                <div className="px-3 py-4 text-center text-[10px] text-slate-600 font-bold">暂无该维度标签</div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function MarketCard({ item, onLike, isLiked, isOwner, onDelete, onEdit, icon }: { 
  item: MarketItem; 
  onLike: () => void;
  isLiked: boolean;
  isOwner: boolean;
  onDelete: () => void;
  onEdit: () => void;
  icon: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(item.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      className="break-inside-avoid glass-card group flex flex-col hover:border-accent-blue/30 transition-all duration-500"
    >
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-accent-blue transition-colors">
              {icon}
            </div>
            <div>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{item.userNickname}</div>
              <div className="text-xs text-slate-400">
                {item.createdAt ? new Date(item.createdAt.seconds * 1000).toLocaleDateString() : '刚刚'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="p-2 text-slate-400 hover:text-primary-blue transition-colors"
              title="复制"
            >
               {copied ? <Check className="w-5 h-5 text-accent-blue" /> : <Share2 className="w-5 h-5" />}
            </button>
            {isOwner && (
              <>
                <button
                  onClick={onEdit}
                  className="p-2 text-slate-400 hover:text-accent-blue transition-colors"
                  title="编辑"
                >
                  <Edit3 className="w-5 h-5" />
                </button>
                <button
                  onClick={onDelete}
                  className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                  title="删除"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>

        <h3 className="text-xl font-black text-primary-blue mb-4 tracking-tight leading-tight">{item.title}</h3>
        
        <div className="markdown-body prose prose-slate prose-sm text-slate-600 mb-8 max-h-96 overflow-hidden relative">
          <Markdown>{item.content}</Markdown>
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none" />
        </div>

        <div className="flex items-center justify-between pt-6 border-t border-slate-100">
          <div className="flex flex-wrap gap-1.5 overflow-hidden">
            {item.tags?.map((tag, i) => {
              const uniqueKey = `m-tag-${item.id}-${tag}-${i}`;
              if (tag.includes(':')) {
                return null;
              }
              return (
                <span key={uniqueKey} className="px-3 py-1 bg-slate-50 rounded-full text-[10px] text-slate-500 border border-slate-100">#{tag}</span>
              );
            }).filter(Boolean)}
          </div>
          
          <button
            onClick={onLike}
            className={`flex items-center gap-2 px-4 py-2 rounded-2xl border transition-all ${isLiked ? 'bg-red-50 border-red-100 text-red-500' : 'bg-slate-50 border-slate-100 text-slate-400 hover:border-slate-200 hover:text-slate-600'}`}
          >
            <Heart className={`w-4 h-4 ${isLiked ? 'fill-red-500' : ''}`} />
            <span className="text-sm font-black">{item.likes || 0}</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
