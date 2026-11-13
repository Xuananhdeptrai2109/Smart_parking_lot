-- Smart Parking Lot - MySQL/Aiven initial schema and seed data
-- Generated from prisma/schema.prisma (Prisma 5.22.0).
-- Import into a NEW, EMPTY database. This file intentionally does not
-- CREATE DATABASE, DROP DATABASE, or store any connection credentials.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE `IncidentLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deviceId` INTEGER NOT NULL,
    `incidentType` ENUM('FIRE', 'FORCE_ENTRY', 'CONNECTION_LOST') NOT NULL,
    `severity` ENUM('LOW', 'MEDIUM', 'CRITICAL') NOT NULL,
    `timestamp` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `resolved` BOOLEAN NULL DEFAULT false,
    `notes` TEXT NULL,
    INDEX `deviceId`(`deviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IoTDevice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deviceCode` VARCHAR(100) NOT NULL,
    `type` ENUM('CAMERA', 'RFID_READER', 'OBSTACLE_SENSOR', 'FLAME_SENSOR', 'GAS_SENSOR', 'BARRIER_SERVO', 'NOZZLE_SERVO', 'STATUS_LED', 'BUZZER', 'WATER_PUMP', 'RELAY') NOT NULL,
    `ipAddress` VARCHAR(50) NULL,
    `location` VARCHAR(255) NOT NULL,
    `status` ENUM('ONLINE', 'OFFLINE', 'ERROR') NOT NULL DEFAULT 'ONLINE',
    `lastSeenAt` DATETIME(0) NULL,
    `metadata` JSON NULL,
    UNIQUE INDEX `IoTDevice_deviceCode_key`(`deviceCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DeviceEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` VARCHAR(100) NOT NULL,
    `deviceCode` VARCHAR(100) NOT NULL,
    `eventType` VARCHAR(100) NOT NULL,
    `payload` JSON NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `DeviceEvent_eventId_key`(`eventId`),
    INDEX `DeviceEvent_deviceCode_occurredAt_idx`(`deviceCode`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DeviceCommand` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `commandId` VARCHAR(100) NOT NULL,
    `domain` ENUM('ACCESS', 'PARKING', 'FIRE', 'SYSTEM') NOT NULL,
    `deviceCode` VARCHAR(100) NOT NULL,
    `topic` VARCHAR(255) NOT NULL,
    `commandType` VARCHAR(100) NOT NULL,
    `payload` JSON NOT NULL,
    `qos` INTEGER NOT NULL DEFAULT 1,
    `retained` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `failureReason` VARCHAR(255) NULL,
    UNIQUE INDEX `DeviceCommand_commandId_key`(`commandId`),
    INDEX `DeviceCommand_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `DeviceCommand_deviceCode_createdAt_idx`(`deviceCode`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Gate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `gateCode` VARCHAR(50) NOT NULL,
    `direction` ENUM('ENTRY', 'EXIT') NOT NULL,
    `sensorDeviceCode` VARCHAR(100) NOT NULL,
    `servoDeviceCode` VARCHAR(100) NOT NULL,
    `state` ENUM('CLOSED', 'OPENING', 'OPEN', 'CLOSING', 'BLOCKED', 'ERROR', 'EVACUATION') NOT NULL DEFAULT 'CLOSED',
    `openAngle` INTEGER NOT NULL DEFAULT 105,
    `closedAngle` INTEGER NOT NULL DEFAULT 15,
    `autoCloseMs` INTEGER NOT NULL DEFAULT 5000,
    `lastUpdated` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Gate_gateCode_key`(`gateCode`),
    UNIQUE INDEX `Gate_sensorDeviceCode_key`(`sensorDeviceCode`),
    UNIQUE INDEX `Gate_servoDeviceCode_key`(`servoDeviceCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GatePassageEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` VARCHAR(100) NOT NULL,
    `gateId` INTEGER NOT NULL,
    `direction` ENUM('ENTRY', 'EXIT') NOT NULL,
    `imageUrl` VARCHAR(500) NULL,
    `imageHalf` ENUM('LEFT', 'RIGHT') NOT NULL,
    `recognizedPlate` VARCHAR(50) NULL,
    `rfidUid` VARCHAR(100) NULL,
    `result` ENUM('PENDING', 'ALLOWED', 'DENIED', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
    `reason` VARCHAR(255) NULL,
    `sessionId` INTEGER NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `GatePassageEvent_eventId_key`(`eventId`),
    INDEX `GatePassageEvent_gateId_occurredAt_idx`(`gateId`, `occurredAt`),
    INDEX `GatePassageEvent_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CameraCapture` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` VARCHAR(100) NOT NULL,
    `deviceCode` VARCHAR(100) NOT NULL,
    `imageUrl` VARCHAR(500) NOT NULL,
    `leftPlate` VARCHAR(50) NULL,
    `rightPlate` VARCHAR(50) NULL,
    `capturedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `CameraCapture_eventId_key`(`eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AccessCard` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uid` VARCHAR(100) NOT NULL,
    `status` ENUM('AVAILABLE', 'ISSUED', 'LOST', 'DISABLED') NOT NULL DEFAULT 'AVAILABLE',
    `label` VARCHAR(100) NULL,
    `createdAt` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    UNIQUE INDEX `AccessCard_uid_key`(`uid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CardAssignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cardId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `returnedAt` DATETIME(3) NULL,
    UNIQUE INDEX `CardAssignment_sessionId_key`(`sessionId`),
    INDEX `CardAssignment_cardId_returnedAt_idx`(`cardId`, `returnedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MonthlyPass` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vehicleId` INTEGER NOT NULL,
    `startDate` DATETIME(0) NOT NULL,
    `endDate` DATETIME(0) NOT NULL,
    `isActive` BOOLEAN NULL DEFAULT true,
    UNIQUE INDEX `vehicleId`(`vehicleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ParkingSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vehicleId` INTEGER NULL,
    `assignedSpotId` INTEGER NULL,
    `entryTime` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `entryImage` VARCHAR(500) NOT NULL,
    `entryGate` VARCHAR(100) NOT NULL,
    `exitTime` DATETIME(0) NULL,
    `exitImage` VARCHAR(500) NULL,
    `exitGate` VARCHAR(100) NULL,
    `status` ENUM('ACTIVE', 'COMPLETED') NOT NULL DEFAULT 'ACTIVE',
    INDEX `vehicleId`(`vehicleId`),
    INDEX `ParkingSession_assignedSpotId_idx`(`assignedSpotId`),
    INDEX `ParkingSession_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ParkingSpot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `zoneId` INTEGER NOT NULL,
    `spotName` VARCHAR(50) NOT NULL,
    `sensorDeviceCode` VARCHAR(100) NOT NULL,
    `ledDeviceCode` VARCHAR(100) NOT NULL,
    `status` ENUM('FREE', 'RESERVED', 'OCCUPIED', 'MAINTENANCE') NOT NULL DEFAULT 'FREE',
    `lastDistanceCm` DOUBLE NULL,
    `lastUpdated` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ParkingSpot_sensorDeviceCode_key`(`sensorDeviceCode`),
    UNIQUE INDEX `ParkingSpot_ledDeviceCode_key`(`ledDeviceCode`),
    INDEX `zoneId`(`zoneId`),
    UNIQUE INDEX `ParkingSpot_zoneId_spotName_key`(`zoneId`, `spotName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SpotStateEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` VARCHAR(100) NOT NULL,
    `spotId` INTEGER NOT NULL,
    `occupied` BOOLEAN NOT NULL,
    `distanceCm` DOUBLE NULL,
    `status` ENUM('FREE', 'RESERVED', 'OCCUPIED', 'MAINTENANCE') NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `SpotStateEvent_eventId_key`(`eventId`),
    INDEX `SpotStateEvent_spotId_occurredAt_idx`(`spotId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Payment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` INTEGER NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `paymentMethod` ENUM('CASH', 'QR_SANDBOX', 'CREDIT_CARD', 'MOMO', 'VNPAY', 'MONTHLY_PASS') NULL,
    `paymentStatus` ENUM('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `provider` VARCHAR(50) NULL,
    `providerOrderId` VARCHAR(100) NULL,
    `providerTransactionId` VARCHAR(100) NULL,
    `checkoutToken` VARCHAR(100) NULL,
    `pricingDetails` JSON NULL,
    `expiresAt` DATETIME(3) NULL,
    `confirmedBy` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `transactionTime` DATETIME(0) NULL,
    UNIQUE INDEX `sessionId`(`sessionId`),
    UNIQUE INDEX `Payment_providerOrderId_key`(`providerOrderId`),
    UNIQUE INDEX `Payment_checkoutToken_key`(`checkoutToken`),
    INDEX `Payment_paymentStatus_createdAt_idx`(`paymentStatus`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FireIncident` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `status` ENUM('DETECTED', 'AIMING', 'SUPPRESSING', 'RESOLVED', 'FALSE_ALARM') NOT NULL DEFAULT 'DETECTED',
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `estimatedX` INTEGER NULL,
    `estimatedY` INTEGER NULL,
    `confidence` DOUBLE NULL,
    `gasLevel` DOUBLE NULL,
    `maxFlameIntensity` DOUBLE NULL,
    `horizontalAngle` INTEGER NULL,
    `verticalAngle` INTEGER NULL,
    `pumpStartedAt` DATETIME(3) NULL,
    `pumpStoppedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    INDEX `FireIncident_status_detectedAt_idx`(`status`, `detectedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FireDetectionSnapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` VARCHAR(100) NOT NULL,
    `incidentId` INTEGER NULL,
    `flameNW` DOUBLE NOT NULL,
    `flameNE` DOUBLE NOT NULL,
    `flameSW` DOUBLE NOT NULL,
    `flameSE` DOUBLE NOT NULL,
    `gasLevel` DOUBLE NOT NULL,
    `estimatedX` INTEGER NULL,
    `estimatedY` INTEGER NULL,
    `confidence` DOUBLE NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `FireDetectionSnapshot_eventId_key`(`eventId`),
    INDEX `FireDetectionSnapshot_incidentId_occurredAt_idx`(`incidentId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FireAction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `commandId` VARCHAR(100) NOT NULL,
    `incidentId` INTEGER NOT NULL,
    `actionType` ENUM('BUZZER_ON', 'BUZZER_OFF', 'AIM_SERVOS', 'PUMP_ON', 'PUMP_OFF', 'ENTER_EVACUATION', 'EXIT_EVACUATION') NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `payload` JSON NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `acknowledgedAt` DATETIME(3) NULL,
    `failureReason` VARCHAR(255) NULL,
    UNIQUE INDEX `FireAction_commandId_key`(`commandId`),
    INDEX `FireAction_incidentId_requestedAt_idx`(`incidentId`, `requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fullName` VARCHAR(255) NOT NULL,
    `phoneNumber` VARCHAR(20) NULL,
    `email` VARCHAR(255) NULL,
    `role` ENUM('ADMIN', 'MANAGER', 'CUSTOMER') NOT NULL,
    `createdAt` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    UNIQUE INDEX `phoneNumber`(`phoneNumber`),
    UNIQUE INDEX `email`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Vehicle` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `licensePlate` VARCHAR(50) NOT NULL,
    `vehicleType` ENUM('CAR', 'MOTORBIKE') NOT NULL,
    UNIQUE INDEX `licensePlate`(`licensePlate`),
    INDEX `userId`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Zone` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `zoneName` VARCHAR(100) NOT NULL,
    `capacity` INTEGER NOT NULL,
    UNIQUE INDEX `Zone_zoneName_key`(`zoneName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `IncidentLog` ADD CONSTRAINT `IncidentLog_ibfk_1`
    FOREIGN KEY (`deviceId`) REFERENCES `IoTDevice`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `DeviceEvent` ADD CONSTRAINT `DeviceEvent_deviceCode_fkey`
    FOREIGN KEY (`deviceCode`) REFERENCES `IoTDevice`(`deviceCode`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `GatePassageEvent` ADD CONSTRAINT `GatePassageEvent_gateId_fkey`
    FOREIGN KEY (`gateId`) REFERENCES `Gate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `GatePassageEvent` ADD CONSTRAINT `GatePassageEvent_sessionId_fkey`
    FOREIGN KEY (`sessionId`) REFERENCES `ParkingSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CardAssignment` ADD CONSTRAINT `CardAssignment_cardId_fkey`
    FOREIGN KEY (`cardId`) REFERENCES `AccessCard`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CardAssignment` ADD CONSTRAINT `CardAssignment_sessionId_fkey`
    FOREIGN KEY (`sessionId`) REFERENCES `ParkingSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MonthlyPass` ADD CONSTRAINT `MonthlyPass_ibfk_1`
    FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `ParkingSession` ADD CONSTRAINT `ParkingSession_ibfk_1`
    FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE `ParkingSession` ADD CONSTRAINT `ParkingSession_assignedSpotId_fkey`
    FOREIGN KEY (`assignedSpotId`) REFERENCES `ParkingSpot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ParkingSpot` ADD CONSTRAINT `ParkingSpot_ibfk_1`
    FOREIGN KEY (`zoneId`) REFERENCES `Zone`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `SpotStateEvent` ADD CONSTRAINT `SpotStateEvent_spotId_fkey`
    FOREIGN KEY (`spotId`) REFERENCES `ParkingSpot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_ibfk_1`
    FOREIGN KEY (`sessionId`) REFERENCES `ParkingSession`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `FireDetectionSnapshot` ADD CONSTRAINT `FireDetectionSnapshot_incidentId_fkey`
    FOREIGN KEY (`incidentId`) REFERENCES `FireIncident`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `FireAction` ADD CONSTRAINT `FireAction_incidentId_fkey`
    FOREIGN KEY (`incidentId`) REFERENCES `FireIncident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Vehicle` ADD CONSTRAINT `Vehicle_ibfk_1`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- Initial application data. These statements are safe to rerun after the
-- schema exists because all business keys are unique and updated in place.
START TRANSACTION;

INSERT INTO `IoTDevice` (`deviceCode`, `type`, `location`, `status`) VALUES
    ('CAMERA_MAIN', 'CAMERA', 'Camera ESP32-CAM dùng chung hai làn', 'OFFLINE'),
    ('RFID_ENTRY', 'RFID_READER', 'Bộ đọc/cấp thẻ tại cổng vào', 'OFFLINE'),
    ('RFID_EXIT', 'RFID_READER', 'Bộ đọc/thu thẻ tại cổng ra', 'OFFLINE'),
    ('GATE_ENTRY_SENSOR', 'OBSTACLE_SENSOR', 'Cảm biến xe cổng vào', 'OFFLINE'),
    ('GATE_EXIT_SENSOR', 'OBSTACLE_SENSOR', 'Cảm biến xe cổng ra', 'OFFLINE'),
    ('GATE_ENTRY_SERVO', 'BARRIER_SERVO', 'Servo 180 cửa vào', 'OFFLINE'),
    ('GATE_EXIT_SERVO', 'BARRIER_SERVO', 'Servo 180 cửa ra', 'OFFLINE'),
    ('SPOT_A1_SENSOR', 'OBSTACLE_SENSOR', 'Cảm biến ô A1', 'OFFLINE'),
    ('SPOT_A2_SENSOR', 'OBSTACLE_SENSOR', 'Cảm biến ô A2', 'OFFLINE'),
    ('SPOT_A3_SENSOR', 'OBSTACLE_SENSOR', 'Cảm biến ô A3', 'OFFLINE'),
    ('SPOT_A4_SENSOR', 'OBSTACLE_SENSOR', 'Cảm biến ô A4', 'OFFLINE'),
    ('SPOT_A1_LED', 'STATUS_LED', 'Cặp LED đỏ/xanh trạng thái ô A1', 'OFFLINE'),
    ('SPOT_A2_LED', 'STATUS_LED', 'Cặp LED đỏ/xanh trạng thái ô A2', 'OFFLINE'),
    ('SPOT_A3_LED', 'STATUS_LED', 'Cặp LED đỏ/xanh trạng thái ô A3', 'OFFLINE'),
    ('SPOT_A4_LED', 'STATUS_LED', 'Cặp LED đỏ/xanh trạng thái ô A4', 'OFFLINE'),
    ('FIRE_FLAME_NW', 'FLAME_SENSOR', 'Cảm biến lửa góc tây bắc', 'OFFLINE'),
    ('FIRE_FLAME_NE', 'FLAME_SENSOR', 'Cảm biến lửa góc đông bắc', 'OFFLINE'),
    ('FIRE_FLAME_SW', 'FLAME_SENSOR', 'Cảm biến lửa góc tây nam', 'OFFLINE'),
    ('FIRE_FLAME_SE', 'FLAME_SENSOR', 'Cảm biến lửa góc đông nam', 'OFFLINE'),
    ('FIRE_GAS', 'GAS_SENSOR', 'Cảm biến khí gas', 'OFFLINE'),
    ('FIRE_BUZZER', 'BUZZER', 'Còi báo cháy', 'OFFLINE'),
    ('FIRE_SERVO_HORIZONTAL', 'NOZZLE_SERVO', 'Servo xoay ngang vòi nước', 'OFFLINE'),
    ('FIRE_SERVO_VERTICAL', 'NOZZLE_SERVO', 'Servo xoay dọc vòi nước', 'OFFLINE'),
    ('FIRE_SERVO_CONTROLLER', 'NOZZLE_SERVO', 'ESP32 điều khiển hai servo PCCC', 'OFFLINE'),
    ('FIRE_PUMP', 'WATER_PUMP', 'Máy bơm nước', 'OFFLINE'),
    ('FIRE_PUMP_RELAY', 'RELAY', 'Relay điều khiển máy bơm', 'OFFLINE')
ON DUPLICATE KEY UPDATE
    `type` = VALUES(`type`),
    `location` = VALUES(`location`);

INSERT INTO `Gate`
    (`gateCode`, `direction`, `sensorDeviceCode`, `servoDeviceCode`, `state`, `openAngle`, `closedAngle`, `autoCloseMs`, `lastUpdated`)
VALUES
    ('ENTRY_GATE', 'ENTRY', 'GATE_ENTRY_SENSOR', 'GATE_ENTRY_SERVO', 'CLOSED', 90, 0, 5000, CURRENT_TIMESTAMP(3)),
    ('EXIT_GATE', 'EXIT', 'GATE_EXIT_SENSOR', 'GATE_EXIT_SERVO', 'CLOSED', 90, 0, 5000, CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
    `direction` = VALUES(`direction`),
    `sensorDeviceCode` = VALUES(`sensorDeviceCode`),
    `servoDeviceCode` = VALUES(`servoDeviceCode`),
    `openAngle` = VALUES(`openAngle`),
    `closedAngle` = VALUES(`closedAngle`),
    `autoCloseMs` = VALUES(`autoCloseMs`),
    `lastUpdated` = CURRENT_TIMESTAMP(3);

INSERT INTO `Zone` (`zoneName`, `capacity`)
VALUES ('ZONE_A', 4)
ON DUPLICATE KEY UPDATE `capacity` = 4;

SET @zone_a_id = (SELECT `id` FROM `Zone` WHERE `zoneName` = 'ZONE_A' LIMIT 1);

INSERT INTO `ParkingSpot`
    (`zoneId`, `spotName`, `sensorDeviceCode`, `ledDeviceCode`, `status`, `lastUpdated`)
VALUES
    (@zone_a_id, 'A1', 'SPOT_A1_SENSOR', 'SPOT_A1_LED', 'FREE', CURRENT_TIMESTAMP(3)),
    (@zone_a_id, 'A2', 'SPOT_A2_SENSOR', 'SPOT_A2_LED', 'FREE', CURRENT_TIMESTAMP(3)),
    (@zone_a_id, 'A3', 'SPOT_A3_SENSOR', 'SPOT_A3_LED', 'FREE', CURRENT_TIMESTAMP(3)),
    (@zone_a_id, 'A4', 'SPOT_A4_SENSOR', 'SPOT_A4_LED', 'FREE', CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
    `sensorDeviceCode` = VALUES(`sensorDeviceCode`),
    `ledDeviceCode` = VALUES(`ledDeviceCode`);

INSERT INTO `AccessCard` (`uid`, `status`, `label`) VALUES
    ('A9FB4420', 'AVAILABLE', 'Thẻ khách 01'),
    ('27B828B0', 'AVAILABLE', 'Thẻ khách 02'),
    ('577231B0', 'AVAILABLE', 'Thẻ khách 03'),
    ('17C32AB0', 'AVAILABLE', 'Thẻ khách 04'),
    ('27A437B0', 'AVAILABLE', 'Thẻ khách 05')
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);

COMMIT;

-- Verification queries. Expected: 26 devices, 2 gates, 4 spots, 5 cards.
SELECT COUNT(*) AS `deviceCount` FROM `IoTDevice`;
SELECT COUNT(*) AS `gateCount` FROM `Gate`;
SELECT COUNT(*) AS `spotCount` FROM `ParkingSpot`;
SELECT COUNT(*) AS `cardCount` FROM `AccessCard`;
