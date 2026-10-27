/*
 * SMART PARKING - AI THINKER ESP32-CAM
 *
 * Chức năng:
 * - Nhận yêu cầu chụp ảnh từ ESP32 Gate qua MQTT.
 * - Chụp JPEG và POST ảnh tới ANPR service.
 * - ANPR service cắt nửa trái/phải, lưu ảnh và trả về imageUrl + biển số.
 * - Publish kết quả về ESP32 Gate để tạo yêu cầu xe vào/ra.
 *
 * ANPR service cần nhận Content-Type: image/jpeg và trả JSON:
 * {
 *   "imageUrl": "https://.../capture.jpg",
 *   "leftPlate": "30A-123.45",
 *   "rightPlate": "51B-456.78"
 * }
 *
 * Thư viện Arduino IDE:
 * - PubSubClient
 * - ArduinoJson
 * - esp_camera (đi kèm ESP32 Arduino core)
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include "esp_camera.h"

const char *WIFI_SSID = "P05";
const char *WIFI_PASSWORD = "12345678@";
const char *MQTT_HOST = "192.168.55.170";
const uint16_t MQTT_PORT = 1883;
const char *MQTT_USERNAME = "";
const char *MQTT_PASSWORD = "";
const char *TOPIC_PREFIX = "smart-parking";

// Đây là service nhận diện biển số riêng, không phải endpoint backend Node hiện tại.
const char *ANPR_URL = "http://192.168.1.100:5000/recognize";
const bool USE_MOCK_ANPR = false; // Đặt true để test luồng khi chưa có ANPR service
const char *MOCK_LEFT_PLATE = "30A-123.45";
const char *MOCK_RIGHT_PLATE = "30A-123.45";

// AI Thinker ESP32-CAM pin map.
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22
#define FLASH_LED_PIN 4

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

bool capturePending = false;
String pendingEventId;
String pendingDirection;
unsigned long lastHeartbeatAt = 0;
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

void publishJson(const String &mqttTopic, JsonDocument &doc) {
  char payload[1536];
  size_t length = serializeJson(doc, payload, sizeof(payload));
  if (length) mqtt.publish(mqttTopic.c_str(), (uint8_t *)payload, length, false);
}

bool initializeCamera() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_LATEST;

  if (psramFound()) {
    config.frame_size = FRAMESIZE_UXGA;
    config.jpeg_quality = 10;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    config.frame_size = FRAMESIZE_SVGA;
    config.jpeg_quality = 12;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }

  esp_err_t error = esp_camera_init(&config);
  if (error != ESP_OK) {
    Serial.printf("[CAMERA] Init failed: 0x%x\n", error);
    return false;
  }

  sensor_t *sensor = esp_camera_sensor_get();
  sensor->set_framesize(sensor, psramFound() ? FRAMESIZE_UXGA : FRAMESIZE_SVGA);
  return true;
}

void publishHeartbeat() {
  StaticJsonDocument<384> doc;
  doc["eventId"] = makeEventId("heartbeat");
  doc["deviceCode"] = "CAMERA_MAIN";
  doc["type"] = "CAMERA";
  doc["status"] = "ONLINE";
  doc["location"] = "ENTRY_EXIT_VIEW";
  doc["ipAddress"] = WiFi.localIP().toString();
  publishJson(topic("events/device/heartbeat"), doc);
}

void mqttCallback(char *rawTopic, byte *payload, unsigned int length) {
  if (length >= 512 || capturePending) return;
  char json[512];
  memcpy(json, payload, length);
  json[length] = '\0';

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, json)) return;

  pendingEventId = String((const char *)(doc["eventId"] | ""));
  pendingDirection = String((const char *)(doc["direction"] | ""));
  if (pendingEventId.length() &&
      (pendingDirection == "ENTRY" || pendingDirection == "EXIT")) {
    capturePending = true;
  }
}

void publishCameraResult(const String &imageUrl, const String &leftPlate,
                         const String &rightPlate) {
  StaticJsonDocument<1024> result;
  result["eventId"] = pendingEventId;
  result["direction"] = pendingDirection;
  result["imageUrl"] = imageUrl;
  result["leftPlate"] = leftPlate;
  result["rightPlate"] = rightPlate;
  publishJson(topic("local/camera/result"), result);
}

void processCapture() {
  capturePending = false;
  digitalWrite(FLASH_LED_PIN, HIGH);
  delay(120);
  camera_fb_t *frame = esp_camera_fb_get();
  digitalWrite(FLASH_LED_PIN, LOW);

  if (!frame) {
    Serial.println("[CAMERA] Capture failed");
    return;
  }

  if (USE_MOCK_ANPR) {
    esp_camera_fb_return(frame);
    publishCameraResult(
      String("mock://esp32-cam/") + pendingEventId + ".jpg",
      MOCK_LEFT_PLATE,
      MOCK_RIGHT_PLATE
    );
    Serial.println("[ANPR] Mock result published");
    return;
  }

  HTTPClient http;
  http.begin(ANPR_URL);
  http.setTimeout(15000);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Event-Id", pendingEventId);
  http.addHeader("X-Direction", pendingDirection);
  int statusCode = http.POST(frame->buf, frame->len);
  esp_camera_fb_return(frame);

  if (statusCode < 200 || statusCode >= 300) {
    Serial.printf("[ANPR] HTTP error: %d\n", statusCode);
    http.end();
    return;
  }

  String response = http.getString();
  http.end();

  StaticJsonDocument<1024> anpr;
  if (deserializeJson(anpr, response)) {
    Serial.println("[ANPR] Invalid JSON response");
    return;
  }

  publishCameraResult(
    String((const char *)(anpr["imageUrl"] | "")),
    String((const char *)(anpr["leftPlate"] | "")),
    String((const char *)(anpr["rightPlate"] | ""))
  );
  Serial.printf("[ANPR] Result published for %s\n", pendingEventId.c_str());
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
}

void connectMqtt() {
  while (!mqtt.connected()) {
    String clientId = "esp32-camera-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    bool connected = strlen(MQTT_USERNAME)
      ? mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)
      : mqtt.connect(clientId.c_str());

    if (connected) {
      mqtt.subscribe(topic("local/camera/capture").c_str(), 1);
      Serial.println("[MQTT] Connected");
    } else {
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  if (!initializeCamera()) {
    delay(3000);
    ESP.restart();
  }

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

  if (capturePending) processCapture();

  if (millis() - lastHeartbeatAt >= 15000) {
    lastHeartbeatAt = millis();
    publishHeartbeat();
  }
  delay(5);
}
