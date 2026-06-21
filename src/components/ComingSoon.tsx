interface Props { label: string; desc: string; }
export default function ComingSoon({ label, desc }: Props) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <p className="text-text-muted text-xs font-mono uppercase tracking-widest mb-2">Coming soon</p>
        <p className="text-text-primary text-lg font-bold font-display">{label}</p>
        <p className="text-text-muted text-sm mt-1">{desc}</p>
      </div>
    </div>
  );
}
