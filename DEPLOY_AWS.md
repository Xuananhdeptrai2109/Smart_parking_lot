# Hướng dẫn triển khai Smart Parking Lot lên máy chủ AWS EC2

Tài liệu này hướng dẫn cách đưa toàn bộ hệ thống (Frontend, Backend, MQTT Mosquitto, Caddy Reverse Proxy / HTTPS và Simulator) lên máy chủ ảo (VM) trên AWS bằng **Docker Compose**.

---

## 1. Cấu trúc các dịch vụ trong Docker Compose

```text
[Internet / Người dùng] ────► Cổng 80/443 (HTTPS Caddy)
                                  │
         ┌────────────────────────┼────────────────────────┐
         │ (/*)                   │ (/api, /socket.io)     │ (/uploads/anpr)
         ▼                        ▼                        ▼
  [Frontend React]         [Backend Node.js] ◄─────► [Volume anpr-images]
                                  │
                                  ├──────────► [MySQL RDS Cloud]
                                  │
[ESP32 Hardware] ──────────► [MQTT Mosquitto] (Cổng 1883)
```

1. **Frontend (React 18 + Vite + Tailwind/CSS)**: Chạy Nginx độc lập trên cổng nội bộ 80.
2. **Backend (Node.js 22 + Express + Socket.IO + Prisma)**: Chạy trên cổng 3000, kết nối CSDL RDS.
3. **Demo Simulator (Tích hợp trong Backend)**: Tự động phát heartbeat các thiết bị (ONLINE), biểu đồ PCCC an toàn, và mô phỏng chu trình xe vào/đỗ/ra/thanh toán trực quan theo thời gian thực.
4. **MQTT Mosquitto Broker**: Lắng nghe cổng 1883 (TCP cho ESP32) và 9001 (WebSockets), có mật khẩu bảo vệ.
5. **Caddy Reverse Proxy**: Tự động cấp và gia hạn chứng chỉ SSL miễn phí (Let's Encrypt) cho tên miền / IP dạng `sslip.io`.

---

## 2. Chuẩn bị trên máy chủ AWS EC2 (Security Group & Docker)

### 2.1. Cấu hình Inbound Rules trong AWS Security Group
Đảm bảo Security Group gắn với EC2 instance đã mở các cổng sau:

| Loại | Cổng | Giao thức | Mục đích | Nguồn |
| :--- | :--- | :--- | :--- | :--- |
| **HTTP** | `80` | TCP | Caddy nhận diện và chuyển hướng HTTPS | `0.0.0.0/0` |
| **HTTPS** | `443` | TCP / UDP | Người dùng xem Dashboard & ESP32-CAM upload ảnh | `0.0.0.0/0` |
| **Custom TCP** | `1883` | TCP | ESP32 GATE và ESP32 FIRE kết nối MQTT | `0.0.0.0/0` |
| **SSH** | `22` | TCP | Quản trị máy chủ | IP của bạn |

### 2.2. Cài đặt Docker & Docker Compose trên Ubuntu EC2 (nếu chưa có)
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

---

## 3. Triển khai hệ thống

### Bước 1: Đưa mã nguồn lên máy chủ EC2
Chuyển nhánh `test` và pull code về thư mục làm việc trên EC2:
```bash
git clone <URL_REPO> Smart_parking_lot
cd Smart_parking_lot
git checkout test
```

### Bước 2: Kiểm tra file `.env` ở thư mục gốc
File `.env` ở thư mục gốc đã được thiết lập sẵn các thông số mặc định cho AWS:
- `PUBLIC_HOST`: Đổi thành IP/domain EC2 của bạn (ví dụ: `3-105-215-46.sslip.io` hoặc `domain-cua-ban.com`).
- `PUBLIC_BASE_URL`: `https://3-105-215-46.sslip.io`
- `DATABASE_URL`: Đường dẫn MySQL RDS.
- `ENABLE_DEMO_SIMULATOR`: `true` (mô phỏng xe vào/ra thực tế) hoặc `false` (chỉ nhận sự kiện từ mạch thật).

### Bước 3: Khởi chạy toàn bộ hệ thống bằng 1 lệnh duy nhất
Tại thư mục gốc `Smart_parking_lot/`:
```bash
docker compose up -d --build
```

Docker sẽ tự động:
1. Tạo tài khoản xác thực MQTT cho Mosquitto.
2. Build container Frontend (React SPA).
3. Build container Backend, tự động đồng bộ schema Prisma và nạp dữ liệu ban đầu (seed).
4. Khởi động Caddy tự động xin chứng chỉ SSL cho domain.
5. Kích hoạt Simulator để bãi đỗ xe luôn hiển thị trạng thái sinh động.

---

## 4. Kiểm tra và giám sát

1. **Xem trạng thái các container:**
   ```bash
   docker compose ps
   ```
   Tất cả 4 dịch vụ (`mqtt`, `backend`, `frontend`, `caddy`) phải ở trạng thái `running` (hoặc `healthy`).

2. **Xem nhật ký hoạt động (Logs):**
   ```bash
   # Xem log backend (bao gồm cả simulator)
   docker compose logs -f backend

   # Xem log reverse proxy HTTPS
   docker compose logs -f caddy
   ```

3. **Truy cập hệ thống:**
   - Mở trình duyệt Web: `https://<PUBLIC_HOST>` (ví dụ: `https://3-105-215-46.sslip.io`).
   - Kiểm tra Health: `https://<PUBLIC_HOST>/health`.

---

## 5. Các lệnh quản trị hữu ích

- **Khởi động lại toàn bộ:**
  ```bash
  docker compose restart
  ```
- **Tắt hệ thống:**
  ```bash
  docker compose down
  ```
- **Tắt và xóa sạch dữ liệu cache/volume (để làm mới hoàn toàn):**
  ```bash
  docker compose down -v
  ```
- **Tắt chế độ mô phỏng khi kết nối phần cứng thật:**
  Sửa trong file `.env`:
  ```env
  ENABLE_DEMO_SIMULATOR=false
  ```
  Sau đó chạy:
  ```bash
  docker compose up -d backend
  ```

