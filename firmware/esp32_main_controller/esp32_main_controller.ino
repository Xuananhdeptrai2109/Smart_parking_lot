/*
 * SMART PARKING - ESP32 GATE + PARKING CONTROLLER
 *
 * ESP32 số 1 quản lý:
 * - 2 cảm biến xe, 2 servo barrier và 1 RC522.
 * - UART với Arduino Uno giữ 4 cảm biến + LED bãi đỗ.
 * - Phối hợp ESP32-CAM qua MQTT.
 * - Wi-Fi/MQTT kết nối backend.
 *
 * Phần PCCC đã chuyển sang ESP32 số 2 chạy esp32_fire_controller.ino.
 *
 * Board Arduino IDE: ESP32 Dev Module.
 * Libraries: PubSubClient, ArduinoJson, MFRC522, ESP32Servo.
 * Sửa WIFI_SSID, WIFI_PASSWORD và MQTT_HOST trước khi nạp.
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ESP32Servo.h>

// ==================== NETWORK ====================
const char *WIFI_SSID = "P05";
const char *WIFI_PASSWORD = "12345678@";
const char *MQTT_HOST = "192.168.55.170"; // IP LAN máy chạy Docker/backend
const uint16_t MQTT_PORT = 1883;
const char *MQTT_USERNAME = "";
const char *MQTT_PASSWORD = "";
const char *TOPIC_PREFIX = "smart-parking";

// ==================== PIN MAP ====================
// Gate sensors: digital input.
const uint8_t ENTRY_SENSOR_PIN = 21;
const uint8_t EXIT_SENSOR_PIN = 22;

// Gate servos.
const uint8_t ENTRY_SERVO_PIN = 25;
const uint8_t EXIT_SERVO_PIN = 26;

// RC522 VSPI: SS=5, SCK=18, MISO=19, MOSI=23. RST nối cố định 3V3.
const uint8_t RFID_SS_PIN = 5;
const uint8_t RFID_RST_UNUSED = 0xFF;

// UART2 tới Arduino Uno.
const uint8_t UNO_RX_PIN = 16;
const uint8_t UNO_TX_PIN = 17;

// ==================== SETTINGS ====================
const int GATE_CLOSED_ANGLE = 0;
const int GATE_OPEN_ANGLE = 90;
const unsigned long GATE_CLEAR_DELAY_MS = 1200;
const unsigned long ACCESS_TIMEOUT_MS = 30000;
const unsigned long ACCESS_RETRY_MS = 4000;
const unsigned long SENSOR_DEBOUNCE_MS = 250;

const unsigned long HEARTBEAT_INTERVAL_MS = 15000;

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
MFRC522 rfid(RFID_SS_PIN, RFID_RST_UNUSED);
Servo entryServo;
Servo exitServo;

uint32_t eventCounter = 0;
unsigned long lastHeartbeatAt = 0;
String unoLine;

// ==================== COMMON MQTT ====================
String topic(const String &suffix) {
  return String(TOPIC_PREFIX) + "/" + suffix;
}

String makeEventId(const String &kind) {
  uint64_t chipId = ESP.getEfuseMac();
  eventCounter++;
  return kind + "-" + String((uint32_t)(chipId & 0xFFFFFFFF), HEX) + "-" +
         String(millis()) + "-" + String(eventCounter);
}

void publishJson(const String &mqttTopic, JsonDocument &doc, bool retained = false) {
  char payload[2048];
  size_t length = serializeJson(doc, payload, sizeof(payload));
  if (!length) {
    Serial.println("[MQTT] JSON payload overflow");
    return;
  }
  mqtt.publish(mqttTopic.c_str(), (uint8_t *)payload, length, retained);
}

void publishCommandAck(const String &commandId, bool success, const String &reason = "") {
  if (!commandId.length()) return;
  StaticJsonDocument<384> doc;
  doc["commandId"] = commandId;
  doc["success"] = success;
  if (reason.length()) doc["failureReason"] = reason;
  publishJson(topic("events/command/ack"), doc);
}

void publishHeartbeat(const char *deviceCode, const char *type, const char *location) {
  StaticJsonDocument<384> doc;
  doc["eventId"] = makeEventId("heartbeat");
  doc["deviceCode"] = deviceCode;
  doc["type"] = type;
  doc["status"] = "ONLINE";
  doc["location"] = location;
  doc["ipAddress"] = WiFi.localIP().toString();
  publishJson(topic("events/device/heartbeat"), doc);
}

// ==================== ACCESS CONTROL ====================
struct PendingAccess {
  bool active = false;
  bool cameraReady = false;
  bool requestPublished = false;
  String direction;
  String eventId;
  String rfidUid;
  String imageUrl;
  String plate;
  unsigned long startedAt = 0;
  unsigned long lastPublishAt = 0;
};

PendingAccess pendingAccess;
bool previousEntryDetected = false;
bool previousExitDetected = false;
unsigned long lastEntryChangeAt = 0;
unsigned long lastExitChangeAt = 0;
bool entryGateOpen = false;
bool exitGateOpen = false;
unsigned long entryOpenedAt = 0;
unsigned long exitOpenedAt = 0;
String lastEntryPassageEvent;
String lastExitPassageEvent;

void resetPendingAccess() {
  pendingAccess = PendingAccess();
}

void publishGateState(const String &gateCode, const String &deviceCode,
                      const String &state, const String &passageEventId) {
  StaticJsonDocument<512> doc;
  doc["eventId"] = makeEventId("gate-state");
  doc["gateCode"] = gateCode;
  doc["deviceCode"] = deviceCode;
  doc["state"] = state;
  if (passageEventId.length()) doc["passageEventId"] = passageEventId;
  publishJson(topic("events/gate/state"), doc);
}

void closeGate(bool entry) {
  if (entry) {
    entryServo.write(GATE_CLOSED_ANGLE);
    entryGateOpen = false;
    publishGateState("ENTRY_GATE", "GATE_ENTRY_SERVO", "CLOSED", lastEntryPassageEvent);
    lastEntryPassageEvent = "";
  } else {
    exitServo.write(GATE_CLOSED_ANGLE);
    exitGateOpen = false;
    publishGateState("EXIT_GATE", "GATE_EXIT_SERVO", "CLOSED", lastExitPassageEvent);
    lastExitPassageEvent = "";
  }
}

void openGate(bool entry) {
  if (entry) {
    entryServo.write(GATE_OPEN_ANGLE);
    entryGateOpen = true;
    entryOpenedAt = millis();
    publishGateState("ENTRY_GATE", "GATE_ENTRY_SERVO", "OPEN", lastEntryPassageEvent);
  } else {
    exitServo.write(GATE_OPEN_ANGLE);
    exitGateOpen = true;
    exitOpenedAt = millis();
    publishGateState("EXIT_GATE", "GATE_EXIT_SERVO", "OPEN", lastExitPassageEvent);
  }
}

void requestCameraCapture() {
  StaticJsonDocument<384> doc;
  doc["eventId"] = pendingAccess.eventId;
  doc["direction"] = pendingAccess.direction;
  publishJson(topic("local/camera/capture"), doc);
}

void beginAccess(const String &direction) {
  if (pendingAccess.active) return;
  pendingAccess.active = true;
  pendingAccess.direction = direction;
  pendingAccess.eventId = makeEventId(direction == "ENTRY" ? "entry" : "exit");
  pendingAccess.startedAt = millis();
  requestCameraCapture();
  Serial.printf("[ACCESS] %s event=%s\n", direction.c_str(), pendingAccess.eventId.c_str());
}

String readRfidUid() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return "";
  String uid;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  return uid;
}

void publishAccessRequest() {
  if (!pendingAccess.active || !pendingAccess.cameraReady || !pendingAccess.rfidUid.length()) return;

  StaticJsonDocument<1024> doc;
  doc["eventId"] = pendingAccess.eventId;
  doc["rfidUid"] = pendingAccess.rfidUid;
  doc["imageUrl"] = pendingAccess.imageUrl;
  doc["cameraDeviceCode"] = "CAMERA_MAIN";

  if (pendingAccess.direction == "ENTRY") {
    doc["vehicleType"] = "CAR";
    doc["rightPlate"] = pendingAccess.plate;
    lastEntryPassageEvent = pendingAccess.eventId;
    publishJson(topic("events/gate/entry/request"), doc);
  } else {
    doc["leftPlate"] = pendingAccess.plate;
    lastExitPassageEvent = pendingAccess.eventId;
    publishJson(topic("events/gate/exit/request"), doc);
  }
  pendingAccess.requestPublished = true;
  pendingAccess.lastPublishAt = millis();
}

void handleCameraResult(JsonDocument &doc) {
  if (!pendingAccess.active) return;
  String eventId = doc["eventId"] | "";
  if (eventId != pendingAccess.eventId) return;

  pendingAccess.imageUrl = String((const char *)(doc["imageUrl"] | ""));
  pendingAccess.plate = pendingAccess.direction == "ENTRY"
    ? String((const char *)(doc["rightPlate"] | ""))
    : String((const char *)(doc["leftPlate"] | ""));
  pendingAccess.plate.trim();
  pendingAccess.plate.toUpperCase();
  pendingAccess.cameraReady = pendingAccess.imageUrl.length() && pendingAccess.plate.length();
}

void handleGateCommand(const String &incomingTopic, JsonDocument &doc) {
  String commandId = doc["commandId"] | "";
  String action = doc["action"] | "";
  bool entry = incomingTopic.endsWith("GATE_ENTRY_SERVO");

  if (action == "OPEN") {
    openGate(entry);
    publishCommandAck(commandId, true);
  } else if (action == "CLOSE") {
    closeGate(entry);
    publishCommandAck(commandId, true);
  } else {
    publishCommandAck(commandId, false, "Unsupported gate action");
  }

  if (pendingAccess.active && ((entry && pendingAccess.direction == "ENTRY") ||
                               (!entry && pendingAccess.direction == "EXIT"))) {
    resetPendingAccess();
  }
}

void handleGateSensors() {
  bool entryDetected = digitalRead(ENTRY_SENSOR_PIN) == LOW;
  bool exitDetected = digitalRead(EXIT_SENSOR_PIN) == LOW;
  unsigned long now = millis();

  if (entryDetected != previousEntryDetected && now - lastEntryChangeAt > SENSOR_DEBOUNCE_MS) {
    previousEntryDetected = entryDetected;
    lastEntryChangeAt = now;
    if (entryDetected) beginAccess("ENTRY");
  }
  if (exitDetected != previousExitDetected && now - lastExitChangeAt > SENSOR_DEBOUNCE_MS) {
    previousExitDetected = exitDetected;
    lastExitChangeAt = now;
    if (exitDetected) beginAccess("EXIT");
  }

  // Không đóng barrier khi cảm biến vẫn thấy xe.
  if (entryGateOpen && !entryDetected && now - entryOpenedAt > GATE_CLEAR_DELAY_MS) closeGate(true);
  if (exitGateOpen && !exitDetected && now - exitOpenedAt > GATE_CLEAR_DELAY_MS) closeGate(false);
}

void handlePendingAccess() {
  if (!pendingAccess.active) return;

  String uid = readRfidUid();
  if (uid.length()) {
    pendingAccess.rfidUid = uid;
    Serial.printf("[RFID] %s\n", uid.c_str());
  }

  if (millis() - pendingAccess.startedAt > ACCESS_TIMEOUT_MS) {
    resetPendingAccess();
    return;
  }

  if (pendingAccess.cameraReady && pendingAccess.rfidUid.length() &&
      (!pendingAccess.requestPublished || millis() - pendingAccess.lastPublishAt > ACCESS_RETRY_MS)) {
    publishAccessRequest();
  }
}

// ==================== ARDUINO PARKING BRIDGE ====================
void publishSpotLine(const String &line) {
  int first = line.indexOf(',');
  int second = line.indexOf(',', first + 1);
  if (!line.startsWith("SPOT,") || first < 0 || second < 0) return;

  String spotName = line.substring(first + 1, second);
  String occupied = line.substring(second + 1);
  spotName.trim();
  occupied.trim();

  StaticJsonDocument<384> doc;
  doc["eventId"] = makeEventId("spot-" + spotName);
  doc["spotName"] = spotName;
  doc["occupied"] = occupied == "1";
  publishJson(topic("events/parking/spot/state"), doc);
}

void handleUnoSerial() {
  while (Serial2.available()) {
    char c = (char)Serial2.read();
    if (c == '\n') {
      unoLine.trim();
      if (unoLine.length()) publishSpotLine(unoLine);
      unoLine = "";
    } else if (c != '\r' && unoLine.length() < 100) {
      unoLine += c;
    }
  }
}

void handleLedCommand(JsonDocument &doc) {
  String spotName = doc["spotName"] | "";
  String color = doc["color"] | "";
  String commandId = doc["commandId"] | "";
  if (!spotName.length() || !color.length()) {
    publishCommandAck(commandId, false, "Invalid LED command");
    return;
  }
  Serial2.println("LED," + spotName + "," + color);
  publishCommandAck(commandId, true);
}

// ==================== MQTT CALLBACK ====================
void mqttCallback(char *rawTopic, byte *payload, unsigned int length) {
  if (length >= 2048) return;
  char json[2048];
  memcpy(json, payload, length);
  json[length] = '\0';

  StaticJsonDocument<2048> doc;
  if (deserializeJson(doc, json)) return;

  String incomingTopic(rawTopic);
  if (incomingTopic == topic("local/camera/result")) {
    handleCameraResult(doc);
  } else if (incomingTopic.startsWith(topic("commands/gate/"))) {
    handleGateCommand(incomingTopic, doc);
  } else if (incomingTopic.startsWith(topic("commands/led/"))) {
    handleLedCommand(doc);
  }
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
}

void connectMqtt() {
  while (!mqtt.connected()) {
    String clientId = "esp32-gate-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    bool connected = strlen(MQTT_USERNAME)
      ? mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)
      : mqtt.connect(clientId.c_str());

    if (connected) {
      mqtt.subscribe(topic("local/camera/result").c_str(), 1);
      mqtt.subscribe(topic("commands/gate/+").c_str(), 1);
      mqtt.subscribe(topic("commands/led/+").c_str(), 1);
      Serial.println("[MQTT] Connected");
    } else {
      Serial.printf("[MQTT] Failed state=%d\n", mqtt.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println("=== ESP32 GATE + PARKING CONTROLLER ===");
  Serial2.begin(9600, SERIAL_8N1, UNO_RX_PIN, UNO_TX_PIN);

  pinMode(ENTRY_SENSOR_PIN, INPUT_PULLUP);
  pinMode(EXIT_SENSOR_PIN, INPUT_PULLUP);

  entryServo.setPeriodHertz(50);
  exitServo.setPeriodHertz(50);
  entryServo.attach(ENTRY_SERVO_PIN, 500, 2400);
  exitServo.attach(EXIT_SERVO_PIN, 500, 2400);
  entryServo.write(GATE_CLOSED_ANGLE);
  exitServo.write(GATE_CLOSED_ANGLE);

  SPI.begin(18, 19, 23, RFID_SS_PIN);
  rfid.PCD_Init();
  delay(100);
  rfid.PCD_DumpVersionToSerial();

  connectWifi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(2048);
  connectMqtt();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  handleGateSensors();
  handlePendingAccess();
  handleUnoSerial();

  unsigned long now = millis();
  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    publishHeartbeat("GATE_ENTRY_SERVO", "BARRIER_SERVO", "ENTRY_GATE");
    publishHeartbeat("GATE_EXIT_SERVO", "BARRIER_SERVO", "EXIT_GATE");
    publishHeartbeat("RFID_ENTRY", "RFID_READER", "SHARED_GATE_STATION");
  }

  delay(5);
}
