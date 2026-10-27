require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const { PARKING_SPOT_NAMES } = require('../src/config/parking');

const prisma = new PrismaClient();

const accessCards = [
    ['A9FB4420', 'Thẻ khách 01'],
    ['27B828B0', 'Thẻ khách 02'],
    ['577231B0', 'Thẻ khách 03'],
    ['17C32AB0', 'Thẻ khách 04'],
    ['27A437B0', 'Thẻ khách 05'],
];

const simulatedCardUids = Array.from(
    { length: 10 },
    (_, index) => `CARD${String(index + 1).padStart(3, '0')}`,
);

const devices = [
    ['CAMERA_MAIN', 'CAMERA', 'Camera ESP32-CAM dùng chung hai làn'],
    ['RFID_ENTRY', 'RFID_READER', 'Bộ đọc/cấp thẻ tại cổng vào'],
    ['RFID_EXIT', 'RFID_READER', 'Bộ đọc/thu thẻ tại cổng ra'],
    ['GATE_ENTRY_SENSOR', 'OBSTACLE_SENSOR', 'Cảm biến xe cổng vào'],
    ['GATE_EXIT_SENSOR', 'OBSTACLE_SENSOR', 'Cảm biến xe cổng ra'],
    ['GATE_ENTRY_SERVO', 'BARRIER_SERVO', 'Servo 180 cửa vào'],
    ['GATE_EXIT_SERVO', 'BARRIER_SERVO', 'Servo 180 cửa ra'],
    ...PARKING_SPOT_NAMES.map((spotName) => [
        `SPOT_${spotName}_SENSOR`, 'OBSTACLE_SENSOR', `Cảm biến ô ${spotName}`,
    ]),
    ...PARKING_SPOT_NAMES.map((spotName) => [
        `SPOT_${spotName}_LED`, 'STATUS_LED', `Cặp LED đỏ/xanh trạng thái ô ${spotName}`,
    ]),
    ['FIRE_FLAME_NW', 'FLAME_SENSOR', 'Cảm biến lửa góc tây bắc'],
    ['FIRE_FLAME_NE', 'FLAME_SENSOR', 'Cảm biến lửa góc đông bắc'],
    ['FIRE_FLAME_SW', 'FLAME_SENSOR', 'Cảm biến lửa góc tây nam'],
    ['FIRE_FLAME_SE', 'FLAME_SENSOR', 'Cảm biến lửa góc đông nam'],
    ['FIRE_GAS', 'GAS_SENSOR', 'Cảm biến khí gas'],
    ['FIRE_BUZZER', 'BUZZER', 'Còi báo cháy'],
    ['FIRE_SERVO_HORIZONTAL', 'NOZZLE_SERVO', 'Servo xoay ngang vòi nước'],
    ['FIRE_SERVO_VERTICAL', 'NOZZLE_SERVO', 'Servo xoay dọc vòi nước'],
    ['FIRE_SERVO_CONTROLLER', 'NOZZLE_SERVO', 'ESP32 điều khiển hai servo PCCC'],
    ['FIRE_PUMP', 'WATER_PUMP', 'Máy bơm nước'],
    ['FIRE_PUMP_RELAY', 'RELAY', 'Relay điều khiển máy bơm'],
];

async function main() {
    for (const [deviceCode, type, location] of devices) {
        await prisma.ioTDevice.upsert({
            where: { deviceCode },
            update: { type, location },
            create: { deviceCode, type, location, status: 'OFFLINE' },
        });
    }

    await prisma.gate.upsert({
        where: { gateCode: 'ENTRY_GATE' },
        update: {},
        create: {
            gateCode: 'ENTRY_GATE',
            direction: 'ENTRY',
            sensorDeviceCode: 'GATE_ENTRY_SENSOR',
            servoDeviceCode: 'GATE_ENTRY_SERVO',
            openAngle: 90,
            closedAngle: 0,
            autoCloseMs: 5000,
        },
    });
    await prisma.gate.upsert({
        where: { gateCode: 'EXIT_GATE' },
        update: {},
        create: {
            gateCode: 'EXIT_GATE',
            direction: 'EXIT',
            sensorDeviceCode: 'GATE_EXIT_SENSOR',
            servoDeviceCode: 'GATE_EXIT_SERVO',
            openAngle: 90,
            closedAngle: 0,
            autoCloseMs: 5000,
        },
    });

    const zone = await prisma.zone.upsert({
        where: { zoneName: 'ZONE_A' },
        update: { capacity: PARKING_SPOT_NAMES.length },
        create: { zoneName: 'ZONE_A', capacity: PARKING_SPOT_NAMES.length },
    });

    for (const spotName of PARKING_SPOT_NAMES) {
        await prisma.parkingSpot.upsert({
            where: { zoneId_spotName: { zoneId: zone.id, spotName } },
            update: {
                sensorDeviceCode: `SPOT_${spotName}_SENSOR`,
                ledDeviceCode: `SPOT_${spotName}_LED`,
            },
            create: {
                zoneId: zone.id,
                spotName,
                sensorDeviceCode: `SPOT_${spotName}_SENSOR`,
                ledDeviceCode: `SPOT_${spotName}_LED`,
            },
        });
    }

    await prisma.accessCard.deleteMany({
        where: { uid: { in: simulatedCardUids } },
    });

    for (const [uid, label] of accessCards) {
        await prisma.accessCard.upsert({
            where: { uid },
            update: { label },
            create: { uid, label, status: 'AVAILABLE' },
        });
    }

    console.log(`Seeded 2 gates, ${PARKING_SPOT_NAMES.length} parking spots, ${accessCards.length} real access cards and IoT devices.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
