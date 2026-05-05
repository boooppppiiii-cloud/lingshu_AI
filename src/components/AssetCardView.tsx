import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { Asset, AssetType } from '../types';
import { Search, FolderHeart, MessageSquare, FileText, Layout, Copy, Share2, Trash2, CheckCircle2, Plus, X, Heart, Edit3, Sparkles, Zap } from 'lucide-react';
import { pb } from '../lib/pb';
import { buildAssetCreateBody, buildMarketCreateBody, recordToAsset } from '../lib/recordMappers';
import { logUsageEvent } from '../lib/logUsageEvent';
import { USAGE_EVENT } from '../lib/usageEvents';
import Markdown from 'react-markdown';

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

export default function AssetCardView() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<AssetType>('prompt');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);

  // Manual Creation State
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [structuredTags, setStructuredTags] = useState<{id: string, category: string, value: string}[]>([]);

  const CATEGORIES_CONFIG = {
    full_script: [
      { id: 'theme', label: '主题' },
      { id: 'hook', label: '钩子' },
      { id: 'selling_point', label: '卖点' },
      { id: 'mood', label: '情绪' }
    ],
    storyboard: [
      { id: 'theme', label: '主题' },
      { id: 'hook', label: '钩子' },
      { id: 'selling_point', label: '卖点' },
      { id: 'mood', label: '情绪' }
    ],
    // These are for the market but we keep them here if needed for parsing
    _storyboard_market: [
      { id: 'conflict', label: '冲突' },
      { id: 'mood', label: '情绪' },
      { id: 'shot', label: '景别' },
      { id: 'camera', label: '运镜' },
      { id: 'frame', label: '画面' },
      { id: 'action', label: '动作' },
      { id: 'audio', label: '配音' },
      { id: 'selling_point', label: '卖点' }
    ]
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const records = await pb.collection('assets').getFullList({
          filter: `userId = ${JSON.stringify(user.uid)} && type = ${JSON.stringify(activeTab)}`,
          sort: '-created',
        });
        if (!cancelled) setAssets(records.map(recordToAsset));
      } catch (e) {
        console.error(e);
        if (!cancelled) setAssets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, activeTab]);

  const filteredAssets = assets
    .filter(a => 
      a.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      a.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.tags && a.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase())))
    );

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要删除这个资产吗？')) return;
    try {
      await pb.collection('assets').delete(id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
      showToast('资产已移除', 'info');
    } catch (e) {
      console.error(e);
      showToast('删除失败', 'error');
    }
  };

  const handleEdit = (asset: Asset) => {
    setEditingAsset(asset);
    setNewTitle(asset.title);
    setNewContent(asset.content);
    
    // Parse tags: separate keywords and structured tags
    const keywordTags: string[] = [];
    const struct: {id: string, category: string, value: string}[] = [];
    
    (asset.tags || []).forEach(tag => {
      if (tag.includes(':')) {
        const [cat, ...valParts] = tag.split(':');
        if (cat === 'shot_tag') return; // Hide shot_tag from edit modal
        const val = valParts.join(':');
        const config = (CATEGORIES_CONFIG[asset.type as keyof typeof CATEGORIES_CONFIG] || []);
        const found = config.find(c => c.id === cat);
        if (found) {
          struct.push({ id: `edit-${cat}-${Math.random().toString(36).substr(2, 9)}`, category: cat, value: val });
        } else {
          keywordTags.push(tag);
        }
      } else {
        keywordTags.push(tag);
      }
    });

    setNewTags(keywordTags.join(', '));
    setStructuredTags(struct);
    setShowCreateModal(true);
  };

  const handleCreateOrUpdateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTitle.trim() || !newContent.trim()) return;

    setLoading(true);
    const keywords = newTags.split(/[，,]/).map((t) => t.trim()).filter(Boolean);
    const sTags = structuredTags
      .filter((st) => st.value.trim())
      .map((st) => `${st.category}:${st.value.trim()}`);

    const combinedTags = [...new Set([...keywords, ...sTags])];
    const finalContent = newContent;

    try {
      if (editingAsset) {
        await pb.collection('assets').update(editingAsset.id, {
          title: newTitle,
          content: finalContent,
          tags: combinedTags,
        });
        setAssets((prev) =>
          prev.map((a) =>
            a.id === editingAsset.id
              ? { ...a, title: newTitle, content: finalContent, tags: combinedTags }
              : a
          )
        );
        setEditingAsset(null);
        showToast('资产已更新');
      } else {
        const record = await pb.collection('assets').create(
          buildAssetCreateBody({
            userId: user.uid,
            type: activeTab,
            title: newTitle,
            content: finalContent,
            tags: combinedTags,
            likes: 0,
            likedBy: [],
          })
        );
        setAssets((prev) => [recordToAsset(record), ...prev]);
        if (activeTab === 'inspiration') {
          void logUsageEvent(user.uid, USAGE_EVENT.CREATIVE_INSPIRATION_SAVED, {
            source: 'asset_card_view',
            refCollection: 'assets',
            refId: record.id,
            meta: { asset_type: activeTab },
          });
        }
      }

      setShowCreateModal(false);
      resetForm();
    } catch (err) {
      console.error(err);
      showToast('保存失败，请检查 PocketBase 与 assets 集合', 'error');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setNewTitle('');
    setNewContent('');
    setNewTags('');
    setStructuredTags([]);
  };

  const handleAddStructuredTag = () => {
    const config = CATEGORIES_CONFIG[activeTab as keyof typeof CATEGORIES_CONFIG];
    if (!config) return;
    setStructuredTags(prev => [...prev, { id: `new-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, category: config[0].id, value: '' }]);
  };

  const updateStructuredTag = (id: string, field: 'category' | 'value', val: string) => {
    setStructuredTags(prev => prev.map(st => st.id === id ? { ...st, [field]: val } : st));
  };

  const removeStructuredTag = (id: string) => {
    setStructuredTags(prev => prev.filter(st => st.id !== id));
  };

  const handleShareToMarket = async (asset: Asset) => {
    if (!user) return;
    setLoading(true);

    const combinedTags = [...(asset.tags || [])];

    if (asset.type === 'full_script' || asset.type === 'storyboard') {
      (asset.tags || []).forEach((t) => {
        if (t.includes(':')) {
          const [cat, val] = t.split(':');
          if (cat === 'shot_tag') return;
          const st = `shot_tag:${cat}_${val}`;
          if (!combinedTags.includes(st)) {
            combinedTags.push(st);
          }
        }
      });
    }

    const hasStructured = combinedTags.some((t) => t.includes(':') && !t.startsWith('shot_tag:'));

    if (!hasStructured) {
      const extraTags: string[] = [];
      const content = asset.content;

      const extract = (label: string, category: string) => {
        const regex = new RegExp(`${label}[:：]\\s*([^\\n\\r]+)`, 'i');
        const match = content.match(regex);
        if (match && match[1]) {
          const val = match[1].trim();
          if (val && val !== '未设置' && val !== '无') {
            extraTags.push(`${category}:${val}`);
          }
        }
      };

      if (asset.type === 'storyboard') {
        extract('核心冲突', 'conflict');
        extract('情绪', 'mood');
        extract('景别', 'shot');
        extract('运镜', 'camera');
        extract('画面', 'frame');
        extract('动作', 'action');
        extract('配音', 'audio');
        extract('核心卖点', 'selling_point');
      } else if (asset.type === 'full_script') {
        extract('主题', 'theme');
        extract('钩子', 'hook');
        extract('核心卖点', 'selling_point');
        extract('情绪', 'mood');
      }

      extraTags.forEach((et) => {
        if (!combinedTags.includes(et)) {
          combinedTags.push(et);
        }
      });
    }

    try {
      const marketRecord = await pb.collection('market').create(
        buildMarketCreateBody({
          userId: user.uid,
          userNickname: user.displayName || '匿名用户',
          assetId: asset.id,
          type: asset.type,
          title: asset.title,
          content: asset.content,
          tags: combinedTags,
          likes: 0,
          likedBy: [],
        })
      );
      void logUsageEvent(user.uid, USAGE_EVENT.MARKET_PUBLISHED, {
        source: 'asset_card_view',
        refCollection: 'market',
        refId: marketRecord.id,
        meta: { asset_id: asset.id, type: asset.type },
      });
      showToast('已成功上传至灵感市场！');
    } catch (e) {
      console.error(e);
      showToast('上架失败，请检查 PocketBase 与 market 集合', 'error');
    } finally {
      setLoading(false);
    }
  };

  const iconMap = {
    prompt: <MessageSquare className="w-5 h-5" />,
    full_script: <FileText className="w-5 h-5" />,
    storyboard: <Layout className="w-5 h-5" />,
    inspiration: <Sparkles className="w-5 h-5" />,
    visual_detail: <Zap className="w-5 h-5" />
  };

  const labelMap = {
    prompt: '提示词',
    full_script: '整篇脚本',
    storyboard: '分镜脚本',
    inspiration: '灵感卡片',
    visual_detail: '画面与口令'
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-4xl font-bold text-primary-blue mb-2 flex items-center gap-3">
            <FolderHeart className="w-10 h-10 text-accent-blue" />
            资产卡片
          </h1>
          <p className="text-slate-500">管理你的私人灵感库，收藏优秀的创意与脚本。</p>
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-primary-blue hover:bg-slate-800 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg shadow-slate-200 cursor-pointer"
          >
            <Plus className="w-5 h-5" />
            手动上传
          </button>
          
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            {(['prompt', 'inspiration', 'visual_detail', 'full_script', 'storyboard'] as AssetType[]).map(tab => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                }}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === tab ? 'bg-white text-primary-blue shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {labelMap[tab]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white border border-slate-200 rounded-[2.5rem] w-full max-w-xl p-10 shadow-2xl relative"
            >
              <button 
                onClick={() => setShowCreateModal(false)}
                className="absolute top-8 right-8 p-2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>

              <h2 className="text-3xl font-black text-primary-blue mb-2 flex items-center gap-3">
                {editingAsset ? <Edit3 className="w-8 h-8 text-accent-blue" /> : <Plus className="w-8 h-8 text-accent-blue" />}
                {editingAsset ? '编辑' : '新增'}{labelMap[activeTab]}
              </h2>
              <p className="text-slate-500 mb-8">{editingAsset ? '修改你的资产内容。' : '手动录入你的灵感及创意资产。'}</p>

              <form onSubmit={handleCreateOrUpdateAsset} className="space-y-6 max-h-[60vh] overflow-y-auto pr-4 custom-scrollbar">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-2 mb-2">资产标题</label>
                  <input
                    required
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="给你的灵感起个名字..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 outline-none focus:border-accent-blue/50 transition-all text-slate-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-2 mb-2">内容详情</label>
                  <textarea
                    required
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder="输入详细的创意描述、脚本或标签内容..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 h-40 outline-none focus:border-accent-blue/50 transition-all text-slate-800 resize-none"
                  />
                </div>

                {(activeTab === 'full_script' || activeTab === 'storyboard') && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between ml-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">检索标签 (用于市场筛选)</label>
                      <button 
                        type="button"
                        onClick={handleAddStructuredTag}
                        className="text-[10px] font-black text-accent-blue uppercase hover:underline flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        添加标签
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      {structuredTags.map((st) => (
                        <div key={st.id} className="flex gap-2 animate-in fade-in slide-in-from-left-mini duration-300">
                          <select
                            value={st.category}
                            onChange={(e) => updateStructuredTag(st.id, 'category', e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-600 outline-none focus:border-accent-blue/50"
                          >
                            {(CATEGORIES_CONFIG[activeTab as keyof typeof CATEGORIES_CONFIG] || []).map(cat => (
                              <option key={cat.id} value={cat.id}>{cat.label}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={st.value}
                            onChange={(e) => updateStructuredTag(st.id, 'value', e.target.value)}
                            placeholder="输入标签值..."
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs text-slate-800 outline-none focus:border-accent-blue/50"
                          />
                          <button
                            type="button"
                            onClick={() => removeStructuredTag(st.id)}
                            className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      {structuredTags.length === 0 && (
                        <div className="text-center py-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                          <p className="text-[10px] text-slate-400">暂无检索标签，点击上方按钮添加</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-2 mb-2">关键词 (以逗号分隔)</label>
                  <input
                    type="text"
                    value={newTags}
                    onChange={(e) => setNewTags(e.target.value)}
                    placeholder="例如：反转, 治愈, 深海花园..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 outline-none focus:border-accent-blue/50 transition-all text-slate-800"
                  />
                </div>

                <div className="flex gap-4 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 px-8 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-bold transition-all"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 px-8 py-4 bg-primary-blue text-white rounded-2xl font-bold shadow-lg shadow-slate-200 hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-50"
                  >
                    {loading ? '正在保存...' : '确认发布'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row gap-6 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索收藏的内容..."
            className="w-full bg-white border border-slate-200 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-accent-blue transition-all text-slate-700 shadow-sm"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-sea-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredAssets.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAssets.map(asset => (
            <AssetCard 
              key={asset.id} 
              asset={asset} 
              onDelete={(id) => void handleDelete(id)}
              onEdit={handleEdit}
              onShare={(a) => void handleShareToMarket(a)}
              icon={iconMap[asset.type]}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-40 glass-card border-dashed">
          <FolderHeart className="w-16 h-16 text-slate-600 mx-auto mb-4 opacity-20" />
          <p className="text-slate-500">暂无收藏内容</p>
        </div>
      )}
    </div>
  );
}

function AssetCard({ asset, onDelete, onEdit, onShare, icon }: {
  asset: Asset;
  onDelete: (id: string) => void;
  onEdit: (asset: Asset) => void;
  onShare: (asset: Asset) => void | Promise<void>;
  icon: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(asset.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card flex flex-col h-full group"
    >
      <div className="p-6 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-accent-blue/5 rounded-lg text-accent-blue">
            {icon}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="p-2 text-slate-400 hover:text-primary-blue transition-colors"
              title="复制"
            >
              {copied ? <CheckCircle2 className="w-5 h-5 text-accent-blue" /> : <Copy className="w-5 h-5" />}
            </button>
            {['prompt', 'full_script', 'storyboard'].includes(asset.type) && (
              <button
                onClick={() => void onShare(asset)}
                className="p-2 text-slate-400 hover:text-accent-blue transition-colors flex items-center gap-1 group/btn"
                title="一键上架到灵感市场"
              >
                <Share2 className="w-5 h-5" />
                <span className="text-[10px] font-black uppercase opacity-0 group-hover/btn:opacity-100 transition-opacity">一键上架</span>
              </button>
            )}
            <button
              onClick={() => onEdit(asset)}
              className="p-2 text-slate-400 hover:text-accent-blue transition-colors"
              title="编辑"
            >
              <Edit3 className="w-5 h-5" />
            </button>
            <button
              onClick={() => onDelete(asset.id)}
              className="p-2 text-slate-400 hover:text-red-500 transition-colors"
              title="删除"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <h3 className="text-lg font-bold text-primary-blue mb-2 line-clamp-1">{asset.title}</h3>
        <div className="text-slate-600 text-sm leading-relaxed overflow-hidden flex-1">
          <div className="markdown-body text-xs line-clamp-6 pointer-events-none opacity-80 mb-4 prose prose-slate">
            <Markdown>{asset.content}</Markdown>
          </div>
        </div>

        <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex flex-wrap gap-1">
            {asset.tags?.map((tag, i) => {
              const uniqueKey = `tag-${asset.id}-${tag}-${i}`;
              if (tag.includes(':')) {
                const [cat, val] = tag.split(':');
                if (cat === 'shot_tag') return null; // Task 6: Hide shot_tag
                const label = CATEGORY_LABELS[cat] || cat;
                return (
                  <span key={uniqueKey} className="px-2 py-0.5 bg-blue-50 rounded text-[10px] text-accent-blue border border-blue-100 font-bold">
                    {label}: {val}
                  </span>
                );
              }
              return (
                <span key={uniqueKey} className="px-2 py-0.5 bg-slate-50 rounded text-[10px] text-slate-500 border border-slate-100">
                  #{tag}
                </span>
              );
            }).slice(0, 6).filter(Boolean)}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <Heart className="w-3 h-3" />
              <span>{asset.likes || 0}</span>
            </div>
            <span className="text-[10px] text-slate-400">
              {asset.createdAt ? new Date(asset.createdAt.seconds * 1000).toLocaleDateString() : '刚刚'}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
