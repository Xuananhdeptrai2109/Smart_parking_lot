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
 * Board Arduino IDE: DOIT ESP32 DEVKIT V1.
 * Libraries: PubSubClient, ArduinoJson, MFRC522, ESP32Servo.
 * Sửa WIFI_SSID, WIFI_PASSWORD và MQTT_HOST trước khi nạp.
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ESP32Servo.h>
#include "mqtt_credentials.h"
#include "wifi_credentials.h"

// ==================== NETWORK ====================
const uint16_t MQTT_PORT = 1883;
const char *TOPIC_PREFIX = "smart-parking";

// ==================== PIN MAP ====================
// Gate sensors: digital input.
const uint8_t ENTRY_SENSOR_PIN = 21;
const uint8_t EXIT_SENSOR_PIN = 22;

// Gate servos.
// GPIO27 thay cho GPIO25 de tranh chan tin hieu dang co dau hieu bat on.
const uint8_t ENTRY_SERVO_PIN = 27;
const uint8_t EXIT_SERVO_PIN = 26;

// RC522 VSPI: SS=5, SCK=18, MISO=19, MOSI=23. RST nối cố định 3V3.
const uint8_t RFID_SS_PIN = 5;
const uint8_t RFID_RST_UNUSED = 0xFF;

// UART2 tới Arduino Uno. GPIO32 thay GPIO16 vì đường RX cũ không nhận dữ liệu.
const uint8_t UNO_RX_PIN = 32;
const uint8_t UNO_TX_PIN = 17;

// ==================== SETTINGS ====================
// Test mode: bypass ESP32-CAM but keep real sensors, RFID, MQTT, backend and DB.
// Set false after PLATE_RECOGNIZER_TOKEN is configured on AWS and ESP32-CAM
// has USE_MOCK_ANPR=false.
const bool USE_MOCK_CAMERA = false;
const char *MOCK_LICENSE_PLATE = "30A-123.45";

const int GATE_CLOSED_ANGLE = 0;
const int GATE_OPEN_ANGLE = 90;
const int SERVO_MIN_PULSE_US = 600;
const int SERVO_MAX_PULSE_US = 2300;
const unsigned long SERVO_MOVE_TIME_MS = 900;
// Keep the barrier open long enough for the vehicle to pass. The sensor must
// also be CLEAR before the gate is allowed to close.
const unsigned long GATE_MIN_OPEN_MS = 5000;
// Cloud ANPR can need 20-30 seconds for one attempt. Allow enough time for
// several attempts instead of cancelling a valid card scan after one failure.
const unsigned long ACCESS_TIMEOUT_MS = 90000;
const unsigned long ACCESS_RETRY_MS = 4000;
const unsigned long CAMERA_RETRY_MS = 5000;
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
uint8_t receivedSpotMask = 0;
unsigned long lastSpotSyncRequestAt = 0;

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

bool publishJson(const String &mqttTopic, JsonDocument &doc, bool retained = false) {
  char payload[2048];
  size_t length = serializeJson(doc, payload, sizeof(payload));
  if (!length) {
    Serial.println("[MQTT] JSON payload overflow");
    return false;
  }
  if (!mqtt.connected()) {
    Serial.printf("[MQTT] Publish skipped while disconnected: %s\n", mqttTopic.c_str());
    return false;
  }
  bool published = mqtt.publish(mqttTopic.c_str(), (uint8_t *)payload, length, retained);
  if (!published) Serial.printf("[MQTT] Publish failed: %s\n", mqttTopic.c_str());
  return published;
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
  unsigned long lastCameraRequestAt = 0;
  uint8_t cameraRequestAttempts = 0;
};

PendingAccess pendingAccess;
bool entryRawDetected = false;
bool exitRawDetected = false;
bool entryStableDetected = false;
bool exitStableDetected = false;
bool entrySensorArmed = false;
bool exitSensorArmed = false;
unsigned long entryRawChangedAt = 0;
unsigned long exitRawChangedAt = 0;
bool entryGateOpen = false;
bool exitGateOpen = false;
unsigned long entryOpenedAt = 0;
unsigned long exitOpenedAt = 0;
unsigned long entryServoDetachAt = 0;
unsigned long exitServoDetachAt = 0;
String lastEntryPassageEvent;
String lastExitPassageEvent;

void resetPendingAccess() {
  if (pendingAccess.active) {
    Serial.printf("[ACCESS] Reset %s event=%s\n",
                  pendingAccess.direction.c_str(), pendingAccess.eventId.c_str());
  }
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

void attachGateServo(bool entry) {
  Servo &servo = entry ? entryServo : exitServo;
  if (servo.attached()) return;

  const uint8_t pin = entry ? ENTRY_SERVO_PIN : EXIT_SERVO_PIN;
  servo.setPeriodHertz(50);
  servo.attach(pin, SERVO_MIN_PULSE_US, SERVO_MAX_PULSE_US);
}

void scheduleGateServoDetach(bool entry) {
  const unsigned long detachAt = millis() + SERVO_MOVE_TIME_MS;
  if (entry) entryServoDetachAt = detachAt;
  else exitServoDetachAt = detachAt;
}

void handleGateServoDetach(bool entry) {
  Servo &servo = entry ? entryServo : exitServo;
  unsigned long &detachAt = entry ? entryServoDetachAt : exitServoDetachAt;
  if (!servo.attached() || detachAt == 0) return;
  if ((long)(millis() - detachAt) < 0) return;

  const uint8_t pin = entry ? ENTRY_SERVO_PIN : EXIT_SERVO_PIN;
  servo.detach();
  detachAt = 0;

  // Keep the signal at a defined LOW level instead of leaving it floating.
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  Serial.printf("[SERVO] %s signal detached and held LOW (anti-hum)\n",
                entry ? "ENTRY" : "EXIT");
}

void closeGate(bool entry) {
  attachGateServo(entry);
  if (entry) {
    entryServo.write(GATE_CLOSED_ANGLE);
    scheduleGateServoDetach(true);
    entryGateOpen = false;
    Serial.printf("[SERVO] ENTRY CLOSED angle=%d GPIO=%u\n", GATE_CLOSED_ANGLE, ENTRY_SERVO_PIN);
    publishGateState("ENTRY_GATE", "GATE_ENTRY_SERVO", "CLOSED", lastEntryPassageEvent);
    lastEntryPassageEvent = "";
  } else {
    exitServo.write(GATE_CLOSED_ANGLE);
    scheduleGateServoDetach(false);
    exitGateOpen = false;
    Serial.printf("[SERVO] EXIT CLOSED angle=%d GPIO=%u\n", GATE_CLOSED_ANGLE, EXIT_SERVO_PIN);
    publishGateState("EXIT_GATE", "GATE_EXIT_SERVO", "CLOSED", lastExitPassageEvent);
    lastExitPassageEvent = "";
  }
}

void openGate(bool entry) {
  attachGateServo(entry);
  if (entry) {
    // Keep PWM attached while OPEN so the barrier cannot fall under its weight.
    entryServoDetachAt = 0;
    entryServo.write(GATE_OPEN_ANGLE);
    entryGateOpen = true;
    entryOpenedAt = millis();
    Serial.printf("[SERVO] ENTRY OPEN angle=%d GPIO=%u\n", GATE_OPEN_ANGLE, ENTRY_SERVO_PIN);
    publishGateState("ENTRY_GATE", "GATE_ENTRY_SERVO", "OPEN", lastEntryPassageEvent);
  } else {
    // Keep PWM attached while OPEN so the barrier cannot fall under its weight.
    exitServoDetachAt = 0;
    exitServo.write(GATE_OPEN_ANGLE);
    exitGateOpen = true;
    exitOpenedAt = millis();
    Serial.printf("[SERVO] EXIT OPEN angle=%d GPIO=%u\n", GATE_OPEN_ANGLE, EXIT_SERVO_PIN);
    publishGateState("EXIT_GATE", "GATE_EXIT_SERVO", "OPEN", lastExitPassageEvent);
  }
}

void requestCameraCapture() {
  pendingAccess.lastCameraRequestAt = millis();
  pendingAccess.cameraRequestAttempts++;
  StaticJsonDocument<384> doc;
  doc["eventId"] = pendingAccess.eventId;
  doc["direction"] = pendingAccess.direction;
  bool published = publishJson(topic("local/camera/capture"), doc);
  Serial.printf("[CAMERA] Request %s event=%s attempt=%u published=%s\n",
                pendingAccess.direction.c_str(), pendingAccess.eventId.c_str(),
                pendingAccess.cameraRequestAttempts, published ? "YES" : "NO");
}

void applyMockCameraResult() {
  pendingAccess.imageUrl = String("mock://esp32-gate/") +
                           pendingAccess.eventId + ".jpg";
  pendingAccess.plate = MOCK_LICENSE_PLATE;
  pendingAccess.cameraReady = true;
  Serial.printf("[MOCK CAMERA] event=%s direction=%s plate=%s ready=YES\n",
                pendingAccess.eventId.c_str(), pendingAccess.direction.c_str(),
                pendingAccess.plate.c_str());
}

void beginAccess(const String &direction) {
  if (pendingAccess.active) {
    Serial.printf("[ACCESS] Ignore %s; pending %s event=%s\n",
                  direction.c_str(), pendingAccess.direction.c_str(),
                  pendingAccess.eventId.c_str());
    return;
  }
  pendingAccess.active = true;
  pendingAccess.direction = direction;
  pendingAccess.eventId = makeEventId(direction == "ENTRY" ? "entry" : "exit");
  pendingAccess.startedAt = millis();
  Serial.printf("[ACCESS] %s event=%s waiting for RFID before camera\n",
                direction.c_str(), pendingAccess.eventId.c_str());
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

  bool published = false;
  if (pendingAccess.direction == "ENTRY") {
    doc["vehicleType"] = "CAR";
    doc["rightPlate"] = pendingAccess.plate;
    lastEntryPassageEvent = pendingAccess.eventId;
    published = publishJson(topic("events/gate/entry/request"), doc);
  } else {
    doc["leftPlate"] = pendingAccess.plate;
    lastExitPassageEvent = pendingAccess.eventId;
    published = publishJson(topic("events/gate/exit/request"), doc);
  }
  pendingAccess.requestPublished = published;
  pendingAccess.lastPublishAt = millis();
  Serial.printf("[ACCESS] Publish %s event=%s plate=%s rfid=%s result=%s\n",
                pendingAccess.direction.c_str(), pendingAccess.eventId.c_str(),
                pendingAccess.plate.c_str(), pendingAccess.rfidUid.c_str(),
                published ? "OK" : "FAILED");
}

void handleCameraResult(JsonDocument &doc) {
  if (!pendingAccess.active) {
    Serial.println("[CAMERA] Ignore result: no pending access");
    return;
  }
  String eventId = doc["eventId"] | "";
  if (eventId != pendingAccess.eventId) {
    Serial.printf("[CAMERA] Ignore stale result event=%s expected=%s\n",
                  eventId.c_str(), pendingAccess.eventId.c_str());
    return;
  }

  pendingAccess.imageUrl = String((const char *)(doc["imageUrl"] | ""));
  pendingAccess.plate = pendingAccess.direction == "ENTRY"
    ? String((const char *)(doc["rightPlate"] | ""))
    : String((const char *)(doc["leftPlate"] | ""));
  pendingAccess.plate.trim();
  pendingAccess.plate.toUpperCase();
  pendingAccess.cameraReady = pendingAccess.imageUrl.length() && pendingAccess.plate.length();
  Serial.printf("[CAMERA] Result event=%s direction=%s plate=%s ready=%s\n",
                eventId.c_str(), pendingAccess.direction.c_str(),
                pendingAccess.plate.c_str(), pendingAccess.cameraReady ? "YES" : "NO");
}

void handleGateCommand(const String &incomingTopic, JsonDocument &doc) {
  String commandId = doc["commandId"] | "";
  String action = doc["action"] | "";
  bool entry = incomingTopic.endsWith("GATE_ENTRY_SERVO");
  Serial.printf("[COMMAND] gate=%s action=%s commandId=%s\n",
                entry ? "ENTRY" : "EXIT", action.c_str(), commandId.c_str());

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
  bool newEntryRaw = digitalRead(ENTRY_SENSOR_PIN) == LOW;
  bool newExitRaw = digitalRead(EXIT_SENSOR_PIN) == LOW;
  unsigned long now = millis();

  if (newEntryRaw != entryRawDetected) {
    entryRawDetected = newEntryRaw;
    entryRawChangedAt = now;
  }
  if (newExitRaw != exitRawDetected) {
    exitRawDetected = newExitRaw;
    exitRawChangedAt = now;
  }

  if (entryRawDetected != entryStableDetected &&
      now - entryRawChangedAt >= SENSOR_DEBOUNCE_MS) {
    entryStableDetected = entryRawDetected;
    Serial.printf("[SENSOR] ENTRY %s GPIO=%u\n",
                  entryStableDetected ? "DETECTED" : "CLEAR", ENTRY_SENSOR_PIN);
    if (entryStableDetected) {
      if (entrySensorArmed) beginAccess("ENTRY");
      entrySensorArmed = false;
    } else {
      entrySensorArmed = true;
    }
  }

  if (exitRawDetected != exitStableDetected &&
      now - exitRawChangedAt >= SENSOR_DEBOUNCE_MS) {
    exitStableDetected = exitRawDetected;
    Serial.printf("[SENSOR] EXIT %s GPIO=%u\n",
                  exitStableDetected ? "DETECTED" : "CLEAR", EXIT_SENSOR_PIN);
    if (exitStableDetected) {
      if (exitSensorArmed) beginAccess("EXIT");
      exitSensorArmed = false;
    } else {
      exitSensorArmed = true;
    }
  }

  // Do not close while the sensor still sees a vehicle. Even if the sensor
  // became clear before the cloud command arrived, keep the gate open for at
  // least five seconds so the vehicle has enough time to pass.
  if (entryGateOpen && !entryStableDetected &&
      now - entryOpenedAt >= GATE_MIN_OPEN_MS) {
    closeGate(true);
  }
  if (exitGateOpen && !exitStableDetected &&
      now - exitOpenedAt >= GATE_MIN_OPEN_MS) {
    closeGate(false);
  }
}

void handlePendingAccess() {
  if (!pendingAccess.active) return;

  String uid = readRfidUid();
  if (uid.length()) {
    bool firstCardRead = !pendingAccess.rfidUid.length();
    pendingAccess.rfidUid = uid;
    Serial.printf("[RFID] %s\n", uid.c_str());
    if (firstCardRead && !pendingAccess.cameraReady) {
      if (USE_MOCK_CAMERA) {
        applyMockCameraResult();
      } else {
        requestCameraCapture();
      }
    }
  }

  unsigned long now = millis();
  if (now - pendingAccess.startedAt > ACCESS_TIMEOUT_MS) {
    Serial.printf("[ACCESS] TIMEOUT %s event=%s camera=%s rfid=%s\n",
                  pendingAccess.direction.c_str(), pendingAccess.eventId.c_str(),
                  pendingAccess.cameraReady ? "READY" : "MISSING",
                  pendingAccess.rfidUid.length() ? pendingAccess.rfidUid.c_str() : "MISSING");
    resetPendingAccess();
    return;
  }

  if (!USE_MOCK_CAMERA && pendingAccess.rfidUid.length() &&
      !pendingAccess.cameraReady &&
      now - pendingAccess.lastCameraRequestAt >= CAMERA_RETRY_MS) {
    requestCameraCapture();
  }

  if (pendingAccess.cameraReady && pendingAccess.rfidUid.length() &&
      (!pendingAccess.requestPublished || now - pendingAccess.lastPublishAt > ACCESS_RETRY_MS)) {
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
  bool published = publishJson(topic("events/parking/spot/state"), doc);
  int spotIndex = spotName.length() == 2 && spotName[0] == 'A'
    ? spotName[1] - '1'
    : -1;
  if (published && spotIndex >= 0 && spotIndex < 4) {
    receivedSpotMask |= (1 << spotIndex);
  }
  Serial.printf("[PARKING] UART=%s occupied=%s mqtt=%s synced=0x%02X\n",
                spotName.c_str(), occupied == "1" ? "YES" : "NO",
                published ? "OK" : "FAILED", receivedSpotMask);
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
  if (length >= 2048) {
    Serial.printf("[MQTT] Ignore oversized message topic=%s bytes=%u\n", rawTopic, length);
    return;
  }
  char json[2048];
  memcpy(json, payload, length);
  json[length] = '\0';

  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, json);
  if (error) {
    Serial.printf("[MQTT] Invalid JSON topic=%s error=%s\n", rawTopic, error.c_str());
    return;
  }

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
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  WiFi.setSleep(false);
  Serial.printf("\n[WiFi] IP: %s RSSI=%d dBm sleep=OFF\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

void connectMqtt() {
  while (!mqtt.connected()) {
    String clientId = "esp32-gate-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    bool connected = strlen(MQTT_USERNAME)
      ? mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)
      : mqtt.connect(clientId.c_str());

    if (connected) {
      if (!USE_MOCK_CAMERA) {
        mqtt.subscribe(topic("local/camera/result").c_str(), 1);
      }
      mqtt.subscribe(topic("commands/gate/+").c_str(), 1);
      mqtt.subscribe(topic("commands/led/+").c_str(), 1);
      Serial.printf("[MQTT] Connected client=%s keepAlive=60s\n", clientId.c_str());
    } else {
      Serial.printf("[MQTT] Failed state=%d\n", mqtt.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println("=== ESP32 GATE + PARKING CONTROLLER ===");
  Serial.printf("[CAMERA MODE] %s\n",
                USE_MOCK_CAMERA ? "MOCK - ESP32-CAM NOT REQUIRED" : "PHYSICAL ESP32-CAM");
  if (USE_MOCK_CAMERA) {
    Serial.printf("[CAMERA MODE] Mock plate=%s\n", MOCK_LICENSE_PLATE);
  }
  Serial2.begin(9600, SERIAL_8N1, UNO_RX_PIN, UNO_TX_PIN);

  pinMode(ENTRY_SENSOR_PIN, INPUT_PULLUP);
  pinMode(EXIT_SENSOR_PIN, INPUT_PULLUP);

  entryRawDetected = digitalRead(ENTRY_SENSOR_PIN) == LOW;
  exitRawDetected = digitalRead(EXIT_SENSOR_PIN) == LOW;
  entryStableDetected = entryRawDetected;
  exitStableDetected = exitRawDetected;
  entrySensorArmed = !entryStableDetected;
  exitSensorArmed = !exitStableDetected;
  entryRawChangedAt = millis();
  exitRawChangedAt = millis();
  Serial.printf("[SENSOR] Initial ENTRY=%s EXIT=%s; blocked sensor must become CLEAR before rearming\n",
                entryStableDetected ? "DETECTED" : "CLEAR",
                exitStableDetected ? "DETECTED" : "CLEAR");

  // Initialize one servo at a time to avoid both startup current peaks.
  entryServo.setPeriodHertz(50);
  entryServo.attach(ENTRY_SERVO_PIN, SERVO_MIN_PULSE_US, SERVO_MAX_PULSE_US);
  entryServo.write(GATE_CLOSED_ANGLE);
  delay(SERVO_MOVE_TIME_MS);
  entryServo.detach();
  pinMode(ENTRY_SERVO_PIN, OUTPUT);
  digitalWrite(ENTRY_SERVO_PIN, LOW);

  exitServo.setPeriodHertz(50);
  exitServo.attach(EXIT_SERVO_PIN, SERVO_MIN_PULSE_US, SERVO_MAX_PULSE_US);
  exitServo.write(GATE_CLOSED_ANGLE);
  delay(SERVO_MOVE_TIME_MS);
  exitServo.detach();
  pinMode(EXIT_SERVO_PIN, OUTPUT);
  digitalWrite(EXIT_SERVO_PIN, LOW);

  SPI.begin(18, 19, 23, RFID_SS_PIN);
  rfid.PCD_Init();
  delay(100);
  rfid.PCD_DumpVersionToSerial();

  connectWifi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(2048);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(10);
  connectMqtt();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  handleGateSensors();
  handlePendingAccess();
  handleUnoSerial();

  // Ask Arduino for an initial snapshot until all four spots are received.
  unsigned long parkingNow = millis();
  if (receivedSpotMask != 0x0F &&
      parkingNow - lastSpotSyncRequestAt >= 5000) {
    lastSpotSyncRequestAt = parkingNow;
    Serial2.println("STATE,ALL");
    Serial.printf("[PARKING] Request Arduino snapshot synced=0x%02X\n",
                  receivedSpotMask);
  }
  handleGateServoDetach(true);
  handleGateServoDetach(false);

  unsigned long now = millis();
  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    publishHeartbeat("GATE_ENTRY_SERVO", "BARRIER_SERVO", "ENTRY_GATE");
    publishHeartbeat("GATE_EXIT_SERVO", "BARRIER_SERVO", "EXIT_GATE");
    publishHeartbeat("RFID_ENTRY", "RFID_READER", "SHARED_GATE_STATION");
  }

  delay(5);
}
