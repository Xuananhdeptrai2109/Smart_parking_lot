/* WIRE LEVEL TEST - ARDUINO UNO: D6 alternates HIGH/LOW every second. */

const uint8_t ESP_TX_PIN = 6;
const unsigned long SEND_INTERVAL_MS = 1000;

unsigned long lastSentAt = 0;
bool outputHigh = true;

void setup() {
  Serial.begin(115200);
  pinMode(ESP_TX_PIN, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(ESP_TX_PIN, HIGH);
  digitalWrite(LED_BUILTIN, HIGH);

  Serial.println("=== ARDUINO D6 WIRE LEVEL TEST ===");
  Serial.println("D6 alternates HIGH/LOW once per second");
}

void loop() {
  unsigned long now = millis();
  if (now - lastSentAt >= SEND_INTERVAL_MS) {
    lastSentAt = now;
    outputHigh = !outputHigh;
    digitalWrite(ESP_TX_PIN, outputHigh ? HIGH : LOW);
    digitalWrite(LED_BUILTIN, outputHigh ? HIGH : LOW);
    Serial.println(outputHigh ? "[WIRE] D6=HIGH" : "[WIRE] D6=LOW");
  }
}
