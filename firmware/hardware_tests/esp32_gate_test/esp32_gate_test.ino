/*
 * TEST PHAN CUNG ESP32 GATE - KHONG WIFI, MQTT, BACKEND HOAC CAMERA
 * Board: ESP32 Dev Module. Thu vien: ESP32Servo, MFRC522.
 */

#include <SPI.h>
#include <MFRC522.h>
#include <ESP32Servo.h>


const uint8_t ENTRY_SENSOR_PIN = 21;
const uint8_t EXIT_SENSOR_PIN = 22;
const uint8_t ENTRY_SERVO_PIN = 25;
const uint8_t EXIT_SERVO_PIN = 26;
const uint8_t RFID_SS_PIN = 5;
const uint8_t RFID_RST_UNUSED = 0xFF;

const int CLOSED_ANGLE = 0;
const int OPEN_ANGLE = 90;
const unsigned long SENSOR_DEBOUNCE_MS = 60;
const unsigned long CLOSE_DELAY_MS = 1500;
const unsigned long MANUAL_OPEN_MS = 2000;

Servo entryServo;
Servo exitServo;
MFRC522 rfid(RFID_SS_PIN, RFID_RST_UNUSED);

struct GateState {
  bool lastRawDetected = false;
  bool stableDetected = false;
  bool isOpen = false;
  unsigned long rawChangedAt = 0;
  unsigned long clearedAt = 0;
  unsigned long manualOpenUntil = 0;
};

GateState entryState;
GateState exitState;

void setGate(const char *name, Servo &servo, GateState &state, bool open) {
  if (state.isOpen == open) return;
  state.isOpen = open;
  servo.write(open ? OPEN_ANGLE : CLOSED_ANGLE);
  Serial.printf("[%s SERVO] %s (%d degrees)\n", name,
                open ? "OPEN" : "CLOSED", open ? OPEN_ANGLE : CLOSED_ANGLE);
}

void initializeGateState(uint8_t sensorPin, GateState &state) {
  bool detected = digitalRead(sensorPin) == LOW;
  state.lastRawDetected = detected;
  state.stableDetected = detected;
  state.rawChangedAt = millis();
  state.clearedAt = millis();
}

void handleGate(const char *name, uint8_t sensorPin, Servo &servo, GateState &state) {
  unsigned long now = millis();
  bool rawDetected = digitalRead(sensorPin) == LOW;

  if (rawDetected != state.lastRawDetected) {
    state.lastRawDetected = rawDetected;
    state.rawChangedAt = now;
  }

  if (rawDetected != state.stableDetected &&
      now - state.rawChangedAt >= SENSOR_DEBOUNCE_MS) {
    state.stableDetected = rawDetected;
    Serial.printf("[%s SENSOR] %s\n", name,
                  rawDetected ? "DETECTED" : "CLEAR");

    if (rawDetected) {
      state.manualOpenUntil = 0;
      setGate(name, servo, state, true);
    } else {
      state.clearedAt = now;
    }
  }

  bool manualStillActive = state.manualOpenUntil != 0 &&
                           (long)(state.manualOpenUntil - now) > 0;
  if (state.isOpen && !state.stableDetected && !manualStillActive &&
      now - state.clearedAt >= CLOSE_DELAY_MS) {
    state.manualOpenUntil = 0;
    setGate(name, servo, state, false);
  }
}

void openManually(const char *name, Servo &servo, GateState &state) {
  state.manualOpenUntil = millis() + MANUAL_OPEN_MS;
  state.clearedAt = millis();
  setGate(name, servo, state, true);
}

void printUid() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  Serial.print("[RFID] UID=");
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) Serial.print('0');
    Serial.print(rfid.uid.uidByte[i], HEX);
  }
  Serial.println();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

void printStatus() {
  Serial.printf("[STATUS] entrySensor=%s entryServo=%s | exitSensor=%s exitServo=%s\n",
                entryState.stableDetected ? "DETECTED" : "CLEAR",
                entryState.isOpen ? "OPEN" : "CLOSED",
                exitState.stableDetected ? "DETECTED" : "CLEAR",
                exitState.isOpen ? "OPEN" : "CLOSED");
}

void handleSerialCommand() {
  if (!Serial.available()) return;
  char command = toupper(Serial.read());

  if (command == 'E') {
    Serial.println("[MANUAL] Entry servo test for 2 seconds");
    openManually("ENTRY", entryServo, entryState);
  } else if (command == 'X') {
    Serial.println("[MANUAL] Exit servo test for 2 seconds");
    openManually("EXIT", exitServo, exitState);
  } else if (command == 'C') {
    entryState.manualOpenUntil = 0;
    exitState.manualOpenUntil = 0;
    setGate("ENTRY", entryServo, entryState, false);
    setGate("EXIT", exitServo, exitState, false);
  } else if (command == 'S') {
    printStatus();
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
  entryServo.write(CLOSED_ANGLE);
  exitServo.write(CLOSED_ANGLE);

  initializeGateState(ENTRY_SENSOR_PIN, entryState);
  initializeGateState(EXIT_SENSOR_PIN, exitState);

  SPI.begin(18, 19, 23, RFID_SS_PIN);
  rfid.PCD_Init();
  byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);

  Serial.println();
  Serial.println("=== ESP32 GATE HARDWARE TEST READY ===");
  Serial.println("Sensor entry=GPIO21, exit=GPIO22; active LOW");
  Serial.println("Servo entry=GPIO25, exit=GPIO26; CLOSED=0, OPEN=90");
  Serial.println("Commands: E=entry servo, X=exit servo, C=close both, S=status");
  Serial.printf("[RFID] Firmware Version=0x%02X\n", version);
  if (version == 0x00 || version == 0xFF) {
    Serial.println("[RFID] ERROR: Check RC522 wiring and 3.3V power");
  } else {
    Serial.println("[RFID] READY: Place a card near the reader");
  }
  printStatus();
}

void loop() {
  handleGate("ENTRY", ENTRY_SENSOR_PIN, entryServo, entryState);
  handleGate("EXIT", EXIT_SENSOR_PIN, exitServo, exitState);
  printUid();
  handleSerialCommand();
  delay(5);
}
