import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, LoaderCircle, QrCode, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, formatDateTime, statusLabel } from '../lib/format';

export default function SandboxCheckout({ token }) {
  const [payment, setPayment] = useState(null);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    api.checkout(token).then((data) => {
      if (!active) return;
      setPayment(data);
      setState(data.paymentStatus === 'SUCCESS' ? 'success' : data.paymentStatus === 'EXPIRED' ? 'expired' : 'ready');
    }).catch((error) => { if (active) { setMessage(error.message); setState('error'); } });
    return () => { active = false; };
  }, [token]);

  async function pay() {
    setState('paying'); setMessage('');
    try {
      const result = await api.confirmQrSandbox(token);
      setPayment(result.payment);
      setState('success');
    } catch (error) {
      setMessage(error.message);
      setState(error.status === 410 ? 'expired' : 'error');
    }
  }

  if (state === 'loading') return <div className="sandbox-page"><div className="sandbox-card loading"><LoaderCircle className="spinning" /><p>Đang tải giao dịch…</p></div></div>;
  const session = payment?.ParkingSession;
  const successful = state === 'success';

  return (
    <div className="sandbox-page">
      <div className={`sandbox-card ${successful ? 'success' : ''}`}>
        <div className="sandbox-brand"><span><QrCode /></span><div><strong>ParkFlow Pay</strong><small>QR SANDBOX · KHÔNG CHUYỂN TIỀN THẬT</small></div></div>
        {successful ? (
          <div className="sandbox-result"><span><CheckCircle2 size={44} /></span><h1>Thanh toán thành công</h1><p>Backend đã xác nhận giao dịch và gửi lệnh mở cổng ra.</p></div>
        ) : state === 'expired' ? (
          <div className="sandbox-result failed"><span><Clock3 size={44} /></span><h1>Mã QR đã hết hạn</h1><p>Vui lòng yêu cầu nhân viên tạo lại QR mới.</p></div>
        ) : state === 'error' ? (
          <div className="sandbox-result failed"><span><XCircle size={44} /></span><h1>Không thể thanh toán</h1><p>{message}</p></div>
        ) : (
          <>
            <div className="sandbox-merchant"><span>Thanh toán phí gửi xe</span><div className="sandbox-plate">{session?.Vehicle?.licensePlate || 'KHÔNG RÕ'}</div></div>
            <div className="sandbox-amount"><span>Số tiền</span><strong>{formatCurrency(payment?.amount)}</strong></div>
            <div className="sandbox-info"><div><span>Mã giao dịch</span><strong>{payment?.providerOrderId || `#${payment?.id}`}</strong></div><div><span>Thời gian vào</span><strong>{formatDateTime(session?.entryTime)}</strong></div><div><span>Hết hạn</span><strong>{formatDateTime(payment?.expiresAt)}</strong></div><div><span>Trạng thái</span><strong>{statusLabel(payment?.paymentStatus)}</strong></div></div>
            {message && <div className="inline-message">{message}</div>}
            <button className="sandbox-pay-button" disabled={state === 'paying'} onClick={pay}>{state === 'paying' ? <><LoaderCircle className="spinning" />Đang xác nhận…</> : <><ShieldCheck />Thanh toán thử</>}</button>
            <p className="sandbox-disclaimer">Đây là môi trường mô phỏng dành cho đồ án. Không nhập thông tin ngân hàng hoặc ví điện tử thật.</p>
          </>
        )}
      </div>
    </div>
  );
}
