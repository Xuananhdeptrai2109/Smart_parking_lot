import { useEffect, useMemo, useState } from 'react';
import Layout, { NAV_ITEMS } from './components/Layout';
import { LoadingScreen } from './components/UI';
import { useParkingSystem } from './hooks/useParkingSystem';
import Access from './pages/Access';
import ActivityLog from './pages/ActivityLog';
import Devices from './pages/Devices';
import FireSafety from './pages/FireSafety';
import Overview from './pages/Overview';
import Parking from './pages/Parking';
import Payments from './pages/Payments';
import SandboxCheckout from './pages/SandboxCheckout';

const PAGE_SUBTITLES = {
  overview: 'Thứ năm · Trung tâm vận hành',
  parking: 'Giám sát sức chứa và cảm biến',
  access: 'Camera · RFID · Barrier',
  payments: 'Thu phí và mở cổng ra',
  fire: 'Phát hiện và hỗ trợ chữa cháy',
  devices: 'Hạ tầng edge và kết nối',
  activity: 'Luồng sự kiện hệ thống',
};

function initialPage() {
  const hash = window.location.hash.replace('#/', '');
  return NAV_ITEMS.some((item) => item.id === hash) ? hash : 'overview';
}

export default function App() {
  const [page, setPage] = useState(initialPage);
  const system = useParkingSystem();
  const pageMeta = useMemo(() => NAV_ITEMS.find((item) => item.id === page) || NAV_ITEMS[0], [page]);
  const checkoutToken = window.location.hash.startsWith('#/checkout/')
    ? decodeURIComponent(window.location.hash.slice('#/checkout/'.length))
    : '';

  useEffect(() => {
    if (!window.location.hash.startsWith('#/checkout/')) {
      window.location.hash = `/${page}`;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page]);

  useEffect(() => {
    const onHashChange = () => setPage(initialPage());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (checkoutToken) return <SandboxCheckout token={checkoutToken} />;
  if (system.loading && !system.parking && !system.access) return <LoadingScreen />;

  const pages = {
    overview: <Overview system={system} setPage={setPage} />,
    parking: <Parking parking={system.parking} />,
    access: <Access access={system.access} />,
    payments: <Payments payments={system.payments} refreshAll={system.refreshAll} />,
    fire: <FireSafety fire={system.fire} isFireActive={system.isFireActive} resolveIncident={system.resolveIncident} />,
    devices: <Devices health={system.health} devices={system.devices} apiState={system.apiState} socketState={system.socketState} />,
    activity: <ActivityLog events={system.events} socketState={system.socketState} />,
  };

  return (
    <Layout
      page={page}
      setPage={setPage}
      title={pageMeta.label}
      subtitle={PAGE_SUBTITLES[page]}
      apiState={system.apiState}
      socketState={system.socketState}
      mqttState={system.health?.mqtt}
      refreshing={system.refreshing}
      lastSync={system.lastSync}
      onRefresh={() => system.refreshAll()}
      isFireActive={system.isFireActive}
    >
      {system.error && <div className="global-error">{system.error} Dữ liệu sẽ tự tải lại khi backend sẵn sàng.</div>}
      {pages[page]}
    </Layout>
  );
}
