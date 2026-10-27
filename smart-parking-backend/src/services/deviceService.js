const prisma = require('../config/db');
const realtime = require('../infrastructure/realtime');
const AppError = require('../utils/AppError');
const { parseOccurredAt } = require('../utils/normalizers');

const DEVICE_TYPES = new Set([
    'CAMERA', 'RFID_READER', 'OBSTACLE_SENSOR', 'FLAME_SENSOR', 'GAS_SENSOR',
    'BARRIER_SERVO', 'NOZZLE_SERVO', 'STATUS_LED', 'BUZZER', 'WATER_PUMP', 'RELAY',
]);
const DEVICE_STATUSES = new Set(['ONLINE', 'OFFLINE', 'ERROR']);

async function processHeartbeat(input) {
    const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : '';
    const deviceCode = typeof input.deviceCode === 'string' ? input.deviceCode.trim() : '';
    const type = typeof input.type === 'string' ? input.type.trim().toUpperCase() : '';
    const status = typeof input.status === 'string' ? input.status.trim().toUpperCase() : 'ONLINE';
    const occurredAt = parseOccurredAt(input.occurredAt);

    if (!eventId || !deviceCode || !DEVICE_TYPES.has(type) || !DEVICE_STATUSES.has(status) || !occurredAt) {
        throw new AppError('Heartbeat thiết bị không hợp lệ.', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
        const duplicate = await tx.deviceEvent.findUnique({ where: { eventId } });
        if (duplicate) return { duplicate: true, event: duplicate };

        const device = await tx.ioTDevice.upsert({
            where: { deviceCode },
            update: {
                status,
                lastSeenAt: occurredAt,
                ipAddress: input.ipAddress || undefined,
                metadata: input.metadata || undefined,
            },
            create: {
                deviceCode,
                type,
                status,
                location: input.location || 'UNASSIGNED',
                ipAddress: input.ipAddress || null,
                lastSeenAt: occurredAt,
                metadata: input.metadata || undefined,
            },
        });
        const event = await tx.deviceEvent.create({
            data: {
                eventId,
                deviceCode,
                eventType: 'HEARTBEAT',
                payload: input,
                occurredAt,
            },
        });
        return { duplicate: false, device, event };
    });

    realtime.emit('device_heartbeat', result);
    return result;
}

module.exports = { processHeartbeat };
