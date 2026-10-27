import {
  Activity,
  Bell,
  CarFront,
  ChevronLeft,
  Flame,
  LayoutDashboard,
  Menu,
  ParkingSquare,
  RadioTower,
  RefreshCw,
  Search,
  ServerCog,
  WalletCards,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatTime } from '../lib/format';

export const NAV_ITEMS = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'parking', label: 'Bãi đỗ xe', icon: ParkingSquare },
  { id: 'access', label: 'Kiểm soát cổng', icon: CarFront },
  { id: 'payments', label: 'Thanh toán', icon: WalletCards },
  { id: 'fire', label: 'An toàn PCCC', icon: Flame },
  { id: 'devices', label: 'Thiết bị IoT', icon: ServerCog },
  { id: 'activity', label: 'Nhật ký realtime', icon: Activity },
];

function Sidebar({ page, setPage, open, setOpen }) {
  return (
    <aside className={`sidebar ${open ? 'is-open' : ''}`}>
      <div className="brand">
        <span className="brand-mark"><ParkingSquare size={25} /></span>
        <div><strong>ParkFlow</strong><span>SMART PARKING</span></div>
        <button className="mobile-close" onClick={() => setOpen(false)} aria-label="Đóng menu"><X /></button>
      </div>

      <div className="nav-section-label">Điều hành</div>
      <nav>
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={page === id ? 'active' : ''}
            onClick={() => { setPage(id); setOpen(false); }}
          >
            <Icon size={19} strokeWidth={1.9} />
            <span>{label}</span>
            {page === id && <ChevronLeft className="nav-active-arrow" size={15} />}
          </button>
        ))}
      </nav>

      <div className="sidebar-system-card">
        <span className="system-orbit"><RadioTower size={22} /></span>
        <div>
          <strong>Hệ thống IoT</strong>
          <p>ESP32 · MQTT · Realtime</p>
        </div>
        <span className="live-dot" />
      </div>
      <p className="sidebar-version">ParkFlow Console · v1.0</p>
    </aside>
  );
}

export default function Layout({
  page,
  setPage,
  title,
  subtitle,
  apiState,
  socketState,
  mqttState,
  refreshing,
  lastSync,
  onRefresh,
  isFireActive,
  children,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const connected = apiState === 'connected' && socketState === 'connected';
  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={setPage} open={menuOpen} setOpen={setMenuOpen} />
      {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="Đóng menu" />}

      <main className="main-area">
        {isFireActive && (
          <button className="emergency-ribbon" onClick={() => setPage('fire')}>
            <Flame size={17} fill="currentColor" />
            Chế độ khẩn cấp đang hoạt động
            <span>Xem chi tiết</span>
          </button>
        )}
        <header className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Mở menu"><Menu /></button>
          <div className="page-title">
            <span>{subtitle}</span>
            <h1>{title}</h1>
          </div>
          <div className="topbar-actions">
            <div className="search-shell"><Search size={17} /><span>Tìm biển số, phiên gửi…</span><kbd>⌘ K</kbd></div>
            <div className="clock-block">
              <strong>{new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(now)}</strong>
              <span>{new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(now)}</span>
            </div>
            <button className="icon-button" aria-label="Thông báo"><Bell size={19} />{isFireActive && <span className="notification-dot" />}</button>
            <button className="icon-button" onClick={onRefresh} disabled={refreshing} aria-label="Làm mới">
              <RefreshCw className={refreshing ? 'spinning' : ''} size={19} />
            </button>
          </div>
        </header>

        <div className="connection-strip">
          <span className={apiState === 'connected' ? 'ok' : 'bad'}>API {apiState === 'connected' ? 'hoạt động' : 'mất kết nối'}</span>
          <span className={mqttState === 'connected' ? 'ok' : 'warn'}>MQTT {mqttState === 'connected' ? 'đã kết nối' : 'chưa kết nối'}</span>
          <span className={socketState === 'connected' ? 'ok' : 'bad'}>Realtime {socketState === 'connected' ? 'trực tuyến' : 'ngoại tuyến'}</span>
          <span className="sync-time">{connected ? 'Dữ liệu trực tiếp' : 'Đang dùng dữ liệu gần nhất'} · cập nhật {formatTime(lastSync)}</span>
        </div>

        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
