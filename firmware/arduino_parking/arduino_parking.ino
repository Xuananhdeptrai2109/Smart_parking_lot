/*
 * SMART PARKING - ARDUINO UNO PARKING I/O EXPANDER
 *
 * Chức năng:
 * - Đọc 4 cảm biến vật cản digital cho A1..A4.
 * - Điều khiển 4 cặp LED rời: mỗi vị trí có 1 LED đỏ và 1 LED xanh.
 * - Gửi trạng thái sang ESP32 Gateway bằng SoftwareSerial.
 * - Nhận lệnh LED từ ESP32 Gateway.
 *
 * Giao thức UART 9600 baud:
 *   Arduino -> ESP32: SPOT,A1,1\n  (1=có xe, 0=trống)
 *   ESP32 -> Arduino: LED,A1,RED\n hoặc LED,A1,GREEN\n
 *
 * Chú ý: TX 5V của Arduino phải qua bộ chia áp trước khi vào RX 3.3V của ESP32.
 */

#include <SoftwareSerial.h>

const uint8_t SPOT_COUNT = 4;
const char *SPOT_NAMES[SPOT_COUNT] = {"A1", "A2", "A3", "A4"};

// Module cảm biến vật cản digital, OUT active LOW.
const uint8_t SENSOR_PINS[SPOT_COUNT] = {2, 3, 4, 5};

// 8 LED rời: mỗi LED đỏ/xanh có điện trở 220-330 ohm riêng, cathode nối GND.
const uint8_t RED_PINS[SPOT_COUNT] = {7, 8, 9, 10};
const uint8_t GREEN_PINS[SPOT_COUNT] = {12, 13, A0, A1};

// Arduino RX=A3 nhận từ ESP32 TX17; Arduino TX=A4 gửi qua chia áp tới ESP32 RX16.
SoftwareSerial espLink(A3, A4); // RX, TX

const unsigned long DEBOUNCE_MS = 250;
bool rawState[SPOT_COUNT];
bool stableState[SPOT_COUNT];
unsigned long lastRawChangeAt[SPOT_COUNT];
String inputLine;

int findSpotIndex(const String &spotName) {
  for (uint8_t i = 0; i < SPOT_COUNT; i++) {
    if (spotName == SPOT_NAMES[i]) return i;
  }
  return -1;
}

void setSpotLed(uint8_t index, const String &color) {
  if (index >= SPOT_COUNT) return;

  if (color == "RED") {
    digitalWrite(RED_PINS[index], HIGH);
    digitalWrite(GREEN_PINS[index], LOW);
  } else if (color == "GREEN") {
    digitalWrite(RED_PINS[index], LOW);
    digitalWrite(GREEN_PINS[index], HIGH);
  } else {
    digitalWrite(RED_PINS[index], LOW);
    digitalWrite(GREEN_PINS[index], LOW);
  }
}

void sendSpotState(uint8_t index) {
  String line = "SPOT," + String(SPOT_NAMES[index]) + "," +
                String(stableState[index] ? 1 : 0);
  espLink.println(line);
  Serial.println("[TX] " + line);

  // LED phản ánh cảm biến ngay cả khi ESP32/backend mất kết nối.
  setSpotLed(index, stableState[index] ? "RED" : "GREEN");
}

void handleEspCommand(const String &line) {
  if (!line.startsWith("LED,")) return;

  int firstComma = line.indexOf(',');
  int secondComma = line.indexOf(',', firstComma + 1);
  if (firstComma < 0 || secondComma < 0) return;

  String spotName = line.substring(firstComma + 1, secondComma);
  String color = line.substring(secondComma + 1);
  spotName.trim();
  color.trim();
  color.toUpperCase();

  int index = findSpotIndex(spotName);
  if (index >= 0) {
    setSpotLed((uint8_t)index, color);
    Serial.println("[RX] " + line);
  }
}

void readEspSerial() {
  while (espLink.available()) {
    char c = (char)espLink.read();
    if (c == '\n') {
      inputLine.trim();
      if (inputLine.length()) handleEspCommand(inputLine);
      inputLine = "";
    } else if (c != '\r' && inputLine.length() < 80) {
      inputLine += c;
    }
  }
}

void scanSensors() {
  unsigned long now = millis();

  for (uint8_t i = 0; i < SPOT_COUNT; i++) {
    bool detected = digitalRead(SENSOR_PINS[i]) == LOW;

    if (detected != rawState[i]) {
      rawState[i] = detected;
      lastRawChangeAt[i] = now;
    }

    if (rawState[i] != stableState[i] && now - lastRawChangeAt[i] >= DEBOUNCE_MS) {
      stableState[i] = rawState[i];
      sendSpotState(i);
    }
  }
}

void setup() {
  Serial.begin(115200);
  espLink.begin(9600);

  for (uint8_t i = 0; i < SPOT_COUNT; i++) {
    pinMode(SENSOR_PINS[i], INPUT_PULLUP);
    pinMode(RED_PINS[i], OUTPUT);
    pinMode(GREEN_PINS[i], OUTPUT);

    rawState[i] = digitalRead(SENSOR_PINS[i]) == LOW;
    stableState[i] = rawState[i];
    lastRawChangeAt[i] = millis();
    setSpotLed(i, stableState[i] ? "RED" : "GREEN");
  }

  delay(1000);
  for (uint8_t i = 0; i < SPOT_COUNT; i++) sendSpotState(i);
}

void loop() {
  scanSensors();
  readEspSerial();
  delay(10);
}
