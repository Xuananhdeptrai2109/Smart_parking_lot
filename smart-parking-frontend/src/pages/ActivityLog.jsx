import { useMemo, useState } from 'react';
import { Activity, Filter, Radio } from 'lucide-react';
import { ActivityList, Panel, PanelHeader } from '../components/UI';

const FILTERS = [
  ['all', 'Tất cả'],
  ['access', 'Ra / vào'],
  ['parking', 'Bãi đỗ'],
  ['fire', 'PCCC'],
  ['device', 'Thiết bị'],
];

export default function ActivityLog({ events, socketState }) {
  const [filter, setFilter] = useState('all');
  const filtered = useMemo(() => filter === 'all' ? events : events.filter((event) => event.domain === filter), [events, filter]);
  return (
    <div className="dashboard-stack">
      <section className="activity-hero">
        <span className={socketState === 'connected' ? 'pulse-ring live' : 'pulse-ring'}><Radio size={24} /></span>
        <div><span>SOCKET.IO EVENT STREAM</span><h2>Nhật ký hoạt động realtime</h2><p>Các sự kiện mới nhất được nhận trực tiếp từ backend trong phiên dashboard hiện tại.</p></div>
        <strong>{events.length}<small>sự kiện</small></strong>
      </section>
      <Panel>
        <PanelHeader
          eyebrow="EVENT LOG"
          title="Dòng sự kiện hệ thống"
          action={<div className="filter-icon"><Filter size={17} /> Bộ lọc</div>}
        />
        <div className="filter-tabs">
          {FILTERS.map(([id, label]) => <button className={filter === id ? 'active' : ''} key={id} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
        <ActivityList events={filtered} emptyText={filter === 'all' ? 'Chưa có sự kiện realtime. Hãy kích hoạt cảm biến hoặc thiết bị.' : 'Chưa có sự kiện thuộc nhóm này.'} />
      </Panel>
      <div className="event-notice"><Activity size={18} /><span>Nhật ký trên giao diện được giữ trong bộ nhớ phiên và tối đa 60 sự kiện. Dữ liệu nghiệp vụ quan trọng vẫn được backend lưu trong database.</span></div>
    </div>
  );
}
