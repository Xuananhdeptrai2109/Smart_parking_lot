# SƠ ĐỒ CẮM DÂY SMART PARKING

Hệ thống dùng **2 ESP32 thường, 1 ESP32-CAM và 1 Arduino Uno**:

| Bo mạch | Chức năng | File nạp |
|---|---|---|
| **ESP32 thường số 1 — GATE** | Cổng vào/ra, RC522, giao tiếp Arduino | `firmware/esp32_main_controller/esp32_main_controller.ino` |
| **ESP32 thường số 2 — FIRE** | Cảm biến lửa/gas, servo vòi phun, relay bơm/còi | `firmware/esp32_fire_controller/esp32_fire_controller.ino` |
| **ESP32-CAM** | Chụp ảnh biển số | `firmware/esp32_cam/esp32_cam.ino` |
| **Arduino Uno** | 4 vị trí đỗ, 8 LED đỏ/xanh | `firmware/arduino_parking/arduino_parking.ino` |

> GPIO trùng số trên hai ESP32 là hai chân hoàn toàn khác nhau. Ví dụ GPIO25 của ESP32 số 1 (GATE) điều khiển servo cửa, còn GPIO25 của ESP32 số 2 (FIRE) điều khiển servo vòi ngang.

## 1. Nguồn điện

### Adapter 5 V–2 A: cấp phần logic

```text
Adapter (+5 V)
├── ESP32 số 1 (GATE) chân VIN/5V
├── ESP32 số 2 (FIRE) chân VIN/5V
├── Arduino Uno chân 5V
├── VCC hai cảm biến LM393 tại cổng
├── VCC cảm biến gas
├── Relay DC+
└── Relay COM2 (nguồn cho còi)

Adapter (-/GND)
├── ESP32 số 1 (GATE) GND
├── ESP32 số 2 (FIRE) GND
├── Arduino Uno GND
├── GND hai cảm biến LM393 tại cổng
├── GND cảm biến gas
├── Relay DC-
├── Còi (-)
└── nối một điểm với Buck B OUT-
```

Nếu ESP32 reset hoặc relay chập chờn khi chạy đồng thời, đổi adapter logic sang loại 5 V–3 A tốt hơn.

### Hai pin 3,7 V nối tiếp và Buck B: cấp tải

```text
Pin 2S/BMS (+) ── Buck B IN+
Pin 2S/BMS (-) ── Buck B IN-

Buck B OUT+ đã chỉnh đúng 5,0 V
├── dây đỏ của 4 servo
└── Relay COM1 (nguồn bơm)

Buck B OUT-
├── dây nâu/đen của 4 servo
├── Bơm (-)
└── nối một điểm với Adapter GND
```

Quy tắc bắt buộc:

- Chỉnh Buck B xuống `4,9–5,0 V` bằng đồng hồ trước khi cắm servo và bơm.
- Chỉ nối chung đường âm/GND; **không nối Adapter +5 V với Buck B OUT+**.
- Không cấp servo hoặc bơm từ chân `5V/3V3` của ESP32.
- Điện trở `220R` là điện trở cho LED, không phải cầu chì.
- ESP32-CAM dùng nguồn USB riêng trên đế nạp.

## 2. ESP32 thường số 1 — GATE

ESP32 này chỉ quản lý cổng, RFID và Arduino. **Không nối thiết bị PCCC vào ESP32 số 1 (GATE).**

### Hai cảm biến xe LM393 tại cổng

| Cảm biến | Chân module | Nối với |
|---|---|---|
| Cảm biến vào | VCC | Adapter +5 V |
| Cảm biến vào | GND | Adapter GND |
| Cảm biến vào | OUT | Qua chia áp tới ESP32 số 1 (GATE) GPIO21 |
| Cảm biến ra | VCC | Adapter +5 V |
| Cảm biến ra | GND | Adapter GND |
| Cảm biến ra | OUT | Qua chia áp tới ESP32 số 1 (GATE) GPIO22 |

Mỗi chân OUT dùng một bộ chia áp riêng:

```text
LM393 OUT ── 10 kΩ ── 10 kΩ ──●── GPIO21 hoặc GPIO22
                                │
                              10 kΩ
                                │
                              10 kΩ
                                │
                              10 kΩ
                                │
                     Adapter GND/ESP32 GND
```

Mỗi cảm biến cổng dùng 5 điện trở `10 kΩ`: hai con từ OUT tới điểm `●`, ba con từ điểm `●` xuống GND.

Không nối chung hai chân OUT.

### Hai servo thanh chắn

| Servo | Dây servo | Nối với |
|---|---|---|
| Cửa vào | Đỏ — V+ | Buck B OUT+ 5 V |
| Cửa vào | Nâu/đen — GND | Buck B OUT- |
| Cửa vào | Vàng/cam/trắng — Signal | ESP32 số 1 (GATE) GPIO25 |
| Cửa ra | Đỏ — V+ | Buck B OUT+ 5 V |
| Cửa ra | Nâu/đen — GND | Buck B OUT- |
| Cửa ra | Vàng/cam/trắng — Signal | ESP32 số 1 (GATE) GPIO26 |

### Module RFID RC522

| RC522 | ESP32 số 1 (GATE) |
|---|---|
| 3.3V | 3V3 |
| GND | GND |
| SDA/SS | GPIO5 |
| SCK | GPIO18 |
| MOSI | GPIO23 |
| MISO | GPIO19 |
| RST | 3V3 |
| IRQ | Không nối |

RC522 chỉ dùng 3,3 V, không nối vào 5 V.

### UART giữa ESP32 số 1 (GATE) và Arduino

```text
ESP32 số 1 (GATE) GPIO17/TX2 ───────────── Arduino A3/RX

Arduino A4/TX ── 10 kΩ ── 10 kΩ ──●── ESP32 số 1 (GATE) GPIO16/RX2
                                    │
                                  10 kΩ
                                    │
                                  10 kΩ
                                    │
                                  10 kΩ
                                    │
                       Arduino/ESP32 GND

ESP32 số 1 (GATE) GND ─────────────────── Arduino GND
```

Không dùng chân RX0/TX0 của Arduino cho đường này. Firmware dùng `A3/A4` làm SoftwareSerial.

## 3. Arduino Uno — bốn vị trí đỗ

### Cảm biến vị trí

| Vị trí | VCC | GND | OUT |
|---|---|---|---|
| A1 | Arduino 5V | Arduino GND | D2 |
| A2 | Arduino 5V | Arduino GND | D3 |
| A3 | Arduino 5V | Arduino GND | D4 |
| A4 | Arduino 5V | Arduino GND | D5 |

### LED đỏ và xanh

Mỗi LED rời phải có **một điện trở 220–330 Ω riêng**:

```text
Chân Arduino ── điện trở 220–330 Ω ── chân dài LED (+)
                                           chân ngắn LED (-) ── GND
```

| Vị trí | LED đỏ | LED xanh |
|---|---|---|
| A1 | D7 | D12 |
| A2 | D8 | D13 |
| A3 | D9 | A0 |
| A4 | D10 | A1 |

Không nối LED trực tiếp vào `5V`, `3V3` hoặc chân tín hiệu khi chưa có điện trở hạn dòng.

## 4. ESP32 thường số 2 — FIRE

ESP32 này chỉ quản lý hệ thống PCCC.

### Bốn cảm biến lửa

Nên cấp module lửa bằng 3,3 V:

| Vị trí | VCC | GND | AO | DO |
|---|---|---|---|---|
| NW — trên trái | ESP32 số 2 (FIRE) 3V3 | ESP32 số 2 (FIRE) GND | GPIO34 | Không nối |
| NE — trên phải | ESP32 số 2 (FIRE) 3V3 | ESP32 số 2 (FIRE) GND | GPIO35 | Không nối |
| SW — dưới trái | ESP32 số 2 (FIRE) 3V3 | ESP32 số 2 (FIRE) GND | GPIO36/VP | Không nối |
| SE — dưới phải | ESP32 số 2 (FIRE) 3V3 | ESP32 số 2 (FIRE) GND | GPIO39/VN | Không nối |

Nếu module lửa bắt buộc dùng 5 V, mỗi AO phải qua bộ chia áp riêng giống sau và cần mua thêm điện trở:

```text
AO ── 10 kΩ ── 10 kΩ ──●── GPIO34/35/36/39
                         │
                       10 kΩ
                         │
                       10 kΩ
                         │
                       10 kΩ
                         │
                        GND
```

### Cảm biến khí gas

| Chân module gas | Nối với |
|---|---|
| VCC | Adapter +5 V |
| GND | Adapter GND |
| AO | Qua chia áp tới ESP32 số 2 (FIRE) GPIO32 |
| DO | Không nối |

```text
Gas AO ── 10 kΩ ── 10 kΩ ──●── ESP32 số 2 (FIRE) GPIO32
                             │
                           10 kΩ
                             │
                           10 kΩ
                             │
                           10 kΩ
                             │
                  Adapter GND/ESP32 GND
```

Với cấu hình cảm biến lửa dùng `3V3`, tổng cộng cần đúng 20 điện trở `10 kΩ`: 10 con cho hai LM393 cổng, 5 con cho UART và 5 con cho gas.

### Hai servo hướng vòi phun

| Servo | Dây servo | Nối với |
|---|---|---|
| Ngang/pan | Đỏ — V+ | Buck B OUT+ 5 V |
| Ngang/pan | Nâu/đen — GND | Buck B OUT- |
| Ngang/pan | Vàng/cam/trắng — Signal | ESP32 số 2 (FIRE) GPIO25 |
| Dọc/tilt | Đỏ — V+ | Buck B OUT+ 5 V |
| Dọc/tilt | Nâu/đen — GND | Buck B OUT- |
| Dọc/tilt | Vàng/cam/trắng — Signal | ESP32 số 2 (FIRE) GPIO26 |

### Relay hai kênh

#### Chân điều khiển relay

| Relay | Nối với |
|---|---|
| DC+ | Adapter +5 V |
| DC- | Adapter GND và ESP32 số 2 (FIRE) GND |
| IN1 | ESP32 số 2 (FIRE) GPIO14 — bơm |
| IN2 | ESP32 số 2 (FIRE) GPIO27 — còi |

#### Kênh 1: bơm

```text
Buck B OUT+ ── cầu chì phù hợp ── COM1
NO1 ───────────────────────────── Bơm (+)
Bơm (-) ───────────────────────── Buck B OUT-
NC1 ───────────────────────────── Không nối
```

#### Kênh 2: còi TMB12A05 5 V hai chân

```text
Adapter +5 V ── COM2
NO2 ─────────── Còi (+)
Còi (-) ─────── Adapter GND
NC2 ─────────── Không nối
```

Firmware hiện dùng relay kích mức LOW. Lần thử đầu chưa nối bơm/còi vào COM/NO; kiểm tra relay đóng/ngắt đúng trước.

### Nút dừng khẩn cấp

Sử dụng nút thường hở:

```text
ESP32 số 2 (FIRE) GPIO13 ── nút STOP ── ESP32 số 2 (FIRE) GND
```

Không cần điện trở ngoài vì firmware dùng `INPUT_PULLUP`.

## 5. ESP32-CAM

- Cắm ESP32-CAM đầy đủ vào đế nạp USB.
- Chọn board Arduino IDE: `AI Thinker ESP32-CAM`.
- Cấp nguồn bằng cổng USB của đế, nên dùng nguồn USB 5 V ổn định từ 1 A.
- Không nối thêm nguồn vào chân 5V của ESP32-CAM khi đang cấp USB.
- ESP32-CAM truyền dữ liệu qua Wi-Fi/MQTT nên không cần dây tín hiệu sang hai ESP32 thường.

## 6. Kiểm tra trước khi bật nguồn

1. Ngắt adapter, pin và USB khi đang cắm hoặc chuyển dây.
2. Đo adapter đúng khoảng 5,0 V và đúng cực `+/-`.
3. Đo Buck B đúng `4,9–5,0 V` trước khi nối servo/bơm.
4. Xác nhận Adapter +5 V không nối với Buck B OUT+.
5. Xác nhận Adapter GND, Buck B OUT-, ESP32 số 1 (GATE) GND, ESP32 số 2 (FIRE) GND và Arduino GND đã chung nhau.
6. RC522 phải nhận 3,3 V.
7. Điện áp tại mọi GPIO ESP32 không được vượt 3,3 V.
8. ESP32 số 1 (GATE) chỉ nối thiết bị cổng/RFID/Arduino; ESP32 số 2 (FIRE) chỉ nối thiết bị PCCC.
9. Thử cảm biến và servo trước; thử relay không tải trước; cuối cùng mới nối bơm và còi.
