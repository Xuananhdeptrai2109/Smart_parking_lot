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

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include "esp_camera.h"
#include "esp_heap_caps.h"
#include "esp_http_server.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "mqtt_credentials.h"
#include "anpr_credentials.h"
#include "wifi_credentials.h"

const uint16_t MQTT_PORT = 1883;
const char *TOPIC_PREFIX = "smart-parking";

// Đây là service nhận diện biển số riêng, không phải endpoint backend Node hiện tại.
const char *ANPR_URL = "https://3-105-215-46.sslip.io/api/v1/anpr/recognize";
const bool USE_MOCK_ANPR = false;
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

// Lightweight preview for smoother positioning; ANPR still uses UXGA.
const framesize_t PREVIEW_FRAME_SIZE = FRAMESIZE_CIF;
const int PREVIEW_JPEG_QUALITY = 16;
const framesize_t ANPR_FRAME_SIZE = FRAMESIZE_XGA;
const int ANPR_JPEG_QUALITY = 10;
// About 10 FPS is smooth enough for alignment and leaves Wi-Fi bandwidth for
// the HTTPS ANPR upload.
const uint16_t STREAM_FRAME_DELAY_MS = 100;
// The onboard LED easily overexposes a printed plate in a lit demo area.
// Keep it off by default; only enable this for a genuinely dark installation.
const bool CAPTURE_FLASH_ENABLED = false;
const uint8_t ANPR_SETTLE_FRAMES = 3;

httpd_handle_t previewServer = nullptr;
SemaphoreHandle_t cameraMutex = nullptr;
volatile bool capturePending = false;
volatile bool captureBusy = false;
String pendingEventId;
String pendingDirection;
unsigned long lastHeartbeatAt = 0;
unsigned long lastWifiAttemptAt = 0;
unsigned long lastMqttAttemptAt = 0;
uint32_t eventCounter = 0;

static const char *STREAM_CONTENT_TYPE =
  "multipart/x-mixed-replace;boundary=frame";
static const char *STREAM_BOUNDARY = "\r\n--frame\r\n";
static const char *STREAM_PART =
  "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

String topic(const String &suffix) {
  return String(TOPIC_PREFIX) + "/" + suffix;
}

String makeEventId(const String &kind) {
  uint64_t chipId = ESP.getEfuseMac();
  eventCounter++;
  return kind + "-" + String((uint32_t)(chipId & 0xFFFFFFFF), HEX) + "-" +
         String(millis()) + "-" + String(eventCounter);
}

bool publishJson(const String &mqttTopic, JsonDocument &doc) {
  char payload[1536];
  size_t length = serializeJson(doc, payload, sizeof(payload));
  return length > 0 &&
         mqtt.publish(mqttTopic.c_str(), (uint8_t *)payload, length, false);
}

void setPreviewCameraMode() {
  sensor_t *sensor = esp_camera_sensor_get();
  if (!sensor) return;
  sensor->set_framesize(sensor, PREVIEW_FRAME_SIZE);
  sensor->set_quality(sensor, PREVIEW_JPEG_QUALITY);
}

void setAnprCameraMode() {
  sensor_t *sensor = esp_camera_sensor_get();
  if (!sensor) return;
  sensor->set_framesize(sensor, psramFound() ? ANPR_FRAME_SIZE : FRAMESIZE_SVGA);
  sensor->set_quality(sensor, psramFound() ? ANPR_JPEG_QUALITY : 12);
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
    config.frame_size = ANPR_FRAME_SIZE;
    config.jpeg_quality = ANPR_JPEG_QUALITY;
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

  cameraMutex = xSemaphoreCreateMutex();
  if (!cameraMutex) {
    Serial.println("[CAMERA] Cannot create camera mutex");
    return false;
  }

  // Correct top/bottom without mirroring lanes: EXIT stays left, ENTRY right.
  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor) {
    sensor->set_vflip(sensor, 1);
    sensor->set_hmirror(sensor, 0);
    sensor->set_exposure_ctrl(sensor, 1);
    sensor->set_aec2(sensor, 1);
    sensor->set_ae_level(sensor, -1);
    sensor->set_gain_ctrl(sensor, 1);
    sensor->set_contrast(sensor, 1);
    sensor->set_saturation(sensor, -1);
  }

  setPreviewCameraMode();
  Serial.printf(
    "[CAMERA] READY psram=%s preview=CIF/q%d anpr=%s/q%d\n",
    psramFound() ? "YES" : "NO",
    PREVIEW_JPEG_QUALITY,
    psramFound() ? "XGA" : "SVGA",
    psramFound() ? ANPR_JPEG_QUALITY : 12
  );
  Serial.println("[CAMERA] Orientation: vertical flip=ON horizontal mirror=OFF");
  Serial.printf("[CAMERA] Capture flash=%s, settle frames=%u\n",
                CAPTURE_FLASH_ENABLED ? "ON" : "OFF", ANPR_SETTLE_FRAMES);
  return true;
}

bool requestAuthorized(httpd_req_t *request) {
  size_t queryLength = httpd_req_get_url_query_len(request);
  if (queryLength == 0 || queryLength > 255) return false;

  char query[256];
  char token[128];
  if (httpd_req_get_url_query_str(request, query, sizeof(query)) != ESP_OK) {
    return false;
  }
  if (httpd_query_key_value(query, "token", token, sizeof(token)) != ESP_OK) {
    return false;
  }
  return strcmp(token, CAMERA_PREVIEW_TOKEN) == 0;
}

esp_err_t rejectUnauthorized(httpd_req_t *request) {
  httpd_resp_set_status(request, "401 Unauthorized");
  httpd_resp_set_type(request, "text/plain");
  return httpd_resp_send(request, "Unauthorized", HTTPD_RESP_USE_STRLEN);
}

esp_err_t previewJpegHandler(httpd_req_t *request) {
  if (!requestAuthorized(request)) return rejectUnauthorized(request);
  if (!cameraMutex ||
      xSemaphoreTake(cameraMutex, pdMS_TO_TICKS(2000)) != pdTRUE) {
    httpd_resp_set_status(request, "503 Service Unavailable");
    httpd_resp_set_type(request, "text/plain");
    return httpd_resp_send(request, "Camera busy", HTTPD_RESP_USE_STRLEN);
  }

  camera_fb_t *frame = esp_camera_fb_get();
  if (!frame) {
    xSemaphoreGive(cameraMutex);
    return httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR,
                               "Capture failed");
  }

  httpd_resp_set_type(request, "image/jpeg");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(request, "X-Framerate", "15");
  esp_err_t result =
    httpd_resp_send(request, (const char *)frame->buf, frame->len);
  esp_camera_fb_return(frame);
  xSemaphoreGive(cameraMutex);
  return result;
}

esp_err_t streamHandler(httpd_req_t *request) {
  if (!requestAuthorized(request)) return rejectUnauthorized(request);
  esp_err_t result = httpd_resp_set_type(request, STREAM_CONTENT_TYPE);
  if (result != ESP_OK) return result;
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");

  char partHeader[80];
  while (true) {
    if (!cameraMutex ||
        xSemaphoreTake(cameraMutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }

    camera_fb_t *frame = esp_camera_fb_get();
    if (!frame) {
      xSemaphoreGive(cameraMutex);
      result = ESP_FAIL;
      break;
    }

    size_t headerLength =
      snprintf(partHeader, sizeof(partHeader), STREAM_PART, frame->len);
    result = httpd_resp_send_chunk(request, STREAM_BOUNDARY,
                                   strlen(STREAM_BOUNDARY));
    if (result == ESP_OK) {
      result = httpd_resp_send_chunk(request, partHeader, headerLength);
    }
    if (result == ESP_OK) {
      result = httpd_resp_send_chunk(request, (const char *)frame->buf,
                                     frame->len);
    }
    esp_camera_fb_return(frame);
    xSemaphoreGive(cameraMutex);

    if (result != ESP_OK) break;
    vTaskDelay(pdMS_TO_TICKS(STREAM_FRAME_DELAY_MS));
  }
  return result;
}

bool startPreviewServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.max_uri_handlers = 4;
  config.lru_purge_enable = true;
  config.stack_size = 8192;

  if (httpd_start(&previewServer, &config) != ESP_OK) {
    Serial.println("[PREVIEW] Failed to start HTTP server");
    return false;
  }

  httpd_uri_t jpegUri = {};
  jpegUri.uri = "/preview.jpg";
  jpegUri.method = HTTP_GET;
  jpegUri.handler = previewJpegHandler;

  httpd_uri_t streamUri = {};
  streamUri.uri = "/stream";
  streamUri.method = HTTP_GET;
  streamUri.handler = streamHandler;

  if (httpd_register_uri_handler(previewServer, &jpegUri) != ESP_OK ||
      httpd_register_uri_handler(previewServer, &streamUri) != ESP_OK) {
    Serial.println("[PREVIEW] Failed to register HTTP handlers");
    httpd_stop(previewServer);
    previewServer = nullptr;
    return false;
  }

  Serial.printf("[PREVIEW] MJPEG http://%s/stream (protected)\n",
                WiFi.localIP().toString().c_str());
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
  (void)rawTopic;
  if (length >= 512 || capturePending || captureBusy) return;
  char json[512];
  memcpy(json, payload, length);
  json[length] = '\0';

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, json)) {
    Serial.println("[CAMERA] Invalid capture request JSON");
    return;
  }

  String eventId = String((const char *)(doc["eventId"] | ""));
  String direction = String((const char *)(doc["direction"] | ""));
  if (!eventId.length() || (direction != "ENTRY" && direction != "EXIT")) {
    Serial.println("[CAMERA] Invalid capture request fields");
    return;
  }

  pendingEventId = eventId;
  pendingDirection = direction;
  capturePending = true;
  Serial.printf("[CAMERA] Request event=%s direction=%s\n",
                pendingEventId.c_str(), pendingDirection.c_str());
}

bool publishCameraResult(const String &imageUrl, const String &leftPlate,
                         const String &rightPlate) {
  StaticJsonDocument<1024> result;
  result["eventId"] = pendingEventId;
  result["direction"] = pendingDirection;
  result["imageUrl"] = imageUrl;
  result["leftPlate"] = leftPlate;
  result["rightPlate"] = rightPlate;
  return publishJson(topic("local/camera/result"), result);
}

String responseExcerpt(const String &body) {
  return body.length() <= 300 ? body : body.substring(0, 300) + "...";
}

void processCapture() {
  capturePending = false;
  captureBusy = true;
  Serial.printf("[CAMERA] Capturing event=%s direction=%s\n",
                pendingEventId.c_str(), pendingDirection.c_str());

  if (!cameraMutex ||
      xSemaphoreTake(cameraMutex, pdMS_TO_TICKS(3000)) != pdTRUE) {
    Serial.println("[CAMERA] Camera busy timeout");
    captureBusy = false;
    return;
  }

  setAnprCameraMode();
  // Changing CIF -> XGA needs several frames before AEC/AGC stabilizes.
  // Sending the first frame was the main cause of intermittent, overexposed OCR.
  delay(250);
  for (uint8_t index = 0; index < ANPR_SETTLE_FRAMES; index++) {
    camera_fb_t *stale = esp_camera_fb_get();
    if (stale) esp_camera_fb_return(stale);
    delay(70);
  }

  digitalWrite(FLASH_LED_PIN, CAPTURE_FLASH_ENABLED ? HIGH : LOW);
  if (CAPTURE_FLASH_ENABLED) delay(250);
  camera_fb_t *frame = esp_camera_fb_get();
  digitalWrite(FLASH_LED_PIN, LOW);

  if (!frame) {
    Serial.println("[CAMERA] Capture failed");
    setPreviewCameraMode();
    xSemaphoreGive(cameraMutex);
    captureBusy = false;
    return;
  }

  uint16_t width = frame->width;
  uint16_t height = frame->height;
  size_t imageLength = frame->len;
  Serial.printf("[CAMERA] JPEG %ux%u bytes=%u\n", width, height,
                (unsigned int)imageLength);

  if (USE_MOCK_ANPR) {
    esp_camera_fb_return(frame);
    setPreviewCameraMode();
    xSemaphoreGive(cameraMutex);
    bool published = publishCameraResult(
      String("mock://esp32-cam/") + pendingEventId + ".jpg",
      MOCK_LEFT_PLATE,
      MOCK_RIGHT_PLATE
    );
    Serial.printf("[ANPR] Mock event=%s published=%s\n",
                  pendingEventId.c_str(), published ? "YES" : "NO");
    captureBusy = false;
    return;
  }

  // Copy the OCR frame to PSRAM, then immediately return the camera to CIF.
  // The live MJPEG stream can continue while HTTPS and cloud OCR are running.
  uint8_t *imageBuffer = (uint8_t *)heap_caps_malloc(
    imageLength, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
  );
  if (!imageBuffer) imageBuffer = (uint8_t *)malloc(imageLength);
  if (!imageBuffer) {
    Serial.println("[CAMERA] Cannot allocate OCR image buffer");
    esp_camera_fb_return(frame);
    setPreviewCameraMode();
    xSemaphoreGive(cameraMutex);
    captureBusy = false;
    return;
  }
  memcpy(imageBuffer, frame->buf, imageLength);
  esp_camera_fb_return(frame);
  setPreviewCameraMode();
  xSemaphoreGive(cameraMutex);

  WiFiClientSecure secureClient;
  secureClient.setInsecure();
  HTTPClient http;
  http.setTimeout(30000);
  int statusCode = -1;
  String response;

  if (http.begin(secureClient, ANPR_URL)) {
    http.addHeader("Content-Type", "image/jpeg");
    http.addHeader("X-Device-Key", ANPR_DEVICE_KEY);
    http.addHeader("X-Event-Id", pendingEventId);
    http.addHeader("X-Direction", pendingDirection);
    http.addHeader("X-Image-Width", String(width));
    http.addHeader("X-Image-Height", String(height));
    statusCode = http.POST(imageBuffer, imageLength);
    if (statusCode != 0) response = http.getString();
    http.end();
  } else {
    Serial.println("[ANPR] Cannot open HTTPS connection");
  }

  free(imageBuffer);

  if (statusCode < 200 || statusCode >= 300) {
    Serial.printf("[ANPR] HTTP error=%d body=%s\n", statusCode,
                  responseExcerpt(response).c_str());
    captureBusy = false;
    return;
  }

  StaticJsonDocument<1536> anpr;
  if (deserializeJson(anpr, response)) {
    Serial.printf("[ANPR] Invalid JSON body=%s\n",
                  responseExcerpt(response).c_str());
    captureBusy = false;
    return;
  }

  bool published = publishCameraResult(
    String((const char *)(anpr["imageUrl"] | "")),
    String((const char *)(anpr["leftPlate"] | "")),
    String((const char *)(anpr["rightPlate"] | ""))
  );
  Serial.printf("[ANPR] Result event=%s plate=%s published=%s\n",
                pendingEventId.c_str(),
                String((const char *)(anpr["recognizedPlate"] | "")).c_str(),
                published ? "YES" : "NO");
  captureBusy = false;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[WiFi] IP: %s RSSI=%d dBm sleep=OFF\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

void connectMqtt() {
  if (mqtt.connected() || millis() - lastMqttAttemptAt < 2000) return;
  lastMqttAttemptAt = millis();

  String clientId = "esp32-camera-" +
                    String((uint32_t)ESP.getEfuseMac(), HEX);
  bool connected = strlen(MQTT_USERNAME)
    ? mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)
    : mqtt.connect(clientId.c_str());

  if (connected) {
    bool subscribed = mqtt.subscribe(topic("local/camera/capture").c_str(), 1);
    Serial.printf("[MQTT] Connected client=%s subscribed=%s keepAlive=60s\n",
                  clientId.c_str(), subscribed ? "YES" : "NO");
    publishHeartbeat();
  } else {
    Serial.printf("[MQTT] Failed state=%d; retrying...\n", mqtt.state());
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== ESP32-CAM SMART PARKING READY ===");
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  if (!initializeCamera()) {
    delay(3000);
    ESP.restart();
  }

  connectWifi();
  startPreviewServer();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(1536);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(15);
  connectMqtt();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiAttemptAt >= 5000) {
      lastWifiAttemptAt = millis();
      Serial.println("[WiFi] Disconnected; reconnecting...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
    delay(20);
    return;
  }

  connectMqtt();
  mqtt.loop();

  if (capturePending) processCapture();

  if (mqtt.connected() && millis() - lastHeartbeatAt >= 15000) {
    lastHeartbeatAt = millis();
    publishHeartbeat();
  }
  delay(5);
}
