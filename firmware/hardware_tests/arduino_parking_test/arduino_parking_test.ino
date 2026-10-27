/*
 * TEST PHAN CUNG BAI DO - KHONG CAN ESP32, MQTT HOAC BACKEND
 * Board: Arduino Uno. Moi LED phai co mot dien tro 220R rieng.
 */

const uint8_t SPOT_COUNT = 4;
const uint8_t SENSOR_PINS[SPOT_COUNT] = {2, 3, 4, 5};
const uint8_t RED_PINS[SPOT_COUNT] = {7, 8, 9, 10};
const uint8_t GREEN_PINS[SPOT_COUNT] = {12, 13, A0, A1};

const unsigned long SENSOR_DEBOUNCE_MS = 60;
const unsigned long STATUS_INTERVAL_MS = 5000;

bool lastRawOccupied[SPOT_COUNT];
bool stableOccupied[SPOT_COUNT];
unsigned long rawChangedAt[SPOT_COUNT];
unsigned long lastStatusAt = 0;

void setSpotLeds(uint8_t index, bool occupied) {
  digitalWrite(RED_PINS[index], occupied ? HIGH : LOW);
  digitalWrite(GREEN_PINS[index], occupied ? LOW : HIGH);
}

void allLeds(bool redOn, bool greenOn) {
  for (uint8_t i = 0; i < SPOT_COUNT; i++) {
    digitalWrite(RED_PINS[i], redOn ? HIGH : LOW);
    digitalWrite(GREEN_PINS[i], greenOn ? HIGH : LOW);
  }
}

void runLedSelfTest() {
  Serial.println(F("[LED TEST] All RED LEDs ON"));
  allLeds(true, false);
  delay(800);
  Serial.println(F("[LED TEST] All GREEN LEDs ON"));
  allLeds(false, true);
  delay(800);
  Serial.println(F("[LED TEST] All LEDs OFF"));
  allLeds(false, false);
  delay(400);
  for (uint8_t i = 0; i < SPOT_COUNT; i++) setSpotLeds(i, stableOccupied[i]);
}

void printStatus() {
  uint8_t occupiedCount = 0;
  Serial.print(F("[STATUS] "));
  for (uint8_t i = 0; i < SPOT_COUNT; i++) {
    if (stableOccupied[i]) occupiedCount++;
    Serial.print('A');
    Serial.print(i + 1);
    Serial.print('=');
    Serial.print(stableOccupied[i] ? F("OCCUPIED") : F("FREE"));
    if (i + 1 < SPOT_COUNT) Serial.print(F(" | "));
  }
  Serial.print(F(" | free="));
  Serial.println(SPOT_COUNT - occupiedCount);
}

void handleSensors() {
  unsigned long now = millis();
  for (uint8_t i = 0; i < SPOT_COUNT; i++) {
    bool rawOccupied = digitalRead(SENSOR_PINS[i]) == LOW;
    if (rawOccupied != lastRawOccupied[i]) {
      lastRawOccupied[i] = rawOccupied;
      rawChangedAt[i] = now;
    }
    if (rawOccupied != stableOccupied[i] &&
        now - rawChangedAt[i] >= SENSOR_DEBOUNCE_MS) {
      stableOccupied[i] = rawOccupied;
      setSpotLeds(i, rawOccupied);
      Serial.print(F("[SPOT] A"));
      Serial.print(i + 1);
      Serial.println(rawOccupied ? F(" OCCUPIED -> RED") : F(" FREE -> GREEN"));
    }
  }
}

void handleSerialCommand() {
  if (!Serial.available()) return;
  char command = toupper(Serial.read());
  if (command == 'T') runLedSelfTest();
  if (command == 'S') printStatus();
}

void setup() {
  Serial.begin(9600);
  for (uint8_t i = 0; i < SPOT_COUNT; i++) {
    pinMode(SENSOR_PINS[i], INPUT_PULLUP);
    pinMode(RED_PINS[i], OUTPUT);
    pinMode(GREEN_PINS[i], OUTPUT);
    bool occupied = digitalRead(SENSOR_PINS[i]) == LOW;
    lastRawOccupied[i] = occupied;
    stableOccupied[i] = occupied;
    rawChangedAt[i] = millis();
  }
  Serial.println(F("=== ARDUINO PARKING HARDWARE TEST READY ==="));
  Serial.println(F("Commands: T=repeat LED test, S=status"));
  runLedSelfTest();
  printStatus();
}

void loop() {
  handleSensors();
  handleSerialCommand();
  if (millis() - lastStatusAt >= STATUS_INTERVAL_MS) {
    lastStatusAt = millis();
    printStatus();
  }
  delay(5);
}
