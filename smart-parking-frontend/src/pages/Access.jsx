import { useState } from 'react';
import {
  Camera,
  CarFront,
  CreditCard,
  Search,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, formatDuration, normalizePlate } from '../lib/format';
import { GateCard, MetricCard, Panel, PanelHeader, StatusPill } from '../components/UI';

function SessionResult({ session }) {
  if (!session) return null;
  return (
    <div className="session-result">
      <div className="session-result-head">
        <div className="plate-number">{session.Vehicle?.licensePlate || 'KHÔNG RÕ'}</div>
        <StatusPill status={session.status} />
      </div>
      <div className="session-details-grid">
        <div><span>Mã phiên</span><strong>#{session.id}</strong></div>
        <div><span>Vị trí được cấp</span><strong>{session.AssignedSpot?.spotName || 'Chưa cấp'}</strong></div>
        <div><span>Thẻ RFID</span><strong>{session.CardAssignment?.AccessCard?.uid || '—'}</strong></div>
        <div><span>Thời gian vào</span><strong>{formatDateTime(session.entryTime)}</strong></div>
        <div><span>Đã gửi</span><strong>{formatDuration(session.entryTime)}</strong></div>
        <div><span>Loại xe</span><strong>{session.Vehicle?.vehicleType === 'MOTORBIKE' ? 'Xe máy' : 'Ô tô'}</strong></div>
      </div>
      {session.entryImage && (
        <a className="image-link" href={session.entryImage} target="_blank" rel="noreferrer"><Camera size={16} />Mở ảnh xe vào</a>
      )}
    </div>
  );
}

export default function Access({ access }) {
  const [plate, setPlate] = useState('');
  const [session, setSession] = useState(null);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const gates = access?.gates || [];

  async function handleSearch(event) {
    event.preventDefault();
    const normalized = normalizePlate(plate);
    if (!normalized) {
      setMessage('Hãy nhập biển số cần tra cứu.');
      return;
    }
    setSearching(true);
    setMessage('');
    setSession(null);
    try {
      setSession(await api.activeSession(normalized));
    } catch (error) {
      setMessage(error.status === 404 ? `Không có phiên đang hoạt động cho xe ${normalized}.` : error.message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="dashboard-stack">
      <div className="metrics-grid metrics-grid-compact">
        <MetricCard label="Phiên đang hoạt động" value={access?.activeSessions ?? '—'} detail="Xe hiện có trong bãi" icon={CarFront} tone="blue" />
        <MetricCard label="Thẻ sẵn sàng" value={access?.cards?.available ?? '—'} detail="Có thể cấp cho khách mới" icon={CreditCard} tone="green" />
        <MetricCard label="Thẻ đã cấp" value={access?.cards?.issued ?? '—'} detail="Đang gắn với phiên gửi" icon={CreditCard} tone="amber" />
        <MetricCard label="Thời gian xác thực" value="30" unit="giây" detail="Camera + RFID + backend" icon={Timer} tone="purple" />
      </div>

      <Panel>
        <PanelHeader eyebrow="BARRIER CONTROL" title="Trạng thái cổng ra vào" subtitle="Giao diện chỉ giám sát; lệnh mở cổng do backend xác thực và phát qua MQTT" />
        <div className="gate-grid gate-grid-large">
          {gates.length ? gates.map((gate) => <GateCard gate={gate} key={gate.id} />) : (
            <><GateCard gate={{ direction: 'ENTRY' }} /><GateCard gate={{ direction: 'EXIT' }} /></>
          )}
        </div>
      </Panel>

      <div className="access-content-grid">
        <Panel>
          <PanelHeader eyebrow="TRA CỨU" title="Tìm phiên gửi đang hoạt động" subtitle="Tìm theo biển số do ESP32-CAM nhận diện" />
          <form className="plate-search-form" onSubmit={handleSearch}>
            <div className="plate-input"><Search size={20} /><input value={plate} onChange={(event) => setPlate(event.target.value)} placeholder="Ví dụ: 30A-123.45" /></div>
            <button className="primary-button" disabled={searching}>{searching ? 'Đang tìm…' : 'Tra cứu'}</button>
          </form>
          {message && <div className="inline-message">{message}</div>}
          <SessionResult session={session} />
        </Panel>

        <Panel>
          <PanelHeader eyebrow="QUY TRÌNH" title="Xác thực tại cổng" />
          <div className="access-flow">
            <div><span>1</span><Camera /><strong>Chụp biển số</strong><p>Nửa phải cho xe vào, nửa trái cho xe ra.</p></div>
            <i />
            <div><span>2</span><CreditCard /><strong>Quét thẻ RFID</strong><p>Cấp thẻ khi vào và thu lại khi xe ra.</p></div>
            <i />
            <div><span>3</span><ShieldCheck /><strong>Backend xác thực</strong><p>Đối chiếu biển số, thẻ và sức chứa.</p></div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
