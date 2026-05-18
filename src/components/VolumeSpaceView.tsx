import { Rocket } from 'lucide-react';
import ComingSoonModuleView from './ComingSoonModuleView';

export default function VolumeSpaceView() {
  return (
    <ComingSoonModuleView
      title="起量空间"
      description="投放策略、素材起量与数据复盘将在此集中展示，便于投放专员日常跟进。"
      icon={<Rocket />}
    />
  );
}
