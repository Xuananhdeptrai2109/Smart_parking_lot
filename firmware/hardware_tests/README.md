# Kịch bản test phần cứng cổng và bãi đỗ

Hai sketch trong thư mục này chạy độc lập, không cần Wi-Fi, Docker, MQTT, backend, database hoặc ESP32-CAM.

| Mạch | Sketch test | Board Arduino IDE | Serial Monitor |
|---|---|---|---|
| ESP32 số 1 (GATE) | `esp32_gate_test/esp32_gate_test.ino` | `ESP32 Dev Module` | 115200 baud |
| Arduino Uno | `arduino_parking_test/arduino_parking_test.ino` | `Arduino Uno` | 9600 baud |

ESP32 số 2 (FIRE), relay, bơm, còi và ESP32-CAM phải tắt trong đợt test này.

## 1. Kiểm tra nguồn trước khi nạp

1. Ngắt toàn bộ nguồn trước khi kiểm tra dây.
2. Đo Buck B được `4,9–5,0 V` trước khi nối servo.
3. Servo lấy nguồn từ Buck B, không lấy nguồn từ ESP32.
4. RC522 lấy `3V3` từ ESP32, không lấy 5 V.
5. Adapter GND, Buck B OUT-, ESP32 GND và Arduino GND phải nối chung.
6. Khi dùng USB để nạp và xem Serial, không đồng thời đưa adapter +5 V vào chân VIN/5V của cùng board. Adapter vẫn có thể cấp riêng cho LM393 nếu chỉ nối chung GND.

## 2. Test ESP32 Gate

### A. Test servo không cần cảm biến

1. Nạp `esp32_gate_test.ino`, bật nguồn Buck B cho hai servo và mở Serial Monitor `115200 baud`.
2. Gửi `E`: servo cửa vào mở 90°, giữ khoảng 2 giây rồi đóng 0°.
3. Gửi `X`: servo cửa ra mở 90°, giữ khoảng 2 giây rồi đóng 0°.
4. Gửi `C`: cả hai servo đóng ngay. Gửi `S`: in trạng thái.

Serial báo đúng nhưng servo không quay: kiểm tra nguồn Buck B, GND chung và dây signal. Servo rung hoặc ESP32 reset: nguồn servo yếu hoặc GND chưa tốt.

### B. Test hai cảm biến cổng

1. Đưa vật vào cảm biến cửa vào: Serial in `[ENTRY SENSOR] DETECTED`, servo cửa vào mở.
2. Bỏ vật ra: Serial in `CLEAR`, sau khoảng 1,5 giây servo đóng.
3. Lặp lại với cảm biến cửa ra; chỉ servo cửa ra được phép quay.
4. Thử mỗi cảm biến ít nhất 10 lần.

Trạng thái bị đảo: chỉnh biến trở LM393 và xác nhận module active LOW. Trạng thái nhảy liên tục: kiểm tra bộ chia áp và GND.

### C. Test RC522

1. Khi khởi động, phiên bản RFID phải khác `0x00` và `0xFF`.
2. Đặt thẻ sát đầu đọc trong 1–2 giây; Serial phải in dạng `[RFID] UID=A9FB4420`.
3. Thử 5 lần; UID phải giống nhau.

Sketch test chỉ in UID, không yêu cầu cảm biến và không mở servo khi quét thẻ.

### D. Test phối hợp cổng

1. Kích cảm biến vào: chỉ cửa vào mở.
2. Trong lúc cửa mở, quét thẻ: Serial vẫn đọc đúng UID.
3. Bỏ xe: cửa đóng sau 1,5 giây.
4. Lặp lại với cổng ra. Thực hiện mỗi chiều ít nhất 10 lần; không mở nhầm cửa hoặc reset ESP32.

## 3. Test Arduino bãi đỗ

### A. Test tám LED

1. Nạp `arduino_parking_test.ino`, mở Serial Monitor `9600 baud`.
2. Khi khởi động, cả bốn LED đỏ sáng khoảng 0,8 giây; sau đó cả bốn LED xanh sáng khoảng 0,8 giây.
3. Gửi `T` để chạy lại bài test.

LED không sáng: kiểm tra đúng cực, điện trở 220R riêng cho từng LED và GND chung.

### B. Test từng vị trí

Với từng vị trí A1 đến A4:

1. Không có xe: LED xanh sáng, LED đỏ tắt, Serial báo `FREE`.
2. Đưa vật vào cảm biến: LED đỏ sáng, LED xanh tắt, Serial báo `OCCUPIED`.
3. Bỏ vật ra: trở lại `FREE`.
4. Các vị trí khác không được đổi trạng thái.

Ánh xạ cảm biến: A1=D2, A2=D3, A3=D4, A4=D5.

### C. Test nhiều chỗ và đầy bãi

1. Kích A1 và A3: chỉ A1/A3 đỏ, A2/A4 xanh, Serial báo `free=2`.
2. Kích cả bốn: cả bốn LED đỏ, Serial báo `free=0`.
3. Bỏ từng vật: số chỗ trống tăng đúng từ 1 đến 4.
4. Chạy liên tục ít nhất 5 phút; LED không nhấp nháy sai và Arduino không reset.

## 4. Điều kiện đạt

- Hai servo quay đúng cửa, đúng 0°/90° và không làm ESP32 reset.
- Hai cảm biến cổng ổn định ít nhất 10 lần mỗi bên.
- RC522 đọc cùng một UID ít nhất 5 lần.
- Cả tám LED sáng đúng màu trong bài self-test.
- Bốn cảm biến chỗ đỗ điều khiển đúng cặp LED.
- `free=0..4` chính xác và hệ thống chạy ổn định 5 phút.

Sau khi đạt tất cả mục, nạp lại firmware chính trong `firmware/esp32_main_controller` và `firmware/arduino_parking` để kiểm tra MQTT/backend.
