/*
 * SMART PARKING - GATE SENSOR + SERVO TEST
 *
 * Sensor-only flow:
 *   sensor detected -> open matching servo -> sensor clear -> close servo
 *
 * Board: DOIT ESP32 DEVKIT V1
 * Libraries: ESP32Servo, MFRC522
 */

#include <SPI.h>
#include <MFRC522.h>
#include <ESP32Servo.h>

// ==================== PIN MAP ====================
const uint8_t ENTRY_SENSOR_PIN = 21;
const uint8_t EXIT_SENSOR_PIN = 22;
const uint8_t ENTRY_SERVO_PIN = 27;
const uint8_t EXIT_SERVO_PIN = 26;

// RC522: SDA/SS=GPIO5, SCK=18, MISO=19, MOSI=23, RST tied to 3V3.
const uint8_t RFID_SS_PIN = 5;
const uint8_t RFID_RST_UNUSED = 0xFF;

// ==================== TEST SETTINGS ====================
const char *MOCK_LICENSE_PLATE = "30A-123.45";
const bool SENSOR_ONLY_MODE = true;
const int CLOSED_ANGLE = 0;
const int OPEN_ANGLE = 90;
const int SERVO_MIN_PULSE_US = 600;
const int SERVO_MAX_PULSE_US = 2300;

const unsigned long SENSOR_DEBOUNCE_MS = 100;
const unsigned long RFID_TIMEOUT_MS = 30000;
const unsigned long MIN_OPEN_MS = 1500;
const unsigned long CLOSE_AFTER_CLEAR_MS = 1200;
const unsigned long MANUAL_OPEN_MS = 2000;
const unsigned long SERVO_MOVE_TIME_MS = 900;

const char *VALID_UIDS[] = {
  "A9FB4420",
  "27B828B0",
  "577231B0",
  "17C32AB0",
  "27A437B0"
};
const size_t CARD_COUNT = sizeof(VALID_UIDS) / sizeof(VALID_UIDS[0]);

Servo entryServo;
Servo exitServo;
MFRC522 rfid(RFID_SS_PIN, RFID_RST_UNUSED);

enum FlowDirection : uint8_t {
  FLOW_NONE,
  FLOW_ENTRY,
  FLOW_EXIT
};

struct GateState {
  bool rawDetected = false;
  bool stableDetected = false;
  bool sensorArmed = false;
  bool isOpen = false;
  unsigned long rawChangedAt = 0;
  unsigned long clearedAt = 0;
  unsigned long openedAt = 0;
  unsigned long manualOpenUntil = 0;
  unsigned long detachAt = 0;
};

struct PendingFlow {
  FlowDirection direction = FLOW_NONE;
  unsigned long startedAt = 0;
};

GateState entryState;
GateState exitState;
PendingFlow pendingFlow;

// Local test session: true means this card successfully entered and may exit.
bool cardInside[CARD_COUNT] = { false };

const char *directionName(FlowDirection direction) {
  if (direction == FLOW_ENTRY) return "ENTRY";
  if (direction == FLOW_EXIT) return "EXIT";
  return "NONE";
}

void setGate(const char *name, Servo &servo, GateState &state, bool open) {
  if (state.isOpen == open) return;

  if (!servo.attached()) {
    const uint8_t servoPin = strcmp(name, "ENTRY") == 0
      ? ENTRY_SERVO_PIN
      : EXIT_SERVO_PIN;
    servo.setPeriodHertz(50);
    servo.attach(servoPin, SERVO_MIN_PULSE_US, SERVO_MAX_PULSE_US);
  }

  state.isOpen = open;
  if (open) {
    state.openedAt = millis();
    servo.write(OPEN_ANGLE);
  } else {
    state.manualOpenUntil = 0;
    servo.write(CLOSED_ANGLE);
  }
  state.detachAt = millis() + SERVO_MOVE_TIME_MS;

  Serial.printf("[%s SERVO] %s angle=%d\n", name,
                open ? "OPEN" : "CLOSED",
                open ? OPEN_ANGLE : CLOSED_ANGLE);
}

void handleServoDetach(const char *name, Servo &servo, GateState &state) {
  if (!servo.attached() || state.detachAt == 0) return;
  if ((long)(millis() - state.detachAt) < 0) return;

  servo.detach();
  state.detachAt = 0;
  Serial.printf("[%s SERVO] Signal detached after movement (anti-hum)\n", name);
}

void resetPendingFlow(const char *reason) {
  if (pendingFlow.direction != FLOW_NONE) {
    Serial.printf("[FLOW] %s END: %s\n",
                  directionName(pendingFlow.direction), reason);
  }
  pendingFlow.direction = FLOW_NONE;
  pendingFlow.startedAt = 0;
}

void beginFlow(FlowDirection direction) {
  if (pendingFlow.direction != FLOW_NONE) {
    Serial.printf("[FLOW] Ignore %s; waiting for RFID on %s\n",
                  directionName(direction), directionName(pendingFlow.direction));
    return;
  }

  pendingFlow.direction = direction;
  pendingFlow.startedAt = millis();
  Serial.printf("[FLOW] %s START | MOCK PLATE=%s\n",
                directionName(direction), MOCK_LICENSE_PLATE);
  Serial.println("[FLOW] Scan a registered RFID card within 30 seconds");
}

void initializeGateState(uint8_t sensorPin, GateState &state) {
  bool detected = digitalRead(sensorPin) == LOW;
  state.rawDetected = detected;
  state.stableDetected = detected;
  state.sensorArmed = !detected;
  state.rawChangedAt = millis();
  state.clearedAt = millis();
}

void handleSensor(const char *name, FlowDirection direction, uint8_t sensorPin,
                  GateState &state) {
  unsigned long now = millis();
  bool detected = digitalRead(sensorPin) == LOW;

  if (detected != state.rawDetected) {
    state.rawDetected = detected;
    state.rawChangedAt = now;
  }

  if (state.rawDetected != state.stableDetected &&
      now - state.rawChangedAt >= SENSOR_DEBOUNCE_MS) {
    state.stableDetected = state.rawDetected;
    Serial.printf("[%s SENSOR] %s\n", name,
                  state.stableDetected ? "DETECTED" : "CLEAR");

    if (state.stableDetected) {
      if (state.sensorArmed) {
        if (SENSOR_ONLY_MODE) {
          if (direction == FLOW_ENTRY) {
            setGate("ENTRY", entryServo, entryState, true);
          } else {
            setGate("EXIT", exitServo, exitState, true);
          }
        } else {
          beginFlow(direction);
        }
      }
      state.sensorArmed = false;
    } else {
      state.sensorArmed = true;
      state.clearedAt = now;
    }
  }
}

void handleAutoClose(const char *name, Servo &servo, GateState &state) {
  if (!state.isOpen || state.stableDetected) return;

  unsigned long now = millis();
  bool manualStillActive = state.manualOpenUntil != 0 &&
                           (long)(state.manualOpenUntil - now) > 0;
  if (!manualStillActive &&
      now - state.openedAt >= MIN_OPEN_MS &&
      now - state.clearedAt >= CLOSE_AFTER_CLEAR_MS) {
    setGate(name, servo, state, false);
  }
}

String readRfidUid() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return "";

  String uid;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += '0';
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  return uid;
}

int findCardIndex(const String &uid) {
  for (size_t i = 0; i < CARD_COUNT; i++) {
    if (uid == VALID_UIDS[i]) return (int)i;
  }
  return -1;
}

void handleRfid() {
  String uid = readRfidUid();
  if (!uid.length()) return;

  Serial.printf("[RFID] UID=%s\n", uid.c_str());
  int cardIndex = findCardIndex(uid);
  if (cardIndex < 0) {
    Serial.println("[RFID] DENIED: Card is not registered");
    return;
  }

  if (pendingFlow.direction == FLOW_NONE) {
    Serial.println("[RFID] Card valid, but no sensor flow is waiting");
    return;
  }

  if (pendingFlow.direction == FLOW_ENTRY) {
    if (cardInside[cardIndex]) {
      Serial.println("[ACCESS] ENTRY DENIED: This card already has an active local session");
      return;
    }

    cardInside[cardIndex] = true;
    Serial.printf("[ACCESS] ENTRY ALLOWED | plate=%s | uid=%s\n",
                  MOCK_LICENSE_PLATE, uid.c_str());
    setGate("ENTRY", entryServo, entryState, true);
    resetPendingFlow("ENTRY SERVO OPENED");
    return;
  }

  if (!cardInside[cardIndex]) {
    Serial.println("[ACCESS] EXIT DENIED: Card has no active local entry session");
    return;
  }

  cardInside[cardIndex] = false;
  Serial.printf("[ACCESS] EXIT ALLOWED | plate=%s | uid=%s\n",
                MOCK_LICENSE_PLATE, uid.c_str());
  setGate("EXIT", exitServo, exitState, true);
  resetPendingFlow("EXIT SERVO OPENED");
}

void handlePendingTimeout() {
  if (pendingFlow.direction == FLOW_NONE) return;
  if (millis() - pendingFlow.startedAt < RFID_TIMEOUT_MS) return;

  Serial.printf("[ACCESS] %s DENIED: RFID timeout\n",
                directionName(pendingFlow.direction));
  resetPendingFlow("TIMEOUT");
}

void openManually(const char *name, Servo &servo, GateState &state) {
  state.manualOpenUntil = millis() + MANUAL_OPEN_MS;
  state.clearedAt = millis();
  setGate(name, servo, state, true);
}

void printStatus() {
  size_t activeCards = 0;
  for (size_t i = 0; i < CARD_COUNT; i++) {
    if (cardInside[i]) activeCards++;
  }

  Serial.printf("[STATUS] entrySensor=%s entryServo=%s | exitSensor=%s exitServo=%s | pending=%s | cardsInside=%u\n",
                entryState.stableDetected ? "DETECTED" : "CLEAR",
                entryState.isOpen ? "OPEN" : "CLOSED",
                exitState.stableDetected ? "DETECTED" : "CLEAR",
                exitState.isOpen ? "OPEN" : "CLOSED",
                directionName(pendingFlow.direction), (unsigned int)activeCards);
}

void handleSerialCommand() {
  if (!Serial.available()) return;
  char command = toupper(Serial.read());

  if (command == 'E') {
    Serial.println("[MANUAL] Entry servo opens for 2 seconds");
    openManually("ENTRY", entryServo, entryState);
  } else if (command == 'X') {
    Serial.println("[MANUAL] Exit servo opens for 2 seconds");
    openManually("EXIT", exitServo, exitState);
  } else if (command == 'C') {
    setGate("ENTRY", entryServo, entryState, false);
    setGate("EXIT", exitServo, exitState, false);
  } else if (command == 'R') {
    for (size_t i = 0; i < CARD_COUNT; i++) cardInside[i] = false;
    resetPendingFlow("LOCAL SESSIONS RESET");
    Serial.println("[TEST] All local card sessions cleared");
  } else if (command == 'S') {
    printStatus();
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(ENTRY_SENSOR_PIN, INPUT_PULLUP);
  pinMode(EXIT_SENSOR_PIN, INPUT_PULLUP);
  initializeGateState(ENTRY_SENSOR_PIN, entryState);
  initializeGateState(EXIT_SENSOR_PIN, exitState);

  // Khoi tao tung servo lan luot de tranh dong khoi dong cung luc.
  entryServo.setPeriodHertz(50);
  entryServo.attach(ENTRY_SERVO_PIN, SERVO_MIN_PULSE_US, SERVO_MAX_PULSE_US);
  entryServo.write(CLOSED_ANGLE);
  delay(SERVO_MOVE_TIME_MS);
  entryServo.detach();

  exitServo.setPeriodHertz(50);
  exitServo.attach(EXIT_SERVO_PIN, SERVO_MIN_PULSE_US, SERVO_MAX_PULSE_US);
  exitServo.write(CLOSED_ANGLE);
  delay(SERVO_MOVE_TIME_MS);
  exitServo.detach();

  SPI.begin(18, 19, 23, RFID_SS_PIN);
  rfid.PCD_Init();
  delay(100);
  byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);

  Serial.println();
  Serial.println("=== ESP32 GATE SENSOR + SERVO TEST READY ===");
  Serial.println("NO WiFi, MQTT, backend or ESP32-CAM");
  Serial.println("RFID is ignored while SENSOR_ONLY_MODE=true");
  Serial.println("ENTRY: sensor GPIO21 -> servo GPIO27");
  Serial.println("EXIT : sensor GPIO22 -> servo GPIO26");
  Serial.println("Servo CLOSED=0, OPEN=90; auto-detach after movement");
  Serial.println("Commands: E=entry servo, X=exit servo, C=close, R=reset sessions, S=status");
  Serial.printf("[RFID] Firmware Version=0x%02X\n", version);

  if (version == 0x00 || version == 0xFF) {
    Serial.println("[RFID] ERROR: Check RC522 wiring and 3.3V power");
  } else {
    Serial.printf("[RFID] READY: %u registered cards\n", (unsigned int)CARD_COUNT);
  }

  if (entryState.stableDetected || exitState.stableDetected) {
    Serial.println("[SENSOR] Clear both sensors once before starting a flow");
  }
  printStatus();
}

void loop() {
  handleSensor("ENTRY", FLOW_ENTRY, ENTRY_SENSOR_PIN, entryState);
  handleSensor("EXIT", FLOW_EXIT, EXIT_SENSOR_PIN, exitState);
  handleRfid();
  handlePendingTimeout();
  handleAutoClose("ENTRY", entryServo, entryState);
  handleAutoClose("EXIT", exitServo, exitState);
  handleServoDetach("ENTRY", entryServo, entryState);
  handleServoDetach("EXIT", exitServo, exitState);
  handleSerialCommand();
  delay(5);
}
