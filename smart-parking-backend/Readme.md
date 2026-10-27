# Smart Parking Backend

Backend IoT cho ba phân hệ: kiểm soát xe vào/ra, giám sát 4 vị trí đỗ và phát hiện/hỗ trợ chữa cháy. Thiết bị giao tiếp qua MQTT; dashboard dùng REST và Socket.IO.

Phần cứng hiện dùng hai ESP32 thường độc lập: ESP32 Gate quản lý cổng/RFID/cầu UART Arduino, còn ESP32 Fire quản lý toàn bộ cảm biến và cơ cấu PCCC. ESP32-CAM là nút camera riêng. Bốn firmware active và thứ tự nạp nằm tại `../firmware/README.md`.

## Thành phần

- Express + Socket.IO
- Prisma + MySQL
- MQTT 5 client
- Mosquitto development broker
- Node.js test runner

## Cài đặt

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Cập nhật `DATABASE_URL` trong `.env`. Khởi động MQTT development broker:

```powershell
docker compose up -d mqtt
```

Đồng bộ schema và tạo dữ liệu thiết bị mẫu:

```powershell
npm.cmd run db:push
npm.cmd run db:seed
```

`db:push` chỉ phù hợp môi trường development. Với database có dữ liệu quan trọng, hãy tạo và kiểm tra migration trước khi áp dụng.

Chạy backend:

```powershell
npm.cmd run dev
```

## Dữ liệu seed

- Cổng vào `ENTRY_GATE` và cổng ra `EXIT_GATE`.
- Bốn vị trí `A1`–`A4`.
- Mười thẻ `CARD001`–`CARD010`.
- Camera, RFID, cảm biến, LED, servo, còi và relay/bơm.

Backend chỉ công nhận bốn vị trí `A1`–`A4`. Nếu database cũ từng được seed với A5, A5 được giữ lại để không tự động xóa lịch sử nhưng sẽ bị bỏ qua khi tính sức chứa, chọn chỗ cho xe vào và nhận sự kiện cảm biến.

## REST API

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/health` | Trạng thái HTTP/MQTT |
| GET | `/api/v1/access/status` | Trạng thái cổng, thẻ và phiên gửi |
| POST | `/api/v1/access/entry` | Luồng xe vào đầy đủ |
| POST | `/api/v1/access/exit` | Luồng xe ra đầy đủ |
| POST | `/api/v1/access/gates/state` | Phản hồi trạng thái servo cửa |
| GET | `/api/v1/parking/status` | Trạng thái 4 ô đỗ |
| POST | `/api/v1/parking/spots/events` | Nhận dữ liệu cảm biến vật cản |
| GET | `/api/v1/fire/status` | Sự cố cháy gần nhất |
| POST | `/api/v1/fire/snapshots` | Nhận bốn cảm biến lửa + khí gas |
| POST | `/api/v1/fire/actions/:commandId/ack` | Xác nhận servo/còi/bơm đã thực thi |
| POST | `/api/v1/fire/incidents/:id/resolve` | Kết thúc chế độ khẩn cấp |
| POST | `/api/v1/devices/heartbeat` | Heartbeat của thiết bị |
| POST | `/api/v1/devices/commands/:commandId/ack` | Xác nhận lệnh thiết bị chung |
| GET | `/api/v1/payments` | Danh sách giao dịch thanh toán |
| POST | `/api/v1/payments/:id/cash/confirm` | Xác nhận đã thu tiền mặt và mở cổng ra |
| POST | `/api/v1/payments/:id/qr-sandbox` | Tạo QR sandbox nội bộ |
| GET | `/api/v1/payments/checkout/:token` | Nội dung checkout từ QR sandbox |
| POST | `/api/v1/payments/checkout/:token/sandbox-confirm` | Mô phỏng IPN thanh toán QR thành công |
| GET | `/api/v1/sessions/active/:licensePlate` | Tra cứu phiên đang hoạt động |
| GET | `/api/v1/sessions/:id` | Chi tiết phiên gửi xe |

Payload đầy đủ, topic MQTT và luồng điều khiển phần cứng nằm trong [docs/HARDWARE_PROTOCOL.md](docs/HARDWARE_PROTOCOL.md).

Collection Postman có sẵn tại [postman/Smart-Parking.postman_collection.json](postman/Smart-Parking.postman_collection.json).

## Socket.IO events

- `vehicle_entered`
- `vehicle_exited`
- `gate_access_denied`
- `spot_status_changed`
- `fire_snapshot`
- `fire_alarm`
- `fire_action_updated`
- `fire_resolved`
- `device_heartbeat`
- `payment_required`
- `payment_status_changed`

## Thanh toán demo

Sau khi camera và thẻ tại cổng ra được xác thực, backend giữ cổng đóng, tính phí và tạo giao dịch `PENDING`. Nhân viên chọn một trong hai cách trên dashboard:

- Xác nhận đã thu tiền mặt.
- Tạo QR sandbox; khách mở trang checkout và nhấn thanh toán thử.

Chỉ khi giao dịch chuyển sang `SUCCESS`, backend mới hoàn thành phiên gửi, trả thẻ về `AVAILABLE` và gửi lệnh MQTT mở cổng ra. QR sandbox không chuyển tiền thật và chỉ dùng cho demo local.

Để quét QR bằng điện thoại, mở dashboard trên máy tính bằng địa chỉ LAN (ví dụ `http://192.168.55.170:5173`) thay vì `localhost`. Điện thoại và máy tính phải cùng Wi-Fi; frontend sẽ tự gọi backend cùng địa chỉ máy tính tại cổng `3000`. Nếu cấu hình cố định, đặt `FRONTEND_URL` của backend và `VITE_API_BASE_URL` của frontend theo IP LAN đó.

Bảng giá mặc định:

- Tối đa 2 giờ: 10.000đ.
- Trên 2 giờ đến 5 giờ: 20.000đ.
- Sau 5 giờ: cộng 5.000đ cho mỗi giờ bắt đầu thêm.

Có thể thay đổi bằng `PARKING_PRICE_FIRST_2_HOURS`, `PARKING_PRICE_UP_TO_5_HOURS` và `PARKING_PRICE_EXTRA_HOUR` trong `.env`.

## Kiểm thử

```powershell
npm.cmd test
npm.cmd run prisma:validate
```

## Nguyên tắc an toàn

- Bãi đầy chỉ khóa cổng vào; không khóa cổng ra.
- Khi báo cháy, cổng vào đóng và cổng ra mở ở chế độ thoát hiểm.
- Bơm chỉ được yêu cầu bật sau khi controller xác nhận servo đã ngắm xong.
- Controller tại chỗ phải tự xử lý báo cháy, giới hạn góc, timeout bơm và dừng khẩn cấp ngay cả khi backend hoặc mạng bị lỗi.
- Cấu hình Mosquitto đi kèm cho phép anonymous và chỉ dùng trong development; production phải bật TLS, tài khoản và ACL theo topic.
