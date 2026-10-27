import { useEffect, useMemo, useState } from 'react';
import { Banknote, Clock3, Copy, CreditCard, ExternalLink, QrCode, ReceiptText, WalletCards } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../lib/api';
import { formatCurrency, formatDateTime, formatDuration, statusLabel } from '../lib/format';
import { MetricCard, Panel, PanelHeader, StatusPill } from '../components/UI';

function paymentPlate(payment) {
  return payment?.ParkingSession?.Vehicle?.licensePlate || 'KHÔNG RÕ';
}

export default function Payments({ payments, refreshAll }) {
  const pending = useMemo(() => payments.filter((payment) => ['PENDING', 'PROCESSING', 'FAILED', 'EXPIRED'].includes(payment.paymentStatus)), [payments]);
  const completed = useMemo(() => payments.filter((payment) => payment.paymentStatus === 'SUCCESS'), [payments]);
  const [selectedId, setSelectedId] = useState(null);
  const [qrCheckout, setQrCheckout] = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!pending.some((payment) => payment.id === selectedId)) setSelectedId(pending[0]?.id || null);
  }, [pending, selectedId]);

  const selected = pending.find((payment) => payment.id === selectedId) || null;
  const todayRevenue = completed.reduce((sum, payment) => {
    const paidAt = payment.transactionTime ? new Date(payment.transactionTime) : null;
    const today = new Date();
    return paidAt && paidAt.toDateString() === today.toDateString() ? sum + Number(payment.amount) : sum;
  }, 0);

  async function confirmCash() {
    if (!selected || !window.confirm(`Xác nhận đã nhận ${formatCurrency(selected.amount)} tiền mặt từ xe ${paymentPlate(selected)}?`)) return;
    setWorking(true); setMessage('');
    try {
      await api.confirmCash(selected.id, 'PARKING_OPERATOR');
      setMessage('Đã xác nhận tiền mặt. Backend đang gửi lệnh mở cổng ra.');
      setQrCheckout(null);
      await refreshAll({ silent: true });
    } catch (error) {
      setMessage(error.message);
    } finally { setWorking(false); }
  }

  async function createQr() {
    if (!selected) return;
    setWorking(true); setMessage('');
    try {
      const result = await api.createQrSandbox(selected.id);
      setQrCheckout(result);
      await refreshAll({ silent: true });
    } catch (error) {
      setMessage(error.message);
    } finally { setWorking(false); }
  }

  async function copyCheckout() {
    if (!qrCheckout?.checkoutUrl) return;
    await navigator.clipboard.writeText(qrCheckout.checkoutUrl);
    setMessage('Đã sao chép đường dẫn thanh toán sandbox.');
  }

  return (
    <div className="dashboard-stack">
      <div className="metrics-grid metrics-grid-compact">
        <MetricCard label="Chờ thanh toán" value={pending.length} detail="Xe đang chờ tại cổng ra" icon={Clock3} tone={pending.length ? 'amber' : 'green'} />
        <MetricCard label="Đã thanh toán" value={completed.length} detail="Trong dữ liệu gần nhất" icon={ReceiptText} tone="green" />
        <MetricCard label="Doanh thu hôm nay" value={formatCurrency(todayRevenue)} detail="Tiền mặt và QR sandbox" icon={WalletCards} tone="blue" />
        <MetricCard label="QR hiệu lực" value="5" unit="phút" detail="Hết hạn có thể tạo lại" icon={QrCode} tone="purple" />
      </div>

      <div className="payment-layout">
        <Panel className="pending-payments-panel">
          <PanelHeader eyebrow="CỔNG RA" title="Giao dịch đang chờ" subtitle="Đã xác thực đúng biển số và thẻ RFID" />
          {pending.length ? <div className="pending-payment-list">{pending.map((payment) => (
            <button className={selected?.id === payment.id ? 'selected' : ''} key={payment.id} onClick={() => { setSelectedId(payment.id); setQrCheckout(null); setMessage(''); }}>
              <span className="payment-plate">{paymentPlate(payment)}</span>
              <div><strong>{formatCurrency(payment.amount)}</strong><small>{formatDuration(payment.ParkingSession?.entryTime, payment.pricingDetails?.checkoutAt)}</small></div>
              <StatusPill status={payment.paymentStatus} size="small" />
            </button>
          ))}</div> : <div className="empty-state"><WalletCards size={30} /><strong>Không có xe chờ thanh toán</strong><p>Giao dịch sẽ xuất hiện sau khi camera và thẻ tại cổng ra được xác thực.</p></div>}
        </Panel>

        <Panel className="checkout-panel">
          <PanelHeader eyebrow="CHECKOUT" title={selected ? `Thanh toán xe ${paymentPlate(selected)}` : 'Chọn một giao dịch'} />
          {selected ? (
            <>
              <div className="checkout-summary">
                <div><span>Thời gian vào</span><strong>{formatDateTime(selected.ParkingSession?.entryTime)}</strong></div>
                <div><span>Thời điểm tính phí</span><strong>{formatDateTime(selected.pricingDetails?.checkoutAt)}</strong></div>
                <div><span>Tổng thời gian</span><strong>{formatDuration(selected.ParkingSession?.entryTime, selected.pricingDetails?.checkoutAt)}</strong></div>
                <div><span>Khung giá</span><strong>{selected.pricingDetails?.tier || '—'}</strong></div>
              </div>
              <div className="checkout-total"><span>Số tiền cần thanh toán</span><strong>{formatCurrency(selected.amount)}</strong></div>
              {message && <div className="inline-message">{message}</div>}
              {!qrCheckout?.checkoutUrl ? (
                <div className="payment-method-buttons">
                  <button className="secondary-button cash" disabled={working} onClick={confirmCash}><Banknote size={18} />Xác nhận tiền mặt</button>
                  <button className="primary-button" disabled={working} onClick={createQr}><QrCode size={18} />Tạo QR sandbox</button>
                </div>
              ) : (
                <div className="qr-checkout-box">
                  <div className="qr-canvas"><QRCodeSVG value={qrCheckout.checkoutUrl} size={180} level="M" marginSize={2} /></div>
                  <div><span>QR SANDBOX</span><strong>{formatCurrency(selected.amount)}</strong><p>Quét bằng camera điện thoại hoặc mở đường dẫn để mô phỏng thanh toán.</p></div>
                  <div className="qr-actions">
                    <button className="secondary-button" onClick={copyCheckout}><Copy size={16} />Sao chép</button>
                    <a className="primary-button" href={qrCheckout.checkoutUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />Mở trang trả tiền</a>
                  </div>
                </div>
              )}
              <p className="checkout-warning"><CreditCard size={15} /> Cổng chỉ mở sau khi giao dịch thành công. QR này là sandbox nội bộ, không chuyển tiền thật.</p>
            </>
          ) : <div className="empty-state"><ReceiptText size={28} /><p>Chọn giao dịch bên trái để xử lý.</p></div>}
        </Panel>
      </div>

      <Panel>
        <PanelHeader eyebrow="LỊCH SỬ" title="Giao dịch đã hoàn thành" subtitle="50 giao dịch mới nhất từ backend" />
        <div className="device-table-wrap">
          <table className="device-table payment-table">
            <thead><tr><th>Mã</th><th>Biển số</th><th>Giờ vào</th><th>Giờ ra</th><th>Thời lượng</th><th>Phương thức</th><th>Số tiền</th><th>Trạng thái</th></tr></thead>
            <tbody>{completed.length ? completed.map((payment) => (
              <tr key={payment.id}><td>#{payment.id}</td><td><code>{paymentPlate(payment)}</code></td><td>{formatDateTime(payment.ParkingSession?.entryTime)}</td><td>{formatDateTime(payment.ParkingSession?.exitTime)}</td><td>{formatDuration(payment.ParkingSession?.entryTime, payment.ParkingSession?.exitTime)}</td><td>{payment.paymentMethod || '—'}</td><td><strong>{formatCurrency(payment.amount)}</strong></td><td><StatusPill status={payment.paymentStatus} size="small" /></td></tr>
            )) : <tr><td colSpan="8" className="empty-table">Chưa có giao dịch hoàn thành.</td></tr>}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
