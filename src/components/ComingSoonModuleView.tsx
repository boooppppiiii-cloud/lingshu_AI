import { LayoutGrid } from 'lucide-react';

interface ComingSoonModuleViewProps {
  title: string;
  description: string;
  icon: React.ReactNode;
}

/** 与现有模块一致的占位页（起量空间、团队案例等） */
export default function ComingSoonModuleView({ title, description, icon }: ComingSoonModuleViewProps) {
  return (
    <div className="w-full">
      <header className="mb-8">
        <h1 className="text-4xl font-black text-primary-blue mb-2 flex items-center gap-3">
          <span className="inline-flex text-accent-blue [&>svg]:h-10 [&>svg]:w-10">{icon}</span>
          {title}
        </h1>
        <p className="text-slate-500 max-w-2xl text-sm leading-relaxed">{description}</p>
      </header>

      <div className="glass-card border-dashed py-24 text-center text-slate-500">
        <LayoutGrid className="mx-auto mb-3 h-12 w-12 opacity-30" />
        <p className="font-bold">功能建设中</p>
        <p className="mt-1 text-sm">该模块即将上线，敬请期待。</p>
      </div>
    </div>
  );
}
