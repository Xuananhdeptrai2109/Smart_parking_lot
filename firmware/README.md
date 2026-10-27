# Firmware cho cấu hình hai ESP32 thường

Hệ thống active hiện có bốn chương trình, tương ứng bốn bo mạch:

| Bo mạch | File cần nạp | Chức năng |
|---|---|---|
| ESP32 thường số 1 | `esp32_main_controller/esp32_main_controller.ino` | Cổng vào/ra, RC522, hai servo barrier, cầu UART với Arduino và phối hợp ESP32-CAM |
| ESP32 thường số 2 | `esp32_fire_controller/esp32_fire_controller.ino` | Bốn cảm biến lửa, cảm biến gas, hai servo vòi phun, relay còi/bơm và nút dừng khẩn cấp |
| AI Thinker ESP32-CAM | `esp32_cam/esp32_cam.ino` | Chụp ảnh và gửi kết quả biển số qua MQTT |
| Arduino Uno | `arduino_parking/arduino_parking.ino` | Bốn cảm biến vị trí cùng bốn cặp LED đỏ/xanh |

## Trước khi nạp

Kiểm tra `WIFI_SSID`, `WIFI_PASSWORD` và `MQTT_HOST` trong cả ba file ESP32. Hai ESP32 thường dùng MQTT client ID khác nhau theo chip nên có thể kết nối đồng thời.

Board trong Arduino IDE:

- Hai ESP32 thường: `ESP32 Dev Module`.
- Camera: `AI Thinker ESP32-CAM`.
- Arduino: `Arduino Uno`.

Thư viện cần cài:

- `PubSubClient`
- `ArduinoJson`
- `ESP32Servo`
- `MFRC522` cho ESP32 cổng

## Trình tự test an toàn

1. Nạp ESP32 cổng và xác nhận Serial có Wi-Fi, MQTT và phiên bản RC522 hợp lệ.
2. Nạp Arduino, kiểm tra A1-A4 cùng LED trước khi nối UART.
3. Nạp ESP32-CAM, test MQTT bằng `USE_MOCK_ANPR=true` nếu chưa có dịch vụ ANPR.
4. Nạp ESP32 PCCC khi chưa nối bơm/còi vào tiếp điểm relay; kiểm tra sensor và servo trước.
5. Test relay bằng LED tải ngoài.
6. Chỉ nối bơm/còi sau khi relay OFF đúng lúc khởi động và nút dừng khẩn cấp hoạt động.
7. Chỉ đổi `ENABLE_LOCAL_AUTONOMOUS_MODE=true` sau khi hoàn thành toàn bộ kiểm thử cơ khí và nguồn.

Sơ đồ dây chi tiết nằm trong `../so_do_mach.md`.

## Test phần cứng không cần backend

Trước khi chạy firmware chính, dùng hai sketch trong `hardware_tests/`:

| Phần cần test | Sketch |
|---|---|
| Hai cảm biến cổng, hai servo và RC522 | `hardware_tests/esp32_gate_test/esp32_gate_test.ino` |
| Bốn cảm biến chỗ đỗ và tám LED | `hardware_tests/arduino_parking_test/arduino_parking_test.ino` |

Hai sketch này không dùng Wi-Fi, MQTT, Docker hoặc database. Kịch bản và kết quả mong đợi nằm trong `hardware_tests/README.md`. Sau khi kiểm tra đạt, nạp lại firmware chính cho từng board.
