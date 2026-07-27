import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { KeyRound, Loader2, Plus, Trash2, UserRound, UsersRound, X } from 'lucide-react';
import { authApi, type EmployeeAccount } from '../lib/auth';

interface Props { open: boolean; onClose: () => void; onLogout?: () => void }
const field = 'w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent focus:bg-white';

export default function AccountSettingsModal({ open, onClose, onLogout }: Props) {
  const [tab, setTab] = useState<'password' | 'employees'>('password');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<EmployeeAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [initialPassword, setInitialPassword] = useState('');

  useEffect(() => {
    if (!open || tab !== 'employees') return;
    setLoading(true); setError('');
    authApi.employees().then(setEmployees).catch(e => setError(e instanceof Error ? e.message : '员工列表加载失败')).finally(() => setLoading(false));
  }, [open, tab]);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (next.length < 8) { setError('新密码至少需要 8 位'); return; }
    if (next !== confirm) { setError('两次输入的新密码不一致'); return; }
    if (current === next) { setError('新密码不能与当前密码相同'); return; }
    setSaving(true);
    try { await authApi.changePassword(current, next, confirm); setChanged(true); }
    catch (e) { setError(e instanceof Error ? e.message : '修改密码失败'); }
    finally { setSaving(false); }
  };

  const submitEmployee = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const employee = await authApi.addEmployee({ name, email, password: initialPassword });
      setEmployees(items => [...items, employee]); setAdding(false); setName(''); setEmail(''); setInitialPassword('');
    } catch (e) { setError(e instanceof Error ? e.message : '添加员工失败'); }
    finally { setSaving(false); }
  };

  const remove = async (employee: EmployeeAccount) => {
    if (!window.confirm(`确认移除员工 ${employee.name || employee.email}？`)) return;
    try { await authApi.deleteEmployee(employee.id); setEmployees(items => items.filter(item => item.id !== employee.id)); }
    catch (e) { setError(e instanceof Error ? e.message : '删除员工失败'); }
  };

  return <AnimatePresence>{open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
    <motion.div initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} className="flex h-[580px] w-full max-w-[760px] overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
      <aside className="w-52 border-r border-border bg-surface-2 p-4">
        <p className="px-2 pb-4 text-base font-bold text-text-primary">账号设置</p>
        <button onClick={() => { setTab('password'); setError(''); }} className={`mb-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold ${tab === 'password' ? 'bg-white shadow-sm' : 'text-text-muted hover:bg-white/70'}`}><KeyRound size={16} />修改密码</button>
        <button onClick={() => { setTab('employees'); setError(''); }} className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold ${tab === 'employees' ? 'bg-white shadow-sm' : 'text-text-muted hover:bg-white/70'}`}><UsersRound size={16} />员工管理</button>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col p-6">
        <div className="flex justify-between"><div><h2 className="text-lg font-bold text-text-primary">{tab === 'password' ? '修改密码' : '员工管理'}</h2><p className="mt-1 text-xs text-text-muted">{tab === 'password' ? '修改后需要使用新密码重新登录。' : '管理同一企业下的员工登录账号。'}</p></div><button onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2"><X size={17} /></button></div>
        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{error}</p>}
        {tab === 'password' ? changed ? <div className="mt-8"><div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-700">密码修改成功，请使用新密码重新登录。</div><button onClick={onLogout} className="mt-4 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-white">重新登录</button></div> : <form onSubmit={submitPassword} className="mt-6 max-w-md space-y-4">
          {[['当前密码', current, setCurrent], ['新密码', next, setNext], ['确认新密码', confirm, setConfirm]].map(([label, value, setter]) => <label key={String(label)} className="block"><span className="mb-1.5 block text-xs font-semibold text-text-secondary">{String(label)}</span><input required type="password" value={String(value)} onChange={e => (setter as typeof setCurrent)(e.target.value)} className={field} autoComplete={label === '当前密码' ? 'current-password' : 'new-password'} /></label>)}
          <button disabled={saving} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving && <Loader2 size={14} className="animate-spin" />}确认修改</button>
        </form> : <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
          <div className="mb-4 flex justify-end"><button onClick={() => setAdding(value => !value)} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-bold text-white"><Plus size={14} />添加员工</button></div>
          {adding && <form onSubmit={submitEmployee} className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface-2 p-4"><input value={name} onChange={e => setName(e.target.value)} placeholder="员工姓名" className={field} /><input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="登录邮箱" className={field} /><input required minLength={8} type="password" value={initialPassword} onChange={e => setInitialPassword(e.target.value)} placeholder="初始密码（至少 8 位）" className={`${field} col-span-2`} /><div className="col-span-2 flex justify-end gap-2"><button type="button" onClick={() => setAdding(false)} className="px-3 py-2 text-xs font-semibold text-text-muted">取消</button><button disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white">保存员工</button></div></form>}
          {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent" /></div> : <div className="space-y-2">{employees.map(employee => <div key={employee.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-glow text-accent"><UserRound size={17} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-text-primary">{employee.name || employee.email.split('@')[0]} {employee.isCurrent && <span className="ml-1 text-[10px] text-accent">当前账号</span>}</p><p className="truncate text-xs text-text-muted">{employee.email}</p></div>{!employee.isCurrent && <button onClick={() => void remove(employee)} className="rounded-lg p-2 text-text-muted hover:bg-red-50 hover:text-red-600" title="移除员工"><Trash2 size={15} /></button>}</div>)}{employees.length === 0 && <p className="py-12 text-center text-sm text-text-muted">暂无员工账号</p>}</div>}
        </div>}
      </section>
    </motion.div>
  </motion.div>}</AnimatePresence>;
}
