# Smart Parking Lot — hệ thống bãi đỗ xe thông minh phân tán

Đây là dự án IoT quản lý bãi đỗ xe gồm ba phân hệ chính:

1. Kiểm soát xe vào/ra bằng cảm biến, servo thanh chắn, RFID và camera biển số.
2. Giám sát bốn vị trí đỗ A1–A4 bằng Arduino, cảm biến vật cản và LED đỏ/xanh.
3. Phát hiện, định hướng và hỗ trợ chữa cháy bằng một ESP32 độc lập.

Hệ thống hiện dùng **2 ESP32 thường, 1 ESP32-CAM và 1 Arduino Uno**. Thiết bị trao đổi dữ liệu với backend qua MQTT; frontend sử dụng REST API và Socket.IO để giám sát theo thời gian thực.

> Đây là mô hình demo/học tập, không phải hệ thống kiểm soát cháy được chứng nhận. Không thử lửa, bơm hoặc tải công suất khi chưa kiểm tra nguồn, relay và cơ cấu dừng khẩn cấp.

## 1. Kiến trúc tổng thể

```text
                           ┌──────────────────────────┐
                           │  ANPR service (bên ngoài)│
                           │  nhận ảnh, đọc biển số   │
                           └────────────▲─────────────┘
                                        │ HTTP/JPEG
┌──────────────────┐        Wi-Fi/MQTT  │
│ ESP32-CAM        ├────────────────────┘
│ camera hai làn   │
└────────┬─────────┘
         │ MQTT
         ▼
┌──────────────────┐       UART       ┌──────────────────┐
│ ESP32 số 1 GATE  │◄────────────────►│ Arduino Uno      │
│ cổng + RFID      │                   │ 4 ô đỗ + 8 LED   │
└────────┬─────────┘                   └──────────────────┘
         │ Wi-Fi/MQTT
         │
┌────────▼─────────┐
│ MQTT Mosquitto   │◄─────────────────┐
└────────┬─────────┘                  │ Wi-Fi/MQTT
         │                            │
┌────────▼─────────┐          ┌───────┴──────────┐
│ Node.js backend  │          │ ESP32 số 2 FIRE │
│ REST + Socket.IO │          │ cảm biến + PCCC │
└──────┬───────┬───┘          └──────────────────┘
       │       │
       │       └──────────────► MySQL/Aiven
       │
       └── REST + Socket.IO ──► React dashboard
```

Hai ESP32 thường hoạt động độc lập:

- ESP32 GATE hỏng hoặc reset không làm ESP32 FIRE dừng đọc cảm biến.
- ESP32 FIRE chưa lắp xong vẫn có thể tắt nguồn và kiểm thử toàn bộ cổng/bãi đỗ.
- GPIO trùng số trên hai ESP32 là hai chân vật lý khác nhau.

## 2. Cấu trúc thư mục

```text
Smart_parking_lot/
├── README.md                         # tài liệu tổng quan này
├── so_do_mach.md                     # sơ đồ đấu dây chi tiết
│
├── firmware/
│   ├── README.md                     # hướng dẫn nạp firmware
│   ├── esp32_main_controller/
│   │   └── esp32_main_controller.ino # ESP32 số 1 GATE
│   ├── esp32_fire_controller/
│   │   └── esp32_fire_controller.ino # ESP32 số 2 FIRE
│   ├── esp32_cam/
│   │   └── esp32_cam.ino             # ESP32-CAM
│   ├── arduino_parking/
│   │   └── arduino_parking.ino       # Arduino Uno bãi đỗ
│   └── hardware_tests/               # sketch kiểm tra phần cứng độc lập
│
├── smart-parking-backend/
│   ├── src/
│   │   ├── config/                   # cấu hình DB, bãi xe
│   │   ├── controllers/              # xử lý HTTP
│   │   ├── infrastructure/           # MQTT, event bus, realtime
│   │   ├── routes/                   # REST API
│   │   ├── services/                 # nghiệp vụ cổng, bãi, cháy, thanh toán
│   │   ├── sockets/                  # Socket.IO
│   │   ├── utils/                    # chuẩn hóa/kiểm tra dữ liệu
│   │   └── app.js                    # điểm khởi động backend
│   ├── prisma/                       # schema và seed MySQL
│   ├── scripts/                      # script đăng ký thẻ RFID
│   ├── docs/HARDWARE_PROTOCOL.md     # REST/MQTT payload chi tiết
│   ├── postman/                      # Postman collection
│   ├── infrastructure/mosquitto/     # cấu hình MQTT development
│   ├── docker-compose.yml            # Mosquitto container
│   └── README.md                     # tài liệu backend
│
└── smart-parking-frontend/
    ├── src/
    │   ├── components/               # thành phần giao diện
    │   ├── hooks/                    # tải dữ liệu và Socket.IO
    │   ├── lib/                      # REST client và định dạng
    │   ├── pages/                    # tổng quan, cổng, bãi, cháy, thanh toán
    │   ├── App.jsx
    │   └── main.jsx
    ├── vite.config.js
    ├── package.json
    └── README.md                     # tài liệu frontend
```

`node_modules/` và `dist/` là thư mục sinh ra khi cài/build, không phải mã nguồn cần chỉnh sửa.

## 3. Phân công thiết bị

| Thiết bị | Chức năng | Firmware | Board Arduino IDE |
|---|---|---|---|
| ESP32 số 1 — GATE | Hai cảm biến cổng, hai servo, RC522, cầu UART Arduino | `firmware/esp32_main_controller/esp32_main_controller.ino` | `ESP32 Dev Module` |
| ESP32 số 2 — FIRE | Bốn cảm biến lửa, gas, hai servo vòi, relay bơm/còi, nút dừng | `firmware/esp32_fire_controller/esp32_fire_controller.ino` | `ESP32 Dev Module` |
| ESP32-CAM | Chụp ảnh dùng chung cho làn ra/vào | `firmware/esp32_cam/esp32_cam.ino` | `AI Thinker ESP32-CAM` |
| Arduino Uno | Bốn cảm biến vị trí và tám LED | `firmware/arduino_parking/arduino_parking.ino` | `Arduino Uno` |

Thư viện Arduino cần cài:

- `PubSubClient`
- `ArduinoJson`
- `ESP32Servo`
- `MFRC522`
- `SoftwareSerial` có sẵn trong Arduino AVR core
- `esp_camera` có sẵn trong ESP32 Arduino core

## 4. Nguồn điện và GND chung

### 4.1. Adapter 5 V–2 A: phần logic

```text
Adapter (+5 V)
├── ESP32 GATE VIN/5V
├── ESP32 FIRE VIN/5V
├── Arduino Uno 5V
├── VCC hai LM393 ở cổng
├── VCC cảm biến gas
├── Relay DC+
└── Relay COM2 cấp còi

Adapter (-/GND)
├── ESP32 GATE GND
├── ESP32 FIRE GND
├── Arduino Uno GND
├── GND cảm biến/module
├── GND tất cả LED
├── Relay DC-
├── Còi (-)
└── nối một điểm tới Buck B OUT-
```

Nếu các ESP32 reset khi nhiều thiết bị cùng chạy, nên dùng adapter logic 5 V–3 A chất lượng tốt.

### 4.2. Hai pin 3,7 V nối tiếp + Buck B: tải 5 V

```text
Pin 2S/BMS (+) ── Buck B IN+
Pin 2S/BMS (-) ── Buck B IN-

Buck B OUT+ 5,0 V
├── dây đỏ của 4 servo
└── Relay COM1 cấp bơm

Buck B OUT-
├── dây nâu/đen của 4 servo
├── Bơm (-)
└── nối một điểm tới Adapter GND
```

Quy tắc nguồn:

- Đo và chỉnh Buck B về `4,9–5,0 V` trước khi cắm servo/bơm.
- Chỉ nối chung GND; không nối Adapter `+5 V` với Buck B `OUT+`.
- Không cấp servo hoặc bơm từ chân 3V3/5V của ESP32.
- ESP32-CAM dùng USB riêng trên đế nạp; không cấp thêm 5 V vào chân bo khi đang dùng USB.
- Tắt toàn bộ nguồn trước khi thay dây.

## 5. Kết nối ESP32 số 1 — GATE

### 5.1. Hai cảm biến cổng LM393

| Thiết bị | VCC | GND | OUT |
|---|---|---|---|
| Cảm biến xe vào | Adapter +5 V | GND chung | chia áp rồi vào GPIO21 |
| Cảm biến xe ra | Adapter +5 V | GND chung | chia áp rồi vào GPIO22 |

Mỗi chân OUT dùng một bộ chia áp riêng:

```text
LM393 OUT ── 10k ── 10k ──●── GPIO21 hoặc GPIO22
                            │
                           10k
                            │
                           10k
                            │
                           10k
                            │
                           GND
```

Hai cảm biến dùng tổng cộng 10 điện trở 10 kΩ. Không nối chung hai chân OUT.

### 5.2. Hai servo thanh chắn

| Servo | Dây đỏ | Dây nâu/đen | Dây vàng/cam/trắng |
|---|---|---|---|
| Cổng vào | Buck B OUT+ 5 V | Buck B OUT- | ESP32 GATE GPIO25 |
| Cổng ra | Buck B OUT+ 5 V | Buck B OUT- | ESP32 GATE GPIO26 |

Firmware dùng `0°` là đóng và `90°` là mở.

### 5.3. RC522

| RC522 | ESP32 GATE |
|---|---|
| 3.3V | 3V3 |
| GND | GND |
| SDA/SS | GPIO5 |
| SCK | GPIO18 |
| MOSI | GPIO23 |
| MISO | GPIO19 |
| RST | 3V3 |
| IRQ | Không nối |

RC522 chỉ dùng 3,3 V, tuyệt đối không cấp 5 V.

### 5.4. UART giữa ESP32 GATE và Arduino

```text
ESP32 GATE GPIO17/TX2 ─────────────── Arduino A3/RX

Arduino A4/TX ── 10k ── 10k ──●──── ESP32 GATE GPIO16/RX2
                                │
                               10k
                                │
                               10k
                                │
                               10k
                                │
                               GND

ESP32 GATE GND ───────────────────── Arduino GND
```

Arduino TX là mức 5 V nên phải qua chia áp trước khi vào ESP32 3,3 V. Chiều ESP32 TX tới Arduino RX có thể nối trực tiếp.

## 6. Kết nối Arduino Uno — bốn vị trí đỗ

### 6.1. Cảm biến A1–A4

| Vị trí | VCC | GND | OUT |
|---|---|---|---|
| A1 | Arduino 5V | GND chung | D2 |
| A2 | Arduino 5V | GND chung | D3 |
| A3 | Arduino 5V | GND chung | D4 |
| A4 | Arduino 5V | GND chung | D5 |

Các module LM393 của bãi đỗ nối OUT trực tiếp vào Arduino vì Arduino Uno dùng logic 5 V.

### 6.2. LED đỏ/xanh

| Vị trí | LED đỏ | LED xanh |
|---|---|---|
| A1 | D7 | D12 |
| A2 | D8 | D13 |
| A3 | D9 | A0 |
| A4 | D10 | A1 |

Mỗi LED phải có một điện trở 220 Ω riêng:

```text
Chân Arduino ── 220Ω ── chân dài LED (+)
Chân ngắn LED (-) ───── GND chung
```

Tổng cộng dùng 8 LED và 8 điện trở 220 Ω. Có thể nối chung toàn bộ chân âm LED và GND cảm biến về thanh GND/Adapter âm.

Arduino gửi trạng thái qua UART ở 9600 baud:

```text
SPOT,A1,1   # A1 có xe
SPOT,A1,0   # A1 trống
```

Arduino cũng nhận lệnh màu LED từ ESP32:

```text
LED,A1,RED
LED,A1,GREEN
```

## 7. Kết nối ESP32 số 2 — FIRE

### 7.1. Bốn cảm biến lửa

Nên cấp các module lửa bằng 3,3 V để AO không vượt quá điện áp cho phép của ESP32:

| Vị trí | VCC | GND | AO | DO |
|---|---|---|---|---|
| NW — trên trái | ESP32 FIRE 3V3 | GND chung | GPIO34 | Không nối |
| NE — trên phải | ESP32 FIRE 3V3 | GND chung | GPIO35 | Không nối |
| SW — dưới trái | ESP32 FIRE 3V3 | GND chung | GPIO36/VP | Không nối |
| SE — dưới phải | ESP32 FIRE 3V3 | GND chung | GPIO39/VN | Không nối |

Bốn chân GND cảm biến có thể nối chung rồi đi về ESP32 GND/Adapter âm. Khi cấp cảm biến bằng 3,3 V, AO nối trực tiếp và không cần chia áp.

### 7.2. Cảm biến gas

| Chân gas | Nối với |
|---|---|
| VCC | Adapter +5 V |
| GND | GND chung |
| AO | Chia áp rồi vào ESP32 FIRE GPIO32 |
| DO | Không nối |

```text
Gas AO ── 10k ── 10k ──●── GPIO32
                         │
                        10k
                         │
                        10k
                         │
                        10k
                         │
                        GND
```

### 7.3. Hai servo vòi phun

| Servo | Dây đỏ | Dây nâu/đen | Signal |
|---|---|---|---|
| Ngang/pan | Buck B OUT+ | Buck B OUT- | GPIO25 |
| Dọc/tilt | Buck B OUT+ | Buck B OUT- | GPIO26 |

Khung vòi phun đặt giữa một cạnh của vùng giám sát, hướng về tâm. Các góc servo cần hiệu chuẩn theo mô hình thực tế.

### 7.4. Relay hai kênh, bơm và còi

Điều khiển relay:

| Relay | Nối với |
|---|---|
| DC+ | Adapter +5 V |
| DC- | GND chung |
| IN1 | ESP32 FIRE GPIO14 — bơm |
| IN2 | ESP32 FIRE GPIO27 — còi |

Tiếp điểm bơm:

```text
Buck B OUT+ ── cầu chì phù hợp ── COM1
NO1 ───────────────────────────── Bơm (+)
Bơm (-) ───────────────────────── Buck B OUT-
NC1 ───────────────────────────── Không nối
```

Tiếp điểm còi TMB12A05 5 V:

```text
Adapter +5 V ── COM2
NO2 ─────────── Còi (+)
Còi (-) ─────── GND chung
NC2 ─────────── Không nối
```

Firmware hiện giả định relay kích mức LOW. Lần đầu chỉ kiểm tra đèn báo/click của relay, chưa nối bơm và còi vào COM/NO.

### 7.5. Nút dừng khẩn cấp

```text
ESP32 FIRE GPIO13 ── nút thường hở ── GND
```

Firmware dùng `INPUT_PULLUP`, không cần điện trở ngoài. Khi nhấn, controller phải tắt bơm ngay.

## 8. ESP32-CAM và cách đặt camera

- ESP32-CAM cắm đầy đủ vào đế nạp và dùng nguồn USB riêng.
- Không cần dây tín hiệu tới ESP32 GATE; hai bo giao tiếp bằng Wi-Fi/MQTT.
- Camera dùng chung hai làn:
  - nửa trái ảnh: xe ra;
  - nửa phải ảnh: xe vào.
- Camera nên nhìn gần vuông góc biển số; ưu tiên ảnh rõ hơn một chiều cao cố định.
- Firmware chụp JPEG UXGA và gửi ảnh tới `ANPR_URL`.
- Repository hiện **không chứa dịch vụ ANPR**. Khi chưa có ANPR thật, đặt `USE_MOCK_ANPR=true` để thử luồng phần mềm; mock không kiểm tra độ chính xác đọc biển số.

Nếu cảm biến được nhận dạng là OV3660, nên giữ cấu hình lật/độ sáng/màu đã hiệu chỉnh trong firmware chính.

## 9. Điện trở đang sử dụng

| Mục đích | Số lượng |
|---|---:|
| Chia áp OUT của hai LM393 cổng | 10 × 10 kΩ |
| Chia áp Arduino A4/TX → ESP32 GPIO16/RX2 | 5 × 10 kΩ |
| Chia áp gas AO → ESP32 FIRE GPIO32 | 5 × 10 kΩ |
| Hạn dòng tám LED đỏ/xanh | 8 × 220 Ω |

Tổng theo thiết kế hiện tại: **20 điện trở 10 kΩ và 8 điện trở 220 Ω**. Điện trở không phân cực.

## 10. Giao tiếp phần mềm

### 10.1. MQTT

Broker development chạy bằng Mosquitto, mặc định tại cổng `1883`. Prefix topic là `smart-parking`.

Thiết bị gửi lên:

| Topic | Nội dung |
|---|---|
| `smart-parking/events/gate/entry/request` | ảnh, biển số nửa phải và UID lúc vào |
| `smart-parking/events/gate/exit/request` | ảnh, biển số nửa trái và UID lúc ra |
| `smart-parking/events/gate/state` | trạng thái đóng/mở cổng |
| `smart-parking/events/parking/spot/state` | trạng thái A1–A4 |
| `smart-parking/events/fire/snapshot` | bốn mức lửa và mức gas |
| `smart-parking/events/command/ack` | kết quả thực thi lệnh |
| `smart-parking/events/device/heartbeat` | trạng thái online của thiết bị |

Backend gửi xuống:

| Topic | Nội dung |
|---|---|
| `smart-parking/local/camera/capture` | yêu cầu ESP32-CAM chụp |
| `smart-parking/local/camera/result` | kết quả ảnh/biển số từ camera |
| `smart-parking/commands/gate/{deviceCode}` | mở/đóng servo cổng |
| `smart-parking/commands/led/{deviceCode}` | đặt LED đỏ/xanh |
| `smart-parking/commands/fire/{deviceCode}` | còi, hướng servo, bơm |
| `smart-parking/state/parking-lot` | trạng thái tổng hợp được retain |

Payload chi tiết nằm trong `smart-parking-backend/docs/HARDWARE_PROTOCOL.md`.

### 10.2. REST và Socket.IO

Backend mặc định chạy ở `http://localhost:3000`. Frontend chạy ở `http://localhost:5173`.

Frontend tải trạng thái bằng REST và nhận cập nhật realtime qua Socket.IO, gồm xe vào/ra, vị trí đỗ, cảnh báo cháy, heartbeat thiết bị và thanh toán.

## 11. Cấu hình mạng

Ba firmware ESP32 đều phải đặt đúng:

```cpp
const char *WIFI_SSID = "TEN_WIFI";
const char *WIFI_PASSWORD = "MAT_KHAU_WIFI";
const char *MQTT_HOST = "IP_LAN_CUA_MAY_TINH";
```

Lấy IP máy chạy Docker/backend bằng:

```powershell
ipconfig
```

Dùng địa chỉ IPv4 của card Wi-Fi, ví dụ `192.168.55.170`; không dùng `localhost` trong firmware. Máy tính và tất cả ESP32 phải ở cùng mạng, firewall phải cho phép cổng `1883` và `3000`.

## 12. Cài và chạy toàn hệ thống

### 12.1. Yêu cầu

- Node.js và npm
- Docker Desktop
- MySQL/Aiven và một `DATABASE_URL` hợp lệ
- Arduino IDE cùng ESP32/Arduino board packages
- Máy tính và các ESP32 dùng chung Wi-Fi

### 12.2. Backend, database và MQTT

Mở PowerShell tại `smart-parking-backend`:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Sửa `DATABASE_URL` trong `.env`, sau đó:

```powershell
docker compose up -d mqtt
npm.cmd run db:push
npm.cmd run db:seed
npm.cmd run dev
```

Kiểm tra:

```powershell
docker compose ps mqtt
Test-NetConnection 127.0.0.1 -Port 1883
```

Backend khỏe khi mở `http://localhost:3000/health` nhận được phản hồi JSON.

### 12.3. Frontend

Mở PowerShell khác tại `smart-parking-frontend`:

```powershell
npm.cmd install
npm.cmd run dev
```

Mở `http://localhost:5173`. Khi dùng điện thoại quét QR sandbox, mở frontend bằng IP LAN, ví dụ:

```text
http://192.168.55.170:5173
```

Frontend mặc định gọi backend tại cùng hostname, cổng `3000`. Có thể đặt biến `VITE_API_BASE_URL` nếu cần cấu hình cố định.

### 12.4. Nạp firmware

Thứ tự khuyến nghị:

1. Arduino Uno: `arduino_parking.ino`.
2. ESP32 GATE: `esp32_main_controller.ino`.
3. ESP32-CAM: `esp32_cam.ino`.
4. ESP32 FIRE: `esp32_fire_controller.ino`, chỉ sau khi đã kiểm tra relay không tải.

Sau khi nạp, mở Serial Monitor đúng baud của từng sketch và xác nhận Wi-Fi/MQTT kết nối thành công.

## 13. Dữ liệu RFID hiện tại

Database seed xóa các UID giả `CARD001`–`CARD010` và đăng ký năm thẻ thật:

| Nhãn | UID ban đầu | Trạng thái khi seed |
|---|---|---|
| Thẻ khách 01 | `A9FB4420` | `AVAILABLE` |
| Thẻ khách 02 | `27B828B0` | `AVAILABLE` |
| Thẻ khách 03 | `577231B0` | `AVAILABLE` |
| Thẻ khách 04 | `17C32AB0` | `AVAILABLE` |
| Thẻ khách 05 | `27A437B0` | `AVAILABLE` |

Đăng ký thêm thẻ:

```powershell
npm.cmd run card:register -- UID_CUA_THE "Tên thẻ"
```

## 14. Luồng hoạt động

### 14.1. Xe vào

```text
Cảm biến cổng vào phát hiện xe
→ ESP32 GATE yêu cầu ESP32-CAM chụp
→ camera/ANPR lấy biển số ở nửa phải
→ nhân viên lấy một thẻ AVAILABLE, quét RC522 rồi giao cho khách
→ backend kiểm tra thẻ, biển số, chỗ trống và trạng thái cháy
→ backend tạo phiên gửi, gán ô FREE đầu tiên, đổi thẻ thành ISSUED
→ ô chuyển FREE → RESERVED
→ backend gửi lệnh mở servo cổng vào
→ cảm biến hết thấy xe khoảng 1,2 giây thì cổng đóng
```

Thẻ không được random tự động. Backend sử dụng đúng UID vật lý vừa được quét. ESP32 chờ camera và thẻ trong tối đa khoảng 30 giây.

### 14.2. Xe đỗ

```text
Xe đi vào ô được gán
→ cảm biến LM393 của ô chuyển active LOW
→ Arduino bật LED đỏ, tắt LED xanh
→ Arduino gửi trạng thái qua UART cho ESP32 GATE
→ ESP32 gửi MQTT lên backend
→ backend cập nhật ô thành OCCUPIED
→ frontend nhận sự kiện Socket.IO và cập nhật bản đồ
```

Khi cảm biến không thấy xe, LED xanh bật và LED đỏ tắt. Arduino tự đổi LED theo cảm biến ngay cả khi mất backend.

### 14.3. Xe ra và thanh toán

```text
Xe rời ô và tới cổng ra
→ cảm biến cổng ra yêu cầu camera chụp
→ ANPR lấy biển số ở nửa trái
→ khách trả và quét đúng thẻ đã nhận lúc vào
→ backend đối chiếu UID, phiên ACTIVE và biển số vào/ra
→ backend tính phí từ thời gian vào tới thời điểm yêu cầu ra
→ cổng giữ đóng trong lúc chờ thanh toán
→ nhân viên xác nhận tiền mặt hoặc khách xác nhận QR sandbox
→ payment SUCCESS, session COMPLETED, thẻ trở lại AVAILABLE
→ backend gửi lệnh mở cổng ra
→ xe đi qua và cổng tự đóng
```

Bãi đầy chỉ chặn xe vào, không chặn xe ra.

Bảng giá mặc định:

- Tối đa 2 giờ: 10.000đ.
- Trên 2 đến 5 giờ: 20.000đ.
- Sau 5 giờ: cộng 5.000đ cho mỗi giờ bắt đầu thêm.

QR sandbox chỉ mô phỏng thanh toán, không chuyển tiền thật.

### 14.4. Phát hiện và hỗ trợ chữa cháy

```text
ESP32 FIRE đọc 4 cảm biến lửa + cảm biến gas
→ gửi snapshot đã chuẩn hóa qua MQTT
→ backend so ngưỡng và ước lượng tọa độ trên lưới 5×5
→ bật còi và chuyển cổng sang chế độ thoát hiểm
→ gửi góc pan/tilt cho hai servo
→ chỉ sau khi nhận ACK ngắm thành công mới gửi PUMP_ON
→ bơm có thời gian chạy tối đa và có nút dừng khẩn cấp
→ người vận hành resolve sự cố để tắt bơm/còi và thoát khẩn cấp
```

Tọa độ quy ước: `SW=(0,0)`, `SE=(4,0)`, `NW=(0,4)`, `NE=(4,4)`.

`ENABLE_LOCAL_AUTONOMOUS_MODE` trong firmware FIRE mặc định là `false`. Chỉ bật sau khi cảm biến, servo, relay, bơm và nút dừng đều đã được thử an toàn.

## 15. Trình tự kiểm thử

### Giai đoạn 1 — không cần backend

1. Nạp `firmware/hardware_tests/esp32_gate_test/esp32_gate_test.ino` để thử hai cảm biến cổng, hai servo và RC522.
2. Nạp `firmware/hardware_tests/arduino_parking_test/arduino_parking_test.ino` để thử A1–A4 và tám LED.
3. Dùng ví dụ `CameraWebServer` để căn nét/góc ESP32-CAM.
4. Chưa nối tải bơm/còi khi thử relay FIRE lần đầu.

### Giai đoạn 2 — tích hợp cổng và bãi đỗ

1. Nạp lại firmware chính cho Arduino, ESP32 GATE và ESP32-CAM.
2. Để ESP32 FIRE, relay, bơm và còi tắt nguồn.
3. Bật MQTT, backend và frontend.
4. Dùng `USE_MOCK_ANPR=true` nếu chưa có dịch vụ đọc biển số.
5. Thử một chu trình vào → đỗ → ra → thanh toán bằng đúng một thẻ.
6. Lặp lại với nhiều thẻ và kiểm tra trạng thái thẻ/ô trên dashboard.

### Giai đoạn 3 — tích hợp FIRE

1. Hiệu chuẩn từng cảm biến lửa và gas.
2. Kiểm tra hai servo không gắn vòi/bơm.
3. Kiểm tra relay không tải.
4. Kiểm tra nút dừng khẩn cấp.
5. Sau cùng mới nối còi và bơm, dùng nguồn có bảo vệ phù hợp.

## 16. Trạng thái và giới hạn hiện tại

- Bãi đỗ có bốn vị trí A1–A4.
- Một ESP32-CAM và một RC522 dùng chung cho hai làn; firmware chỉ xử lý một yêu cầu vào hoặc ra tại một thời điểm.
- Dịch vụ ANPR thực chưa nằm trong repository; `ANPR_URL` phải trỏ tới một dịch vụ riêng.
- QR là sandbox, chưa tích hợp cổng thanh toán thật.
- Chế độ chữa cháy tự động cục bộ mặc định tắt.
- Cần kiểm tra/hoàn thiện việc chuyển ô từ `RESERVED` về `FREE` sau khi phiên thanh toán kết thúc để chạy nhiều lượt liên tục.
- Mosquitto development đang cho phép kết nối đơn giản; triển khai thật phải bổ sung tài khoản, ACL và TLS.

## 17. Kiểm tra an toàn trước khi bật nguồn

1. Đo đúng cực và điện áp adapter 5 V.
2. Đo Buck B đúng 4,9–5,0 V trước khi nối tải.
3. Xác nhận Adapter +5 V không nối Buck B OUT+.
4. Xác nhận toàn bộ GND cần thiết đã nối chung.
5. Xác nhận RC522 chỉ nhận 3,3 V.
6. Xác nhận mọi GPIO ESP32 không nhận quá 3,3 V.
7. Mỗi LED có điện trở 220 Ω riêng.
8. Không thay dây khi đang cấp nguồn.
9. Thử relay không tải trước, sau đó mới nối bơm/còi.
10. Luôn có cách ngắt nguồn thủ công khi thử servo, relay và bơm.

## 18. Tài liệu liên quan

- Sơ đồ dây đầy đủ: [`so_do_mach.md`](./so_do_mach.md)
- Hướng dẫn firmware: [`firmware/README.md`](./firmware/README.md)
- Backend: [`smart-parking-backend/README.md`](./smart-parking-backend/README.md)
- Giao thức thiết bị: [`smart-parking-backend/docs/HARDWARE_PROTOCOL.md`](./smart-parking-backend/docs/HARDWARE_PROTOCOL.md)
- Postman: [`smart-parking-backend/postman/`](./smart-parking-backend/postman/)
- Frontend: [`smart-parking-frontend/README.md`](./smart-parking-frontend/README.md)
