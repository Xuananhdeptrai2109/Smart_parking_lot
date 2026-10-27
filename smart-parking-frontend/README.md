# Smart Parking Frontend

Dashboard quản lý cho hệ thống bãi đỗ xe thông minh, kết nối với `smart-parking-backend` qua REST API và Socket.IO.

## Tính năng

- Tổng quan sức chứa, phiên gửi, thẻ RFID và trạng thái PCCC.
- Bản đồ realtime cho bốn vị trí A1–A4.
- Giám sát hai cổng vào/ra và tra cứu phiên gửi theo biển số.
- Bản đồ cháy 5×5, bốn cảm biến lửa, khí gas, góc servo và tiến trình chữa cháy.
- Kết thúc sự cố hoặc xác nhận báo động giả có bước xác nhận an toàn.
- Trạng thái REST, MQTT, Socket.IO và heartbeat thiết bị.
- Nhật ký sự kiện realtime ngay trong phiên dashboard.
- Danh sách xe chờ thanh toán, xác nhận tiền mặt và QR sandbox.
- Trang checkout QR sandbox mô phỏng IPN; cổng chỉ mở sau khi thanh toán thành công.

## Cài đặt

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev
```

Mặc định frontend dùng hostname đang mở dashboard và cổng `3000` (mở bằng `localhost` thì gọi `localhost`; mở bằng IP LAN thì gọi IP LAN). Có thể cấu hình cố định trong `.env`:

```env
VITE_API_BASE_URL=http://localhost:3000
```

Mở giao diện tại `http://localhost:5173`.

Khi quét QR bằng điện thoại, hai thiết bị phải cùng Wi-Fi và nên mở dashboard bằng IP LAN, ví dụ `http://192.168.55.170:5173`. Khi đó đường dẫn trong QR và API thanh toán đều trỏ về máy chạy dự án thay vì `localhost` của điện thoại.

## Thứ tự chạy toàn hệ thống

Trong thư mục backend:

```powershell
docker compose up -d mqtt
npm.cmd run dev
```

Trong thư mục frontend:

```powershell
npm.cmd run dev
```

Backend cần đặt `CORS_ORIGIN=http://localhost:5173` trong môi trường production. Cấu hình development hiện tại cho phép `*`.

## An toàn

Dashboard không cung cấp nút bật bơm trực tiếp. Bơm chỉ được backend yêu cầu sau khi servo xác nhận đã định hướng và controller tại chỗ kiểm tra điều kiện an toàn.
