const defaultBaseUrl = `${window.location.protocol}//${window.location.hostname}:3000`;
const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL || defaultBaseUrl;

export const API_BASE_URL = configuredBaseUrl.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload.message || `Yêu cầu thất bại (${response.status}).`, response.status, payload.details);
  }
  return payload;
}

export const api = {
  health: () => request('/health'),
  accessStatus: () => request('/api/v1/access/status').then((result) => result.data),
  parkingStatus: () => request('/api/v1/parking/status').then((result) => result.data),
  fireStatus: () => request('/api/v1/fire/status').then((result) => result.data),
  payments: (status = '') => request(`/api/v1/payments${status ? `?status=${encodeURIComponent(status)}` : ''}`).then((result) => result.data),
  payment: (id) => request(`/api/v1/payments/${encodeURIComponent(id)}`).then((result) => result.data),
  confirmCash: (id, confirmedBy = 'OPERATOR') => request(`/api/v1/payments/${encodeURIComponent(id)}/cash/confirm`, {
    method: 'POST',
    body: JSON.stringify({ confirmedBy }),
  }).then((result) => result.data),
  createQrSandbox: (id) => request(`/api/v1/payments/${encodeURIComponent(id)}/qr-sandbox`, {
    method: 'POST',
  }).then((result) => result.data),
  checkout: (token) => request(`/api/v1/payments/checkout/${encodeURIComponent(token)}`).then((result) => result.data),
  confirmQrSandbox: (token) => request(`/api/v1/payments/checkout/${encodeURIComponent(token)}/sandbox-confirm`, {
    method: 'POST',
  }).then((result) => result.data),
  activeSession: (licensePlate) => request(`/api/v1/sessions/active/${encodeURIComponent(licensePlate)}`).then((result) => result.data),
  sessionById: (id) => request(`/api/v1/sessions/${encodeURIComponent(id)}`).then((result) => result.data),
  resolveFire: (id, resolution, notes) => request(`/api/v1/fire/incidents/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution, notes }),
  }).then((result) => result.data),
};
