import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Droplets,
  Flame,
  Gauge,
  Siren,
} from 'lucide-react';
import { clampPercent, formatDateTime, statusLabel } from '../lib/format';
import { Panel, PanelHeader, StatusPill } from '../components/UI';

const ACTIVE_STATES = new Set(['DETECTED', 'AIMING', 'SUPPRESSING']);

function SensorBar({ label, value, corner }) {
  const percent = clampPercent(value);
  return (
    <div className="sensor-bar">
      <div><span>{label}</span><small>{corner}</small><strong>{Math.round(percent)}%</strong></div>
      <div className="sensor-track"><span style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function FireGrid({ x, y }) {
  const cells = useMemo(() => Array.from({ length: 25 }, (_, index) => ({ x: index % 5, y: Math.floor(index / 5) })), []);
  return (
    <div className="fire-zone-wrap">
      <span className="corner-label nw">NW</span><span className="corner-label ne">NE</span>
      <span className="corner-label sw">SW</span><span className="corner-label se">SE</span>
      <div className="fire-grid">
        {cells.map((cell) => {
          const active = Number(x) === cell.x && Number(y) === cell.y;
          return <div className={active ? 'fire-cell target' : 'fire-cell'} key={`${cell.x}-${cell.y}`}>{active && <><Crosshair size={22} /><span>{cell.x},{cell.y}</span></>}</div>;
        })}
      </div>
    </div>
  );
}

export default function FireSafety({ fire, isFireActive, resolveIncident }) {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const snapshot = fire?.Snapshot?.[0];
  const actions = fire?.Action || [];

  async function handleResolve(resolution) {
    const prompt = resolution === 'FALSE_ALARM'
      ? 'Xác nhận đây là báo động giả? Hệ thống sẽ gửi lệnh tắt bơm, còi và thoát chế độ khẩn cấp.'
      : 'Xác nhận sự cố đã được kiểm tra an toàn và kết thúc chế độ khẩn cấp?';
    if (!window.confirm(prompt)) return;
    setSubmitting(true);
    setMessage('');
    try {
      await resolveIncident(resolution, notes.trim());
      setMessage('Đã gửi lệnh kết thúc chế độ khẩn cấp.');
      setNotes('');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dashboard-stack">
      <section className={`fire-hero ${isFireActive ? 'danger' : 'safe'}`}>
        <div className="fire-hero-icon">{isFireActive ? <Siren size={38} /> : <CheckCircle2 size={38} />}</div>
        <div>
          <span>{isFireActive ? 'CẢNH BÁO AN TOÀN' : 'TRẠNG THÁI HỆ THỐNG'}</span>
          <h2>{isFireActive ? statusLabel(fire?.status) : 'Không có sự cố đang hoạt động'}</h2>
          <p>{fire ? `Sự cố gần nhất #${fire.id} · phát hiện ${formatDateTime(fire.detectedAt)}` : 'Đang chờ snapshot đầu tiên từ ESP32 Main.'}</p>
        </div>
        <StatusPill status={isFireActive ? fire?.status : 'ONLINE'}>{isFireActive ? statusLabel(fire?.status) : 'An toàn'}</StatusPill>
      </section>

      <div className="fire-layout">
        <Panel className="fire-map-panel">
          <PanelHeader eyebrow="ĐỊNH VỊ 5 × 5" title="Vị trí ngọn lửa ước tính" subtitle="Tính từ cường độ của bốn cảm biến tại bốn góc" />
          <FireGrid x={fire?.estimatedX} y={fire?.estimatedY} />
          <div className="aim-summary">
            <div><Crosshair size={18} /><span>Tọa độ</span><strong>{fire?.estimatedX != null ? `(${fire.estimatedX}, ${fire.estimatedY})` : '—'}</strong></div>
            <div><Gauge size={18} /><span>Độ tin cậy</span><strong>{fire?.confidence != null ? `${Math.round(fire.confidence * 100)}%` : '—'}</strong></div>
            <div><span className="axis-label">H</span><span>Servo ngang</span><strong>{fire?.horizontalAngle != null ? `${fire.horizontalAngle}°` : '—'}</strong></div>
            <div><span className="axis-label">V</span><span>Servo dọc</span><strong>{fire?.verticalAngle != null ? `${fire.verticalAngle}°` : '—'}</strong></div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader eyebrow="CẢM BIẾN" title="Cường độ thời gian thực" subtitle={snapshot ? `Snapshot ${formatDateTime(snapshot.occurredAt)}` : 'Chưa có dữ liệu'} />
          <div className="sensor-stack">
            <SensorBar label="Flame NW" corner="Trên trái" value={snapshot?.flameNW} />
            <SensorBar label="Flame NE" corner="Trên phải" value={snapshot?.flameNE} />
            <SensorBar label="Flame SW" corner="Dưới trái" value={snapshot?.flameSW} />
            <SensorBar label="Flame SE" corner="Dưới phải" value={snapshot?.flameSE} />
          </div>
          <div className={`gas-card ${Number(snapshot?.gasLevel ?? fire?.gasLevel) >= 0.7 ? 'warning' : ''}`}>
            <Gauge size={22} /><div><span>Cảm biến khí gas</span><strong>{snapshot?.gasLevel != null ? `${Math.round(snapshot.gasLevel * 100)}%` : fire?.gasLevel != null ? `${Math.round(fire.gasLevel * 100)}%` : '—'}</strong></div>
          </div>
        </Panel>
      </div>

      <div className="fire-bottom-layout">
        <Panel>
          <PanelHeader eyebrow="THIẾT BỊ CHẤP HÀNH" title="Tiến trình phản ứng" />
          <div className="action-timeline">
            {actions.length ? actions.map((action) => (
              <div className="action-row" key={action.id}>
                <span className={`action-dot action-${String(action.status).toLowerCase()}`} />
                <div><strong>{action.actionType}</strong><small>{formatDateTime(action.requestedAt)}</small></div>
                <StatusPill status={action.status} size="small" />
              </div>
            )) : <div className="empty-state compact"><Droplets size={24} /><p>Chưa phát sinh lệnh PCCC.</p></div>}
          </div>
        </Panel>

        <Panel className="incident-control-panel">
          <PanelHeader eyebrow="XÁC NHẬN TẠI CHỖ" title="Kết thúc sự cố" subtitle="Chỉ thao tác sau khi đã kiểm tra hiện trường an toàn" />
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ghi chú kết quả kiểm tra hiện trường…" disabled={!isFireActive || submitting} />
          {message && <div className="inline-message">{message}</div>}
          <div className="incident-actions">
            <button className="secondary-button" disabled={!isFireActive || submitting} onClick={() => handleResolve('FALSE_ALARM')}><AlertTriangle size={17} />Báo động giả</button>
            <button className="primary-button danger-button" disabled={!isFireActive || submitting} onClick={() => handleResolve('RESOLVED')}><CheckCircle2 size={17} />Đã xử lý an toàn</button>
          </div>
          <p className="safety-note"><Flame size={16} /> Giao diện không cho phép bật bơm trực tiếp. Bơm chỉ chạy sau khi servo xác nhận đã định hướng và thiết bị kiểm tra điều kiện an toàn cục bộ.</p>
        </Panel>
      </div>
    </div>
  );
}
