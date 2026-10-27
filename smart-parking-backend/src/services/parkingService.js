const prisma = require('../config/db');
const { PARKING_SPOT_NAMES } = require('../config/parking');
const eventBus = require('../infrastructure/eventBus');
const realtime = require('../infrastructure/realtime');
const AppError = require('../utils/AppError');
const { parseOccurredAt } = require('../utils/normalizers');
const commandService = require('./commandService');

function summarizeSpots(spots) {
    const counts = spots.reduce((result, spot) => {
        result[spot.status] = (result[spot.status] || 0) + 1;
        return result;
    }, {});

    const available = counts.FREE || 0;
    return {
        capacity: spots.length,
        available,
        occupied: counts.OCCUPIED || 0,
        reserved: counts.RESERVED || 0,
        maintenance: counts.MAINTENANCE || 0,
        isFull: available === 0,
        spots,
    };
}

async function getLotStatus() {
    const spots = await prisma.parkingSpot.findMany({
        where: { spotName: { in: PARKING_SPOT_NAMES } },
        include: { Zone: true },
        orderBy: [{ zoneId: 'asc' }, { spotName: 'asc' }],
    });
    return summarizeSpots(spots);
}

async function processSpotState(input) {
    const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : '';
    const spotName = typeof input.spotName === 'string' ? input.spotName.trim().toUpperCase() : '';
    const occurredAt = parseOccurredAt(input.occurredAt);

    if (!eventId || eventId.length > 90 || !spotName || typeof input.occupied !== 'boolean' || !occurredAt) {
        throw new AppError('eventId, spotName, occupied và occurredAt hợp lệ là bắt buộc.', 400);
    }
    if (!PARKING_SPOT_NAMES.includes(spotName)) {
        throw new AppError(`Vị trí đỗ ${spotName} không thuộc thiết kế A1–A4.`, 404);
    }

    const distanceCm = input.distanceCm == null ? null : Number(input.distanceCm);
    if (distanceCm != null && (!Number.isFinite(distanceCm) || distanceCm < 0)) {
        throw new AppError('distanceCm phải là một số không âm.', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
        const duplicate = await tx.spotStateEvent.findUnique({ where: { eventId } });
        if (duplicate) {
            const spot = await tx.parkingSpot.findUnique({ where: { id: duplicate.spotId } });
            return { spot, event: duplicate, duplicate: true };
        }

        const spot = await tx.parkingSpot.findFirst({ where: { spotName } });
        if (!spot) {
            throw new AppError(`Không tìm thấy vị trí đỗ ${spotName}.`, 404);
        }

        const activeAssignment = input.occupied
            ? null
            : await tx.parkingSession.findFirst({
                where: { assignedSpotId: spot.id, status: 'ACTIVE' },
                select: { id: true },
            });
        const nextStatus = input.occupied
            ? 'OCCUPIED'
            : (activeAssignment ? 'RESERVED' : 'FREE');

        const updatedSpot = await tx.parkingSpot.update({
            where: { id: spot.id },
            data: {
                status: nextStatus,
                lastDistanceCm: distanceCm,
                lastUpdated: occurredAt,
            },
        });
        const event = await tx.spotStateEvent.create({
            data: {
                eventId,
                spotId: spot.id,
                occupied: input.occupied,
                distanceCm,
                status: nextStatus,
                occurredAt,
            },
        });

        return { spot: updatedSpot, event, duplicate: false };
    });

    if (!result.duplicate) {
        const ledColor = result.spot.status === 'OCCUPIED' ? 'RED' : 'GREEN';
        const payload = {
            commandId: `${eventId}:led`,
            type: 'led.set',
            spotName: result.spot.spotName,
            color: ledColor,
            issuedAt: new Date().toISOString(),
        };
        await commandService.dispatch({
            commandId: payload.commandId,
            domain: 'PARKING',
            deviceCode: result.spot.ledDeviceCode,
            topic: eventBus.topics.command('led', result.spot.ledDeviceCode),
            commandType: 'LED_SET',
            payload,
            retained: true,
        });
    }

    const lot = await getLotStatus();
    await eventBus.publish(eventBus.topics.state('parking-lot'), lot, { retain: true });
    realtime.emit('spot_status_changed', { spot: result.spot, lot });

    return { ...result, lot };
}

module.exports = {
    summarizeSpots,
    getLotStatus,
    processSpotState,
};
