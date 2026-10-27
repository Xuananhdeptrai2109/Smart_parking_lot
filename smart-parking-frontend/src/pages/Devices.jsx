import {
  Camera,
  CircuitBoard,
  CloudCog,
  Cpu,
  Database,
  Radio,
  Router,
  Server,
  Wifi,
} from 'lucide-react';
import { Panel, PanelHeader, StatusPill } from '../components/UI';
import { formatDateTime } from '../lib/format';

const NODE_GROUPS = [
  {
    title: 'ESP32 Main Controller',
    subtitle: 'Cổng ra/vào · PCCC · UART Arduino',
    icon: Cpu,
    codes: ['GATE_ENTRY_SERVO', 'GATE_EXIT_SERVO', 'RFID_ENTRY', 'FIRE_SERVO_CONTROLLER'],
  },
  {
    title: 'ESP32-CAM',
    subtitle: 'Camera biển số hai vùng ảnh',
    icon: Camera,
    codes: ['CAMERA_MAIN'],
  },
  {
    title: 'Arduino Parking Node',
    subtitle: '4 cảm biến · 8 LED · UART',
    icon: CircuitBoard,
    codes: ['SPOT_A1_SENSOR', 'SPOT_A2_SENSOR', 'SPOT_A3_SENSOR', 'SPOT_A4_SENSOR'],
  },
];

export default function Devices({ health, devices, apiState, socketState }) {
  const knownDevices = Object.values(devices);
  return (
    <div className="dashboard-stack">
      <div className="infrastructure-grid">
        <article><span><Server /></span><div><small>REST Backend</small><strong>{apiState === 'connected' ? 'Hoạt động' : 'Mất kết nối'}</strong></div><StatusPill status={apiState === 'connected' ? 'ONLINE' : 'OFFLINE'} size="small" /></article>
        <article><span><Radio /></span><div><small>Socket.IO</small><strong>{socketState === 'connected' ? 'Realtime' : 'Ngoại tuyến'}</strong></div><StatusPill status={socketState === 'connected' ? 'ONLINE' : 'OFFLINE'} size="small" /></article>
        <article><span><Router /></span><div><small>MQTT Broker</small><strong>{health?.mqtt === 'connected' ? 'Đã kết nối' : 'Chưa kết nối'}</strong></div><StatusPill status={health?.mqtt === 'connected' ? 'ONLINE' : 'OFFLINE'} size="small" /></article>
        <article><span><Database /></span><div><small>Database</small><strong>{apiState === 'connected' ? 'Phản hồi API' : 'Chưa xác nhận'}</strong></div><StatusPill status={apiState === 'connected' ? 'ONLINE' : 'UNKNOWN'} size="small" /></article>
      </div>

      <Panel>
        <PanelHeader eyebrow="EDGE NODES" title="Các nút điều khiển tại bãi" subtitle="Heartbeat chỉ xuất hiện sau khi firmware chính kết nối MQTT" />
        <div className="node-grid">
          {NODE_GROUPS.map(({ title, subtitle, icon: Icon, codes }) => {
            const heartbeats = codes.map((code) => devices[code]).filter(Boolean);
            const latest = heartbeats.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))[0];
            return (
              <article className="node-card" key={title}>
                <div className="node-card-head"><span><Icon size={23} /></span><StatusPill status={latest?.status || 'UNKNOWN'} size="small">{latest ? 'Đã ghi nhận' : 'Chờ heartbeat'}</StatusPill></div>
                <h3>{title}</h3>
                <p>{subtitle}</p>
                <div className="node-meta"><Wifi size={15} /><span>{latest?.ipAddress || 'Chưa có địa chỉ IP'}</span></div>
                <div className="node-meta"><CloudCog size={15} /><span>{latest ? formatDateTime(latest.lastSeenAt) : 'Chưa nhận dữ liệu trong phiên'}</span></div>
                <div className="device-code-list">{codes.map((code) => <code className={devices[code] ? 'seen' : ''} key={code}>{code}</code>)}</div>
              </article>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <PanelHeader eyebrow="HEARTBEAT SESSION" title="Thiết bị đã gửi trạng thái" subtitle="Danh sách realtime kể từ khi bạn mở dashboard" />
        {knownDevices.length ? (
          <div className="device-table-wrap">
            <table className="device-table">
              <thead><tr><th>Mã thiết bị</th><th>Loại</th><th>Vị trí</th><th>IP</th><th>Cập nhật cuối</th><th>Trạng thái</th></tr></thead>
              <tbody>{knownDevices.map((device) => (
                <tr key={device.deviceCode}>
                  <td><code>{device.deviceCode}</code></td><td>{device.type}</td><td>{device.location}</td><td>{device.ipAddress || '—'}</td><td>{formatDateTime(device.lastSeenAt)}</td><td><StatusPill status={device.status} size="small" /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state"><Radio size={30} /><strong>Chưa nhận heartbeat</strong><p>Giữ dashboard mở và khởi động ESP32 Main để nhận sự kiện thiết bị.</p></div>
        )}
      </Panel>
    </div>
  );
}
