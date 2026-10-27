import { CarFront, CircleParking, Gauge, MapPinned } from 'lucide-react';
import ParkingMap from '../components/ParkingMap';
import { MetricCard, Panel, PanelHeader, StatusPill } from '../components/UI';

export default function Parking({ parking }) {
  const capacity = parking?.capacity ?? 4;
  const used = (parking?.occupied || 0) + (parking?.reserved || 0);
  const utilization = parking ? Math.round((used / Math.max(capacity, 1)) * 100) : 0;

  return (
    <div className="dashboard-stack">
      {parking?.isFull && (
        <div className="alert-banner danger">
          <CarFront size={20} />
          <div><strong>Bãi xe đã đầy</strong><span>Hệ thống sẽ từ chối xe vào mới nhưng vẫn cho phép xe ra.</span></div>
        </div>
      )}
      <div className="metrics-grid metrics-grid-compact">
        <MetricCard label="Tổng sức chứa" value={capacity} detail="Khu vực ZONE_A" icon={MapPinned} tone="blue" />
        <MetricCard label="Còn trống" value={parking?.available ?? '—'} detail="LED xanh đang bật" icon={CircleParking} tone="green" />
        <MetricCard label="Đã có xe" value={parking?.occupied ?? '—'} detail={`${parking?.reserved || 0} vị trí đang giữ`} icon={CarFront} tone="red" />
        <MetricCard label="Mức sử dụng" value={utilization} unit="%" detail="Theo cảm biến vật cản" icon={Gauge} tone="amber" progress={utilization} />
      </div>

      <Panel>
        <PanelHeader
          eyebrow="ZONE_A · 4 VỊ TRÍ"
          title="Bản đồ bãi đỗ"
          subtitle="Trạng thái được cập nhật từ Arduino qua ESP32 Main"
          action={<StatusPill status={parking?.isFull ? 'BLOCKED' : 'ONLINE'}>{parking?.isFull ? 'Đã đầy' : 'Đang nhận xe'}</StatusPill>}
        />
        <ParkingMap parking={parking} detailed />
        <div className="parking-legend">
          <span><i className="legend-free" />Còn trống</span>
          <span><i className="legend-occupied" />Đã có xe</span>
          <span><i className="legend-reserved" />Đã giữ chỗ</span>
          <span><i className="legend-maintenance" />Bảo trì</span>
        </div>
      </Panel>

      <Panel>
        <PanelHeader eyebrow="NGUYÊN TẮC VẬN HÀNH" title="Logic đèn và cảm biến" />
        <div className="rule-grid">
          <div><span className="rule-number">01</span><strong>Ô trống</strong><p>Cảm biến không thấy vật cản, LED xanh sáng và hệ thống cho phép phân chỗ.</p></div>
          <div><span className="rule-number">02</span><strong>Xe đã đỗ</strong><p>Cảm biến phát hiện xe, LED đỏ sáng và trạng thái chuyển sang OCCUPIED.</p></div>
          <div><span className="rule-number">03</span><strong>Bãi đầy</strong><p>Khi không còn ô FREE, cổng vào bị khóa; cổng ra luôn được phép hoạt động.</p></div>
        </div>
      </Panel>
    </div>
  );
}
