# Hardware protocol

All sensor values use JSON. Every event must contain a globally unique `eventId`; retrying the same event is safe because the backend processes it only once. All timestamps use ISO 8601 UTC.

## Camera orientation

The shared ESP32-CAM image is interpreted as follows:

- Left half: exit lane license plate.
- Right half: entry lane license plate.

License-plate recognition should run on the edge gateway or a dedicated ANPR service. The backend receives the recognized text and stores the original image URL for auditing.

## MQTT topics

Default prefix: `smart-parking`.

### Active device allocation

The current hardware uses two independent ESP32 DevKit controllers:

| Node | Responsibilities | MQTT subscriptions |
|---|---|---|
| `ESP32_GATE_CONTROLLER` | Entry/exit sensors, RC522, two barrier servos, ESP32-CAM coordination and Arduino parking UART bridge | `local/camera/result`, `commands/gate/+`, `commands/led/+` |
| `ESP32_FIRE_CONTROLLER` | Four flame sensors, gas sensor, two nozzle servos, buzzer relay, pump relay and emergency stop | `commands/fire/+` |
| `ESP32_CAMERA` | Capture/ANPR request handling | `local/camera/capture` |

Each ESP32 uses a unique MQTT client ID derived from its chip ID. The gate controller must not subscribe to fire commands, and the fire controller must not subscribe to gate/parking commands. This separation prevents a reset or fault in one controller from stopping the other subsystem.

### Device to backend

| Topic | Purpose |
|---|---|
| `smart-parking/events/gate/entry/request` | Entry sensor + right image plate + RFID card |
| `smart-parking/events/gate/exit/request` | Exit sensor + left image plate + RFID card |
| `smart-parking/events/gate/state` | Barrier servo state after opening/closing |
| `smart-parking/events/parking/spot/state` | Obstacle sensor state |
| `smart-parking/events/fire/snapshot` | Four flame readings and gas reading |
| `smart-parking/events/command/ack` | Device command acknowledgement |
| `smart-parking/events/device/heartbeat` | Device health heartbeat |

### Backend to device

| Topic pattern | Purpose |
|---|---|
| `smart-parking/commands/gate/{servoDeviceCode}` | Open/close a gate servo |
| `smart-parking/commands/led/{ledDeviceCode}` | Set parking LED red/green |
| `smart-parking/commands/fire/{deviceCode}` | Buzzer, two-servo aim or pump relay command |
| `smart-parking/state/parking-lot` | Retained aggregate parking state |

Use MQTT QoS 1. Device firmware must deduplicate commands using `commandId`.

Gate state feedback example:

```json
{
  "eventId": "gate-state-000001",
  "occurredAt": "2026-10-04T10:00:05.000Z",
  "gateCode": "ENTRY_GATE",
  "deviceCode": "GATE_ENTRY_SERVO",
  "state": "CLOSED",
  "passageEventId": "entry-000001"
}
```

When `state=CLOSED`, `passageEventId` marks the corresponding passage as completed.

## Entry request

```json
{
  "eventId": "entry-000001",
  "occurredAt": "2026-10-04T10:00:00.000Z",
  "rfidUid": "CARD001",
  "vehicleType": "CAR",
  "cameraDeviceCode": "CAMERA_MAIN",
  "imageUrl": "https://storage.example/entry-000001.jpg",
  "rightPlate": "30A-123.45"
}
```

The backend denies entry when there is an active fire incident, no free spot, the RFID card is unavailable, or the vehicle already has an active session. An allowed request reserves one parking spot and opens the entry barrier.

## Exit request

```json
{
  "eventId": "exit-000001",
  "occurredAt": "2026-10-04T11:00:00.000Z",
  "rfidUid": "CARD001",
  "cameraDeviceCode": "CAMERA_MAIN",
  "imageUrl": "https://storage.example/exit-000001.jpg",
  "leftPlate": "30A-123.45"
}
```

The card must belong to an active parking session and the exit plate must match the entry plate. Full-lot state never blocks the exit lane.

## Parking spot event

```json
{
  "eventId": "spot-a1-000001",
  "occurredAt": "2026-10-04T10:05:00.000Z",
  "spotName": "A1",
  "occupied": true,
  "distanceCm": 7.5
}
```

`occupied=true` sets the spot to `OCCUPIED` and its red LED turns on. A free spot uses the separate green LED. The four seeded spots are `A1` through `A4`.

## Fire snapshot

The dedicated ESP32 Fire controller normalizes all analog readings to `0..1`; higher values mean stronger detection.

```json
{
  "eventId": "fire-000001",
  "occurredAt": "2026-10-04T10:10:00.000Z",
  "flameNW": 0.9,
  "flameNE": 0.4,
  "flameSW": 0.2,
  "flameSE": 0.1,
  "gasLevel": 0.75
}
```

Coordinates use a 5x5 grid: `SW=(0,0)`, `SE=(4,0)`, `NW=(0,4)`, `NE=(4,4)`. The backend estimates a weighted coordinate and maps it to calibrated pan/tilt servo angles.

Fire sequence:

1. Activate buzzer and evacuation gate mode.
2. Send `AIM_SERVOS` to the fire servo controller.
3. Wait for a successful acknowledgement.
4. Send `PUMP_ON` with a maximum local run time.
5. A manual resolve command sends `PUMP_OFF`, `BUZZER_OFF` and exits evacuation mode.

Acknowledgement payload:

```json
{
  "commandId": "uuid-from-backend",
  "success": true
}
```

The local fire controller must independently enforce servo limits, relay interlocks, pump maximum run time, emergency stop and offline detection. Cloud/backend logic is not a substitute for certified fire-control hardware.

## Command outbox

Every outgoing hardware command is stored in `DeviceCommand` before MQTT publish. Commands remain `PENDING` while the broker is offline and are retried every five seconds after reconnection. Device acknowledgement changes the command to `ACKNOWLEDGED` or `FAILED`.
