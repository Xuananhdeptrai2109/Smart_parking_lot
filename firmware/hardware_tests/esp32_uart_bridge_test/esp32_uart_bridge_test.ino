/* RX WIRE TEST - read Arduino D6 divider output on ESP32 GPIO32. */

#include <Arduino.h>

const uint8_t UNO_RX_PIN = 32;
unsigned long lastStatusAt = 0;
int lastRxLevel = -1;

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(UNO_RX_PIN, INPUT_PULLUP);

  Serial.println("=== ESP32 GPIO32 RX-ONLY WIRE TEST ===");
  Serial.println("Remove the GPIO17-GPIO32 loopback wire");
  Serial.println("Connect Arduino D6 divider output to GPIO32");
}

void loop() {
  int rxLevel = digitalRead(UNO_RX_PIN);
  if (rxLevel != lastRxLevel) {
    lastRxLevel = rxLevel;
    Serial.printf("[WIRE] GPIO32 changed to %s\n", rxLevel == HIGH ? "HIGH" : "LOW");
  }

  unsigned long now = millis();
  if (now - lastStatusAt >= 3000) {
    lastStatusAt = now;
    Serial.printf("[STATUS] GPIO32=%s\n",
                  digitalRead(UNO_RX_PIN) == HIGH ? "HIGH" : "LOW");
  }
  delay(2);
}
