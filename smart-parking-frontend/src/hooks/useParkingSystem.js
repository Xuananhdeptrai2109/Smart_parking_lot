import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_BASE_URL, api } from '../lib/api';

const ACTIVE_FIRE_STATES = new Set(['DETECTED', 'AIMING', 'SUPPRESSING']);

const EVENT_META = {
  vehicle_entered: ['Xe đã vào bãi', 'access', 'success'],
  vehicle_exited: ['Xe đã rời bãi', 'access', 'info'],
  gate_access_denied: ['Từ chối qua cổng', 'access', 'danger'],
  gate_state_changed: ['Trạng thái cổng thay đổi', 'access', 'info'],
  spot_status_changed: ['Vị trí đỗ cập nhật', 'parking', 'info'],
  fire_snapshot: ['Đã nhận dữ liệu cảm biến cháy', 'fire', 'neutral'],
  fire_alarm: ['Cảnh báo cháy', 'fire', 'danger'],
  fire_action_updated: ['Thiết bị PCCC đã phản hồi', 'fire', 'warning'],
  fire_resolved: ['Sự cố cháy đã kết thúc', 'fire', 'success'],
  device_heartbeat: ['Thiết bị vừa gửi heartbeat', 'device', 'success'],
  payment_required: ['Xe đang chờ thanh toán', 'payment', 'warning'],
  payment_status_changed: ['Trạng thái thanh toán thay đổi', 'payment', 'success'],
};

function makeEvent(type, payload) {
  const [title, domain, tone] = EVENT_META[type] || [type, 'system', 'neutral'];
  let detail = '';
  if (type === 'spot_status_changed') {
    detail = `${payload?.spot?.spotName || 'Vị trí'} · ${payload?.spot?.status || 'UPDATED'}`;
  } else if (type === 'vehicle_entered' || type === 'vehicle_exited') {
    detail = payload?.session?.Vehicle?.licensePlate || payload?.event?.recognizedPlate || '';
  } else if (type === 'gate_access_denied') {
    detail = payload?.reason || 'Yêu cầu không hợp lệ';
  } else if (type === 'device_heartbeat') {
    detail = payload?.device?.deviceCode || payload?.event?.deviceCode || 'Thiết bị IoT';
  } else if (type.startsWith('fire_')) {
    detail = payload?.incident?.status || payload?.action?.actionType || '';
  } else if (type.startsWith('payment_')) {
    const payment = payload?.payment || payload;
    detail = `${payment?.ParkingSession?.Vehicle?.licensePlate || payload?.session?.Vehicle?.licensePlate || 'Giao dịch'} · ${payment?.paymentStatus || 'PENDING'}`;
  } else if (type === 'gate_state_changed') {
    detail = `${payload?.gate?.gateCode || 'Cổng'} · ${payload?.gate?.state || ''}`;
  }
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    title,
    detail,
    domain,
    tone,
    timestamp: new Date().toISOString(),
  };
}

export function useParkingSystem() {
  const [health, setHealth] = useState(null);
  const [parking, setParking] = useState(null);
  const [access, setAccess] = useState(null);
  const [fire, setFire] = useState(null);
  const [payments, setPayments] = useState([]);
  const [devices, setDevices] = useState({});
  const [events, setEvents] = useState([]);
  const [apiState, setApiState] = useState('checking');
  const [socketState, setSocketState] = useState('connecting');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  const addEvent = useCallback((type, payload) => {
    setEvents((current) => [makeEvent(type, payload), ...current].slice(0, 60));
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const result = await api.health();
      if (!mountedRef.current) return;
      setHealth(result);
      setApiState('connected');
    } catch (requestError) {
      if (!mountedRef.current) return;
      setApiState('disconnected');
      setHealth(null);
      throw requestError;
    }
  }, []);

  const refreshAll = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    const results = await Promise.allSettled([
      api.health(),
      api.parkingStatus(),
      api.accessStatus(),
      api.fireStatus(),
      api.payments(),
    ]);

    if (!mountedRef.current) return;
    const [healthResult, parkingResult, accessResult, fireResult, paymentsResult] = results;
    if (healthResult.status === 'fulfilled') {
      setHealth(healthResult.value);
      setApiState('connected');
    } else {
      setHealth(null);
      setApiState('disconnected');
    }
    if (parkingResult.status === 'fulfilled') setParking(parkingResult.value);
    if (accessResult.status === 'fulfilled') setAccess(accessResult.value);
    if (fireResult.status === 'fulfilled') setFire(fireResult.value);
    if (paymentsResult.status === 'fulfilled') setPayments(paymentsResult.value);

    const firstError = results.find((result) => result.status === 'rejected');
    setError(firstError ? firstError.reason?.message || 'Không thể tải đầy đủ dữ liệu.' : '');
    setLastSync(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refreshAll();

    const refreshTimer = window.setInterval(() => refreshAll({ silent: true }), 15000);
    const healthTimer = window.setInterval(() => refreshHealth().catch(() => {}), 5000);

    return () => {
      mountedRef.current = false;
      window.clearInterval(refreshTimer);
      window.clearInterval(healthTimer);
    };
  }, [refreshAll, refreshHealth]);

  useEffect(() => {
    const socket = io(API_BASE_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      setSocketState('connected');
      socket.emit('subscribe_dashboard');
    });
    socket.on('disconnect', () => setSocketState('disconnected'));
    socket.on('connect_error', () => setSocketState('disconnected'));

    Object.keys(EVENT_META).forEach((eventName) => {
      socket.on(eventName, (payload) => {
        addEvent(eventName, payload);

        if (eventName === 'spot_status_changed' && payload?.lot) setParking(payload.lot);
        if (eventName === 'device_heartbeat') {
          const device = payload?.device;
          if (device?.deviceCode) {
            setDevices((current) => ({ ...current, [device.deviceCode]: device }));
          }
        }
        if (eventName === 'gate_state_changed' && payload?.gate) {
          setAccess((current) => current ? {
            ...current,
            gates: current.gates.map((gate) => gate.gateCode === payload.gate.gateCode ? payload.gate : gate),
          } : current);
        }

        if (['vehicle_entered', 'vehicle_exited', 'gate_access_denied'].includes(eventName)) {
          Promise.allSettled([api.accessStatus(), api.parkingStatus()]).then(([accessResult, parkingResult]) => {
            if (accessResult.status === 'fulfilled') setAccess(accessResult.value);
            if (parkingResult.status === 'fulfilled') setParking(parkingResult.value);
          });
        }
        if (eventName.startsWith('fire_')) {
          api.fireStatus().then(setFire).catch(() => {});
        }
        if (eventName.startsWith('payment_')) {
          api.payments().then(setPayments).catch(() => {});
        }
      });
    });

    return () => socket.disconnect();
  }, [addEvent]);

  const resolveIncident = useCallback(async (resolution, notes) => {
    if (!fire?.id) throw new Error('Không có sự cố để xử lý.');
    const result = await api.resolveFire(fire.id, resolution, notes);
    await refreshAll({ silent: true });
    return result;
  }, [fire?.id, refreshAll]);

  return {
    health,
    parking,
    access,
    fire,
    payments,
    devices,
    events,
    apiState,
    socketState,
    loading,
    refreshing,
    lastSync,
    error,
    isFireActive: ACTIVE_FIRE_STATES.has(fire?.status),
    refreshAll,
    resolveIncident,
  };
}
