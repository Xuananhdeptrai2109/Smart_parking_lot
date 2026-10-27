/*
 * SMART PARKING - TEST 2 CAM BIEN CONG VA 2 SERVO
 *
 * Phan cung:
 * - Cam bien vao  (LM393 OUT qua chia ap) -> GPIO21
 * - Cam bien ra   (LM393 OUT qua chia ap) -> GPIO22
 * - Servo cong vao, day tin hieu          -> GPIO25
 * - Servo cong ra, day tin hieu           -> GPIO26
 *
 * Hoat dong:
 * - Cam bien nao phat hien vat can, servo tuong ung quay tu 0 do den 90 do.
 * - Khi vat can roi khoi cam bien, doi 1,5 giay roi servo quay ve 0 do.
 * - Khong can Wi-Fi, MQTT, RC522, ESP32-CAM hoac backend.
 *
 * Thu vien Arduino IDE can cai: ESP32Servo
 * Board: ESP32 Dev Module
 */

#include <ESP32Servo.h>

// ==================== PIN MAP ====================
const uint8_t ENTRY_SENSOR_PIN = 21;
const uint8_t EXIT_SENSOR_PIN = 22;
const uint8_t ENTRY_SERVO_PIN = 25;
const uint8_t EXIT_SERVO_PIN = 26;

// Phan lon module LM393 xuat LOW khi phat hien vat can.
// Neu module cua ban hoat dong nguoc, doi LOW thanh HIGH.
const uint8_t SENSOR_ACTIVE_LEVEL = LOW;

const int GATE_CLOSED_ANGLE = 0;
const int GATE_OPEN_ANGLE = 90;
const unsigned long SENSOR_DEBOUNCE_MS = 80;
const unsigned long GATE_CLOSE_DELAY_MS = 1500;

Servo entryServo;
Servo exitServo;

struct GateState {
  const char *name;
  uint8_t sensorPin;
  Servo *servo;
  bool rawDetected;
  bool stableDetected;
  bool opened;
  unsigned long rawChangedAt;
  unsigned long clearStartedAt;
};

GateState entryGate = {
  "ENTRY", ENTRY_SENSOR_PIN, &entryServo,
  false, false, false, 0, 0
};

GateState exitGate = {
  "EXIT", EXIT_SENSOR_PIN, &exitServo,
  false, false, false, 0, 0
};

bool sensorDetected(uint8_t pin) {
  return digitalRead(pin) == SENSOR_ACTIVE_LEVEL;
}

void openGate(GateState &gate) {
  if (gate.opened) return;

  gate.servo->write(GATE_OPEN_ANGLE);
  gate.opened = true;
  Serial.printf("[%s] Sensor detected -> servo OPEN %d degrees\n",
                gate.name, GATE_OPEN_ANGLE);
}

void closeGate(GateState &gate) {
  if (!gate.opened) return;

  gate.servo->write(GATE_CLOSED_ANGLE);
  gate.opened = false;
  Serial.printf("[%s] Sensor clear -> servo CLOSED %d degrees\n",
                gate.name, GATE_CLOSED_ANGLE);
}

void updateGate(GateState &gate, unsigned long now) {
  bool detected = sensorDetected(gate.sensorPin);

  // Loc rung tin hieu cua cam bien.
  if (detected != gate.rawDetected) {
    gate.rawDetected = detected;
    gate.rawChangedAt = now;
  }

  if (gate.rawDetected != gate.stableDetected &&
      now - gate.rawChangedAt >= SENSOR_DEBOUNCE_MS) {
    gate.stableDetected = gate.rawDetected;

    if (gate.stableDetected) {
      openGate(gate);
    } else {
      gate.clearStartedAt = now;
      Serial.printf("[%s] Sensor no longer detects an object\n", gate.name);
    }
  }

  // Chi dong khi cam bien da het phat hien lien tuc du thoi gian cho.
  if (gate.opened && !gate.stableDetected &&
      now - gate.clearStartedAt >= GATE_CLOSE_DELAY_MS) {
    closeGate(gate);
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(ENTRY_SENSOR_PIN, INPUT_PULLUP);
  pinMode(EXIT_SENSOR_PIN, INPUT_PULLUP);

  entryServo.setPeriodHertz(50);
  exitServo.setPeriodHertz(50);
  entryServo.attach(ENTRY_SERVO_PIN, 500, 2400);
  exitServo.attach(EXIT_SERVO_PIN, 500, 2400);

  // Luon khoi dong o trang thai dong.
  entryServo.write(GATE_CLOSED_ANGLE);
  exitServo.write(GATE_CLOSED_ANGLE);

  unsigned long now = millis();
  entryGate.rawDetected = sensorDetected(ENTRY_SENSOR_PIN);
  exitGate.rawDetected = sensorDetected(EXIT_SENSOR_PIN);
  entryGate.rawChangedAt = now;
  exitGate.rawChangedAt = now;
  entryGate.clearStartedAt = now;
  exitGate.clearStartedAt = now;

  Serial.println("=== GATE SENSOR + SERVO TEST READY ===");
  Serial.println("GPIO21: entry sensor, GPIO22: exit sensor");
  Serial.println("GPIO25: entry servo,  GPIO26: exit servo");
}

void loop() {
  unsigned long now = millis();
  updateGate(entryGate, now);
  updateGate(exitGate, now);
  delay(5);
}
