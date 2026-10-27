import {
  Activity,
  CarFront,
  CircleParking,
  CreditCard,
  Flame,
  Gauge,
  ShieldCheck,
} from 'lucide-react';
import ParkingMap from '../components/ParkingMap';
import { ActivityList, GateCard, MetricCard, Panel, PanelHeader, StatusPill } from '../components/UI';
import { formatDateTime, statusLabel } from '../lib/format';

export default function Overview({ system, setPage }) {
  const { parking, access, fire, events, isFireActive } = system;
  const capacity = parking?.capacity ?? 4;
  const available = parking?.available ?? '—';
  const utilization = parking ? Math.round(((parking.occupied + parking.reserved) / Math.max(1, parking.capacity)) * 100) : 0;
  const gates = access?.gates || [];
  const latestSnapshot = fire?.Snapshot?.[0];

  return (
    <div className="dashboard-stack">
      <section className={`welcome-banner ${isFireActive ? 'welcome-danger' : ''}`}>
        <div>
          <span className="eyebrow">TRUNG TÂM ĐIỀU HÀNH</span>
          <h2>{isFireActive ? 'Đang có cảnh báo an toàn cần xử lý' : 'Bãi xe đang được giám sát liên tục'}</h2>
          <p>{isFireActive ? `Sự cố #${fire.id} · ${statusLabel(fire.status)}` : 'Dữ liệu cảm biến, cổng và thiết bị được đồng bộ theo thời gian thực.'}</p>
        </div>
        <div className="welcome-status">
          {isFireActive ? <Flame size={31} /> : <ShieldCheck size={31} />}
          <div><strong>{isFireActive ? 'KHẨN CẤP' : 'AN TOÀN'}</strong><span>{isFireActive ? 'Mở màn hình PCCC' : 'Không có cảnh báo'}</span></div>
        </div>
      </section>

      <div className="metrics-grid">
        <MetricCard
          label="Vị trí còn trống"
          value={available}
          unit={`/ ${capacity}`}
          detail={parking?.isFull ? 'Bãi hiện đã đầy' : 'Sẵn sàng tiếp nhận xe'}
          icon={CircleParking}
          tone={parking?.isFull ? 'red' : 'green'}
          progress={parking ? (parking.available / Math.max(1, parking.capacity)) * 100 : 0}
        />
        <MetricCard
          label="Xe trong bãi"
          value={access?.activeSessions ?? '—'}
          detail={`${utilization}% công suất đang sử dụng`}
          icon={CarFront}
          tone="blue"
          progress={utilization}
        />
        <MetricCard
          label="Thẻ đang cấp"
          value={access?.cards?.issued ?? '—'}
          detail={`${access?.cards?.available ?? '—'} thẻ sẵn sàng`}
          icon={CreditCard}
          tone="amber"
        />
        <MetricCard
          label="An toàn PCCC"
          value={isFireActive ? 'Cảnh báo' : 'Ổn định'}
          detail={latestSnapshot ? `Cập nhật ${formatDateTime(latestSnapshot.occurredAt)}` : 'Đang chờ dữ liệu cảm biến'}
          icon={isFireActive ? Flame : ShieldCheck}
          tone={isFireActive ? 'red' : 'green'}
        />
      </div>

      <div className="overview-grid-main">
        <Panel className="parking-overview-panel">
          <PanelHeader
            eyebrow="SƠ ĐỒ TRỰC TIẾP"
            title="Bãi đỗ khu A"
            subtitle={`${parking?.available ?? '—'} vị trí trống trên tổng số ${capacity}`}
            action={<button className="text-button" onClick={() => setPage('parking')}>Xem chi tiết</button>}
          />
          <ParkingMap parking={parking} />
          <div className="parking-legend">
            <span><i className="legend-free" />Còn trống</span>
            <span><i className="legend-occupied" />Đã có xe</span>
            <span><i className="legend-reserved" />Đã giữ chỗ</span>
            <span><i className="legend-maintenance" />Bảo trì</span>
          </div>
        </Panel>

        <Panel className="activity-panel">
          <PanelHeader
            eyebrow="DÒNG SỰ KIỆN"
            title="Hoạt động gần đây"
            action={<button className="text-button" onClick={() => setPage('activity')}>Tất cả</button>}
          />
          <ActivityList events={events} limit={6} />
        </Panel>
      </div>

      <div className="overview-grid-bottom">
        <Panel>
          <PanelHeader eyebrow="RA / VÀO" title="Trạng thái hai cổng" subtitle="Điều khiển tự động qua ESP32 Main" />
          <div className="gate-grid">
            {gates.length ? gates.map((gate) => <GateCard key={gate.id} gate={gate} />) : (
              <><GateCard gate={{ direction: 'ENTRY' }} /><GateCard gate={{ direction: 'EXIT' }} /></>
            )}
          </div>
        </Panel>

        <Panel className={isFireActive ? 'fire-summary active' : 'fire-summary'}>
          <PanelHeader
            eyebrow="PCCC"
            title="Giám sát cháy & khí gas"
            action={<StatusPill status={isFireActive ? fire?.status : 'ONLINE'}>{isFireActive ? statusLabel(fire?.status) : 'Đang giám sát'}</StatusPill>}
          />
          <div className="fire-quick-grid">
            <div><Flame size={18} /><span>Cường độ lửa</span><strong>{fire?.maxFlameIntensity != null ? `${Math.round(fire.maxFlameIntensity * 100)}%` : '—'}</strong></div>
            <div><Gauge size={18} /><span>Mức khí gas</span><strong>{fire?.gasLevel != null ? `${Math.round(fire.gasLevel * 100)}%` : '—'}</strong></div>
            <div><Activity size={18} /><span>Vị trí ước tính</span><strong>{fire?.estimatedX != null ? `(${fire.estimatedX}, ${fire.estimatedY})` : '—'}</strong></div>
          </div>
          <button className="secondary-button full" onClick={() => setPage('fire')}>Mở trung tâm an toàn</button>
        </Panel>
      </div>
    </div>
  );
}
