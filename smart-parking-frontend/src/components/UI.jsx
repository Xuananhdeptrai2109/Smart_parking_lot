import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CarFront,
  CheckCircle2,
  CircleDot,
  Cpu,
  Flame,
  Radio,
  WalletCards,
} from 'lucide-react';
import { formatTime, statusLabel } from '../lib/format';

export function StatusPill({ status, children, size = 'normal' }) {
  const normalized = String(status || 'unknown').toLowerCase();
  return (
    <span className={`status-pill status-${normalized} status-${size}`}>
      <span className="status-dot" />
      {children || statusLabel(status)}
    </span>
  );
}

export function Panel({ className = '', children, ...props }) {
  return <section className={`panel ${className}`} {...props}>{children}</section>;
}

export function PanelHeader({ eyebrow, title, subtitle, action }) {
  return (
    <div className="panel-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div className="panel-action">{action}</div>}
    </div>
  );
}

export function MetricCard({ label, value, unit, detail, icon: Icon, tone = 'green', progress }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        <span className="metric-icon"><Icon size={19} strokeWidth={1.9} /></span>
      </div>
      <div className="metric-value-row">
        <strong>{value}</strong>
        {unit && <span>{unit}</span>}
      </div>
      {progress != null && (
        <div className="metric-progress"><span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>
      )}
      <p>{detail}</p>
    </article>
  );
}

const eventIcons = {
  access: CarFront,
  parking: CircleDot,
  fire: Flame,
  device: Cpu,
  payment: WalletCards,
  system: Radio,
};

export function ActivityList({ events, limit, emptyText = 'Chưa có sự kiện realtime trong phiên này.' }) {
  const visibleEvents = typeof limit === 'number' ? events.slice(0, limit) : events;
  if (!visibleEvents.length) {
    return (
      <div className="empty-state compact">
        <Radio size={25} />
        <p>{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="activity-list">
      {visibleEvents.map((event) => {
        const Icon = eventIcons[event.domain] || Radio;
        return (
          <div className="activity-item" key={event.id}>
            <span className={`activity-icon tone-${event.tone}`}><Icon size={17} /></span>
            <div className="activity-copy">
              <strong>{event.title}</strong>
              <span>{event.detail || 'Hệ thống đã cập nhật dữ liệu'}</span>
            </div>
            <time>{formatTime(event.timestamp)}</time>
          </div>
        );
      })}
    </div>
  );
}

export function GateCard({ gate }) {
  const entry = gate?.direction === 'ENTRY';
  const Icon = entry ? ArrowDownToLine : ArrowUpFromLine;
  const healthy = !['ERROR', 'BLOCKED'].includes(gate?.state);
  return (
    <article className="gate-card">
      <div className="gate-icon"><Icon size={21} /></div>
      <div className="gate-copy">
        <span>{entry ? 'Làn xe vào' : 'Làn xe ra'}</span>
        <strong>{gate?.gateCode || (entry ? 'ENTRY_GATE' : 'EXIT_GATE')}</strong>
      </div>
      <StatusPill status={gate?.state || 'UNKNOWN'} size="small" />
      <div className="gate-foot">
        {healthy ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        Servo {gate?.servoDeviceCode || 'chưa cấu hình'}
      </div>
    </article>
  );
}

export function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-mark"><span /><span /><span /></div>
      <strong>Đang kết nối trung tâm điều hành</strong>
      <p>Đọc trạng thái bãi xe, cổng và hệ thống PCCC…</p>
    </div>
  );
}
