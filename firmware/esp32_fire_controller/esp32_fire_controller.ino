/*
 * SMART PARKING - ESP32 FIRE CONTROLLER (ESP32 so 2)
 *
 * Chuc nang:
 * - Doc 4 cam bien lua analog NW/NE/SW/SE va 1 cam bien khi gas.
 * - Gui snapshot len backend qua MQTT.
 * - Nhan lenh coi, ngam 2 servo va relay bom tu backend.
 * - Chi ACK AIM_SERVOS sau khi servo da co thoi gian di chuyen.
 * - Chi bat bom khi cam bien tai cho van xac nhan co lua.
 * - Emergency stop va timeout bom luon duoc xu ly tai ESP32.
 *
 * Board Arduino IDE: ESP32 Dev Module.
 * Libraries: PubSubClient, ArduinoJson, ESP32Servo.
 *
 * CANH BAO:
 * - Thu relay bang LED truoc khi noi coi va bom.
 * - ENABLE_LOCAL_AUTONOMOUS_MODE mac dinh false.
 * - Chi doi thanh true sau khi test dung chieu servo, relay va nut dung khan cap.
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ==================== NETWORK ====================
const char *WIFI_SSID = "P05";
const char *WIFI_PASSWORD = "12345678@";
const char *MQTT_HOST = "192.168.55.170";
const uint16_t MQTT_PORT = 1883;
const char *MQTT_USERNAME = "";
const char *MQTT_PASSWORD = "";
const char *TOPIC_PREFIX = "smart-parking";

// ==================== PIN MAP - ESP32 FIRE ====================
// Tat ca chan analog thuoc ADC1 de hoat dong khi Wi-Fi dang bat.
const uint8_t FLAME_NW_PIN = 34;
const uint8_t FLAME_NE_PIN = 35;
const uint8_t FLAME_SW_PIN = 36; // VP
const uint8_t FLAME_SE_PIN = 39; // VN
const uint8_t GAS_PIN = 32;

const uint8_t SERVO_HORIZONTAL_PIN = 25;
const uint8_t SERVO_VERTICAL_PIN = 26;
const uint8_t BUZZER_RELAY_PIN = 27; // Relay kenh 2 IN2
const uint8_t PUMP_RELAY_PIN = 14;   // Relay kenh 1 IN1
const uint8_t EMERGENCY_STOP_PIN = 13; // Nut NO: GPIO13 xuong GND khi nhan

// ==================== SETTINGS ====================
const bool PUMP_RELAY_ACTIVE_LOW = true;
const bool BUZZER_RELAY_ACTIVE_LOW = true;
const bool ENABLE_LOCAL_AUTONOMOUS_MODE = false;

const float FLAME_THRESHOLD = 0.65f;
const float GAS_THRESHOLD = 0.90f;
const int PAN_MIN_ANGLE = 20;
const int PAN_MAX_ANGLE = 160;
const int TILT_MIN_ANGLE = 40;
const int TILT_MAX_ANGLE = 120;
const unsigned long AIM_SETTLE_MS = 900;
const unsigned long PUMP_MAX_RUN_MS = 30000;
const unsigned long SENSOR_SAMPLE_MS = 100;
const unsigned long SNAPSHOT_INTERVAL_MS = 2000;
const unsigned long HEARTBEAT_INTERVAL_MS = 15000;

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
Servo horizontalServo;
Servo verticalServo;

float flameNW = 0;
float flameNE = 0;
float flameSW = 0;
float flameSE = 0;
float gasLevel = 0;

bool pumpRunning = false;
bool buzzerEnabled = false;
bool cloudAimPending = false;
bool localAimPending = false;
bool localSuppressionAttempted = false;
unsigned long pumpStartedAt = 0;
unsigned long aimStartedAt = 0;
unsigned long lastSensorSampleAt = 0;
unsigned long lastSnapshotAt = 0;
unsigned long lastHeartbeatAt = 0;
String pendingAimCommandId;
uint32_t eventCounter = 0;

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
  char payload[1536];
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
  doc["metadata"]["controller"] = "ESP32_FIRE_CONTROLLER";
  publishJson(topic("events/device/heartbeat"), doc);
}

float readFlameNormalized(uint8_t pin) {
  // Phan lon module flame co dien ap AO thap hon khi lua manh.
  return constrain(1.0f - ((float)analogRead(pin) / 4095.0f), 0.0f, 1.0f);
}

void sampleSensors() {
  float nw = 0, ne = 0, sw = 0, se = 0, gas = 0;
  for (uint8_t i = 0; i < 8; i++) {
    nw += readFlameNormalized(FLAME_NW_PIN);
    ne += readFlameNormalized(FLAME_NE_PIN);
    sw += readFlameNormalized(FLAME_SW_PIN);
    se += readFlameNormalized(FLAME_SE_PIN);
    gas += constrain((float)analogRead(GAS_PIN) / 4095.0f, 0.0f, 1.0f);
    delay(2);
  }
  flameNW = nw / 8.0f;
  flameNE = ne / 8.0f;
  flameSW = sw / 8.0f;
  flameSE = se / 8.0f;
  gasLevel = gas / 8.0f;
}

bool flameDetected() {
  return max(max(flameNW, flameNE), max(flameSW, flameSE)) >= FLAME_THRESHOLD;
}

bool gasDetected() {
  return gasLevel >= GAS_THRESHOLD;
}

bool emergencyStopPressed() {
  return digitalRead(EMERGENCY_STOP_PIN) == LOW;
}

void writeRelay(uint8_t pin, bool enabled, bool activeLow) {
  bool outputHigh = activeLow ? !enabled : enabled;
  digitalWrite(pin, outputHigh ? HIGH : LOW);
}

void setBuzzer(bool enabled) {
  writeRelay(BUZZER_RELAY_PIN, enabled, BUZZER_RELAY_ACTIVE_LOW);
  if (buzzerEnabled != enabled) {
    buzzerEnabled = enabled;
    Serial.printf("[BUZZER] %s\n", enabled ? "ON" : "OFF");
  }
}

void setPump(bool enabled) {
  writeRelay(PUMP_RELAY_PIN, enabled, PUMP_RELAY_ACTIVE_LOW);
  if (pumpRunning == enabled) return;
  pumpRunning = enabled;
  if (enabled) pumpStartedAt = millis();
  Serial.printf("[PUMP] %s\n", enabled ? "ON" : "OFF");
}

void estimateTarget(int &gridX, int &gridY, int &panAngle, int &tiltAngle) {
  float total = flameNW + flameNE + flameSW + flameSE;
  if (total < 0.001f) {
    gridX = 2;
    gridY = 2;
  } else {
    gridX = constrain((int)roundf(((flameNE + flameSE) * 4.0f) / total), 0, 4);
    gridY = constrain((int)roundf(((flameNW + flameNE) * 4.0f) / total), 0, 4);
  }
  panAngle = map(gridX, 0, 4, PAN_MIN_ANGLE, PAN_MAX_ANGLE);
  tiltAngle = map(gridY, 0, 4, TILT_MIN_ANGLE, TILT_MAX_ANGLE);
}

void startAim(int panAngle, int tiltAngle, const String &commandId, bool local) {
  panAngle = constrain(panAngle, PAN_MIN_ANGLE, PAN_MAX_ANGLE);
  tiltAngle = constrain(tiltAngle, TILT_MIN_ANGLE, TILT_MAX_ANGLE);
  horizontalServo.write(panAngle);
  verticalServo.write(tiltAngle);
  aimStartedAt = millis();
  cloudAimPending = !local;
  localAimPending = local;
  pendingAimCommandId = commandId;
  Serial.printf("[AIM] pan=%d tilt=%d source=%s\n", panAngle, tiltAngle,
                local ? "LOCAL" : "BACKEND");
}

void publishSnapshot() {
  StaticJsonDocument<512> doc;
  doc["eventId"] = makeEventId("fire");
  doc["flameNW"] = flameNW;
  doc["flameNE"] = flameNE;
  doc["flameSW"] = flameSW;
  doc["flameSE"] = flameSE;
  doc["gasLevel"] = gasLevel;
  publishJson(topic("events/fire/snapshot"), doc);
  Serial.printf("[SENSORS] NW=%.2f NE=%.2f SW=%.2f SE=%.2f GAS=%.2f\n",
                flameNW, flameNE, flameSW, flameSE, gasLevel);
}

void handleFireCommand(JsonDocument &doc) {
  String commandId = doc["commandId"] | "";
  String action = doc["action"] | "";

  if (action == "BUZZER_ON") {
    setBuzzer(true);
    publishCommandAck(commandId, true);
  } else if (action == "BUZZER_OFF") {
    setBuzzer(false);
    publishCommandAck(commandId, true);
  } else if (action == "AIM_SERVOS") {
    int pan = doc["horizontalAngle"] | 90;
    int tilt = doc["verticalAngle"] | 80;
    startAim(pan, tilt, commandId, false);
  } else if (action == "PUMP_ON") {
    sampleSensors();
    if (emergencyStopPressed()) {
      setPump(false);
      publishCommandAck(commandId, false, "Emergency stop is active");
    } else if (!flameDetected()) {
      setPump(false);
      publishCommandAck(commandId, false, "No local flame confirmation");
    } else {
      setPump(true);
      publishCommandAck(commandId, true);
    }
  } else if (action == "PUMP_OFF") {
    setPump(false);
    localSuppressionAttempted = false;
    publishCommandAck(commandId, true);
  } else {
    publishCommandAck(commandId, false, "Unsupported fire action");
  }
}

void mqttCallback(char *rawTopic, byte *payload, unsigned int length) {
  if (length >= 1536) return;
  char json[1536];
  memcpy(json, payload, length);
  json[length] = '\0';

  StaticJsonDocument<1536> doc;
  if (deserializeJson(doc, json)) {
    Serial.println("[MQTT] Invalid JSON command");
    return;
  }

  String incomingTopic(rawTopic);
  if (incomingTopic.startsWith(topic("commands/fire/"))) handleFireCommand(doc);
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
    String clientId = "esp32-fire-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    bool connected = strlen(MQTT_USERNAME)
      ? mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)
      : mqtt.connect(clientId.c_str());

    if (connected) {
      mqtt.subscribe(topic("commands/fire/+").c_str(), 1);
      Serial.println("[MQTT] Connected as ESP32 FIRE");
    } else {
      Serial.printf("[MQTT] Failed state=%d; retrying...\n", mqtt.state());
      delay(2000);
    }
  }
}

void handleAimCompletion() {
  if (!(cloudAimPending || localAimPending) || millis() - aimStartedAt < AIM_SETTLE_MS) return;

  if (cloudAimPending) publishCommandAck(pendingAimCommandId, true);
  if (localAimPending && ENABLE_LOCAL_AUTONOMOUS_MODE &&
      flameDetected() && !emergencyStopPressed()) {
    setPump(true);
  }

  cloudAimPending = false;
  localAimPending = false;
  pendingAimCommandId = "";
}

void handleLocalSafety() {
  bool hazard = flameDetected() || gasDetected();
  if (hazard) setBuzzer(true);

  if (ENABLE_LOCAL_AUTONOMOUS_MODE && flameDetected() && !pumpRunning &&
      !cloudAimPending && !localAimPending && !localSuppressionAttempted &&
      !emergencyStopPressed()) {
    int gridX, gridY, pan, tilt;
    estimateTarget(gridX, gridY, pan, tilt);
    localSuppressionAttempted = true;
    startAim(pan, tilt, "", true);
  }

  if (!flameDetected() && !pumpRunning) localSuppressionAttempted = false;

  if (emergencyStopPressed()) {
    setPump(false);
    setBuzzer(false);
  }

  if (pumpRunning && millis() - pumpStartedAt >= PUMP_MAX_RUN_MS) {
    Serial.println("[SAFETY] Pump timeout");
    setPump(false);
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(BUZZER_RELAY_PIN, OUTPUT);
  pinMode(PUMP_RELAY_PIN, OUTPUT);
  pinMode(EMERGENCY_STOP_PIN, INPUT_PULLUP);
  writeRelay(BUZZER_RELAY_PIN, false, BUZZER_RELAY_ACTIVE_LOW);
  writeRelay(PUMP_RELAY_PIN, false, PUMP_RELAY_ACTIVE_LOW);

  analogReadResolution(12);
  analogSetPinAttenuation(FLAME_NW_PIN, ADC_11db);
  analogSetPinAttenuation(FLAME_NE_PIN, ADC_11db);
  analogSetPinAttenuation(FLAME_SW_PIN, ADC_11db);
  analogSetPinAttenuation(FLAME_SE_PIN, ADC_11db);
  analogSetPinAttenuation(GAS_PIN, ADC_11db);

  horizontalServo.setPeriodHertz(50);
  verticalServo.setPeriodHertz(50);
  horizontalServo.attach(SERVO_HORIZONTAL_PIN, 500, 2400);
  verticalServo.attach(SERVO_VERTICAL_PIN, 500, 2400);
  horizontalServo.write(90);
  verticalServo.write(80);

  sampleSensors();
  Serial.println("=== ESP32 FIRE CONTROLLER READY ===");
  Serial.printf("Local autonomous mode: %s\n", ENABLE_LOCAL_AUTONOMOUS_MODE ? "ON" : "OFF");

  connectWifi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(1536);
  connectMqtt();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  unsigned long now = millis();
  if (now - lastSensorSampleAt >= SENSOR_SAMPLE_MS) {
    lastSensorSampleAt = now;
    sampleSensors();
  }

  handleAimCompletion();
  handleLocalSafety();

  if (now - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshotAt = now;
    publishSnapshot();
  }

  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    publishHeartbeat("FIRE_SERVO_CONTROLLER", "NOZZLE_SERVO", "FIRE_ZONE_MAIN");
    publishHeartbeat("FIRE_BUZZER", "BUZZER", "FIRE_ZONE_MAIN");
    publishHeartbeat("FIRE_PUMP_RELAY", "RELAY", "FIRE_ZONE_MAIN");
    publishHeartbeat("FIRE_GAS", "GAS_SENSOR", "FIRE_ZONE_MAIN");
  }

  delay(5);
}
