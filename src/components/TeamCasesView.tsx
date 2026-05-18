import { Users } from 'lucide-react';
import ComingSoonModuleView from './ComingSoonModuleView';

export default function TeamCasesView() {
  return (
    <ComingSoonModuleView
      title="团队案例"
      description="优秀投放案例与复盘将在此沉淀，便于团队学习与复用。"
      icon={<Users />}
    />
  );
}
