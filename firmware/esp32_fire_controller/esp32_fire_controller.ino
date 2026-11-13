/*
 * SMART PARKING - ESP32 FIRE CONTROLLER (ESP32 so 2)
 *
 * Bo tri: 4 cam bien lua tai 4 goc hinh chu nhat 40 x 18 cm.
 * Voi phun + 1 servo dat ngoai, tai trung diem canh 40 cm phia Nam.
 * Gas chi gui canh bao nhan vien. Chi lua moi bat coi, servo va bom.
 * Xu ly lua chay cuc bo, khong phu thuoc Wi-Fi/MQTT.
 *
 * Board: DOIT ESP32 DEVKIT V1 (hoac ESP32 Dev Module).
 * Libraries: PubSubClient, ArduinoJson, ESP32Servo.
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include "mqtt_credentials.h"
#include "wifi_credentials.h"

const uint16_t MQTT_PORT = 1883;
const char *TOPIC_PREFIX = "smart-parking";

// ADC1 van doc duoc khi Wi-Fi hoat dong.
const uint8_t FLAME_NW_PIN = 34;
const uint8_t FLAME_NE_PIN = 35;
const uint8_t FLAME_SW_PIN = 36; // VP
const uint8_t FLAME_SE_PIN = 39; // VN
const uint8_t GAS_PIN = 32;
const uint8_t NOZZLE_SERVO_PIN = 25;
const uint8_t BUZZER_RELAY_PIN = 27;   // Relay kenh 2 IN2
const uint8_t PUMP_RELAY_PIN = 14;     // Relay kenh 1 IN1
const uint8_t EMERGENCY_STOP_PIN = 13; // Nut NO: GPIO13 xuong GND
// GPIO26 khong con su dung.

const bool PUMP_RELAY_ACTIVE_LOW = true;
const bool BUZZER_RELAY_ACTIVE_LOW = true;
const bool ENABLE_LOCAL_AUTONOMOUS_MODE = true;
const float FLAME_THRESHOLD = 0.65f;
const float GAS_THRESHOLD = 0.90f;

// Bo tri 40 x 18 cm, servo o giua canh Nam va lui ra ngoai khoang 5 cm.
// Neu lap servo nguoc, doi NW<->NE, SW<->SE hoac hieu chinh tung gia tri.
const int NOZZLE_ANGLE_SW = 15;
const int NOZZLE_ANGLE_NW = 49;
const int NOZZLE_HOME_ANGLE = 90;
const int NOZZLE_ANGLE_NE = 131;
const int NOZZLE_ANGLE_SE = 165;
const int NOZZLE_MIN_ANGLE = 5;
const int NOZZLE_MAX_ANGLE = 175;

const unsigned long FLAME_CONFIRM_MS = 700;
const unsigned long FLAME_CLEAR_MS = 2000;
const unsigned long AIM_SETTLE_MS = 900;
const unsigned long PUMP_MAX_RUN_MS = 30000;
const unsigned long SENSOR_SAMPLE_MS = 100;
const unsigned long SNAPSHOT_INTERVAL_MS = 2000;
const unsigned long HEARTBEAT_INTERVAL_MS = 15000;
const unsigned long WIFI_RETRY_MS = 5000;
const unsigned long MQTT_RETRY_MS = 3000;

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
Servo nozzleServo;

float flameNW = 0, flameNE = 0, flameSW = 0, flameSE = 0, gasLevel = 0;
bool flameConfirmed = false;
bool gasWarningActive = false;
bool pumpRunning = false;
bool buzzerEnabled = false;
bool cloudAimPending = false;
bool localAimPending = false;
bool localSuppressionAttempted = false;

unsigned long flameCandidateAt = 0, flameClearAt = 0, pumpStartedAt = 0;
unsigned long aimStartedAt = 0, lastSensorSampleAt = 0, lastSnapshotAt = 0;
unsigned long lastHeartbeatAt = 0, lastWifiAttemptAt = 0, lastMqttAttemptAt = 0;
String pendingAimCommandId;
String activeTargetCorner = "NONE";
uint32_t eventCounter = 0;

String topic(const String &suffix) { return String(TOPIC_PREFIX) + "/" + suffix; }

String makeEventId(const String &kind) {
  eventCounter++;
  return kind + "-" + String((uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFF), HEX) + "-" +
         String(millis()) + "-" + String(eventCounter);
}

void publishJson(const String &mqttTopic, JsonDocument &doc, bool retained = false) {
  if (!mqtt.connected()) return;
  char payload[1536];
  size_t length = serializeJson(doc, payload, sizeof(payload));
  if (!length) return;
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

void publishHeartbeat(const char *deviceCode, const char *type) {
  StaticJsonDocument<384> doc;
  doc["eventId"] = makeEventId("heartbeat");
  doc["deviceCode"] = deviceCode;
  doc["type"] = type;
  doc["status"] = "ONLINE";
  doc["location"] = "FIRE_ZONE_MAIN";
  doc["ipAddress"] = WiFi.localIP().toString();
  doc["metadata"]["controller"] = "ESP32_FIRE_CONTROLLER";
  publishJson(topic("events/device/heartbeat"), doc);
}

float readFlameNormalized(uint8_t pin) {
  // Da so module LM393 co AO giam khi cuong do lua tang.
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

float maximumFlameLevel() { return max(max(flameNW, flameNE), max(flameSW, flameSE)); }
bool rawFlameDetected() { return maximumFlameLevel() >= FLAME_THRESHOLD; }
bool emergencyStopPressed() { return digitalRead(EMERGENCY_STOP_PIN) == LOW; }

void updateSensorStates() {
  unsigned long now = millis();
  if (rawFlameDetected()) {
    flameClearAt = 0;
    if (!flameConfirmed) {
      if (flameCandidateAt == 0) flameCandidateAt = now;
      if (now - flameCandidateAt >= FLAME_CONFIRM_MS) {
        flameConfirmed = true;
        Serial.println("[FIRE] CONFIRMED");
      }
    }
  } else {
    flameCandidateAt = 0;
    if (flameConfirmed) {
      if (flameClearAt == 0) flameClearAt = now;
      if (now - flameClearAt >= FLAME_CLEAR_MS) {
        flameConfirmed = false;
        flameClearAt = 0;
        Serial.println("[FIRE] CLEARED");
      }
    }
  }

  bool newGasWarning = gasLevel >= GAS_THRESHOLD;
  if (newGasWarning != gasWarningActive) {
    gasWarningActive = newGasWarning;
    Serial.printf("[GAS] %s - employee inspection required; no pump/buzzer\n",
                  gasWarningActive ? "WARNING" : "NORMAL");
  }
}

void writeRelay(uint8_t pin, bool enabled, bool activeLow) {
  digitalWrite(pin, (activeLow ? !enabled : enabled) ? HIGH : LOW);
}

void setBuzzer(bool enabled) {
  writeRelay(BUZZER_RELAY_PIN, enabled, BUZZER_RELAY_ACTIVE_LOW);
  if (buzzerEnabled == enabled) return;
  buzzerEnabled = enabled;
  Serial.printf("[BUZZER] %s\n", enabled ? "ON" : "OFF");
}

void setPump(bool enabled) {
  writeRelay(PUMP_RELAY_PIN, enabled, PUMP_RELAY_ACTIVE_LOW);
  if (pumpRunning == enabled) return;
  pumpRunning = enabled;
  if (enabled) pumpStartedAt = millis();
  Serial.printf("[PUMP] %s\n", enabled ? "ON" : "OFF");
}

void getStrongestCorner(String &corner, int &servoAngle) {
  float strongest = flameNW;
  corner = "NW";
  servoAngle = NOZZLE_ANGLE_NW;
  if (flameNE > strongest) { strongest = flameNE; corner = "NE"; servoAngle = NOZZLE_ANGLE_NE; }
  if (flameSW > strongest) { strongest = flameSW; corner = "SW"; servoAngle = NOZZLE_ANGLE_SW; }
  if (flameSE > strongest) { corner = "SE"; servoAngle = NOZZLE_ANGLE_SE; }
}

void startAim(int servoAngle, const String &corner, const String &commandId, bool local) {
  servoAngle = constrain(servoAngle, NOZZLE_MIN_ANGLE, NOZZLE_MAX_ANGLE);
  nozzleServo.write(servoAngle);
  activeTargetCorner = corner;
  aimStartedAt = millis();
  cloudAimPending = !local;
  localAimPending = local;
  pendingAimCommandId = commandId;
  Serial.printf("[AIM] corner=%s angle=%d source=%s\n", corner.c_str(), servoAngle,
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
  doc["flameConfirmed"] = flameConfirmed;
  publishJson(topic("events/fire/snapshot"), doc);
  Serial.printf("[SENSORS] NW=%.2f NE=%.2f SW=%.2f SE=%.2f GAS=%.2f FIRE=%s\n",
                flameNW, flameNE, flameSW, flameSE, gasLevel,
                flameConfirmed ? "YES" : "NO");
}

void handleFireCommand(JsonDocument &doc) {
  String commandId = doc["commandId"] | "";
  String action = doc["action"] | "";
  if (action == "BUZZER_ON") {
    if (flameConfirmed) { setBuzzer(true); publishCommandAck(commandId, true); }
    else { setBuzzer(false); publishCommandAck(commandId, false, "No confirmed local flame"); }
  } else if (action == "BUZZER_OFF") {
    setBuzzer(false);
    publishCommandAck(commandId, true);
  } else if (action == "AIM_SERVOS") {
    int angle = doc["servoAngle"] | (doc["horizontalAngle"] | NOZZLE_HOME_ANGLE);
    String corner = doc["targetCorner"] | "UNKNOWN";
    startAim(angle, corner, commandId, false);
  } else if (action == "PUMP_ON") {
    sampleSensors();
    updateSensorStates();
    if (emergencyStopPressed()) {
      setPump(false);
      publishCommandAck(commandId, false, "Emergency stop is active");
    } else if (!flameConfirmed) {
      setPump(false);
      publishCommandAck(commandId, false, "No confirmed local flame");
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
  if (deserializeJson(doc, json)) return;
  if (String(rawTopic).startsWith(topic("commands/fire/"))) handleFireCommand(doc);
}

void maintainNetwork() {
  unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiAttemptAt >= WIFI_RETRY_MS) {
      lastWifiAttemptAt = now;
      Serial.println("[WiFi] Connecting...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
    return;
  }
  if (!mqtt.connected() && now - lastMqttAttemptAt >= MQTT_RETRY_MS) {
    lastMqttAttemptAt = now;
    String clientId = "esp32-fire-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    bool connected = strlen(MQTT_USERNAME)
      ? mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)
      : mqtt.connect(clientId.c_str());
    if (connected) {
      mqtt.subscribe(topic("commands/fire/+").c_str(), 1);
      Serial.printf("[MQTT] Connected as ESP32 FIRE; IP=%s\n", WiFi.localIP().toString().c_str());
    } else Serial.printf("[MQTT] Failed state=%d\n", mqtt.state());
  }
  if (mqtt.connected()) mqtt.loop();
}

void handleAimCompletion() {
  if (!(cloudAimPending || localAimPending) || millis() - aimStartedAt < AIM_SETTLE_MS) return;
  if (cloudAimPending) publishCommandAck(pendingAimCommandId, true);
  if (localAimPending && ENABLE_LOCAL_AUTONOMOUS_MODE && flameConfirmed && !emergencyStopPressed()) {
    setPump(true);
  }
  cloudAimPending = false;
  localAimPending = false;
  pendingAimCommandId = "";
}

void handleLocalSafety() {
  if (emergencyStopPressed()) {
    setPump(false);
    setBuzzer(false);
    return;
  }
  // Gas khong duoc kich hoat coi, servo hoac bom.
  if (flameConfirmed) setBuzzer(true);
  else {
    setPump(false);
    setBuzzer(false);
    localSuppressionAttempted = false;
    localAimPending = false;
  }
  if (ENABLE_LOCAL_AUTONOMOUS_MODE && flameConfirmed && !pumpRunning &&
      !cloudAimPending && !localAimPending && !localSuppressionAttempted) {
    String corner;
    int angle;
    getStrongestCorner(corner, angle);
    localSuppressionAttempted = true;
    startAim(angle, corner, "", true);
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

  nozzleServo.setPeriodHertz(50);
  nozzleServo.attach(NOZZLE_SERVO_PIN, 500, 2400);
  nozzleServo.write(NOZZLE_HOME_ANGLE);
  sampleSensors();
  updateSensorStates();

  Serial.println("=== ESP32 FIRE CONTROLLER READY ===");
  Serial.println("Layout: rectangle 40 x 18 cm; one nozzle servo on GPIO25");
  Serial.printf("Local autonomous mode: %s\n", ENABLE_LOCAL_AUTONOMOUS_MODE ? "ON" : "OFF");

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptAt = millis();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(1536);
}

void loop() {
  unsigned long now = millis();
  if (now - lastSensorSampleAt >= SENSOR_SAMPLE_MS) {
    lastSensorSampleAt = now;
    sampleSensors();
    updateSensorStates();
  }
  handleAimCompletion();
  handleLocalSafety();
  maintainNetwork();
  if (now - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshotAt = now;
    publishSnapshot();
  }
  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    publishHeartbeat("FIRE_SERVO_CONTROLLER", "NOZZLE_SERVO");
    publishHeartbeat("FIRE_BUZZER", "BUZZER");
    publishHeartbeat("FIRE_PUMP_RELAY", "RELAY");
    publishHeartbeat("FIRE_GAS", "GAS_SENSOR");
  }
  delay(5);
}
