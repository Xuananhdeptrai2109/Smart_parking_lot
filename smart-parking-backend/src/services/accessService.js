const prisma = require('../config/db');
const { PARKING_SPOT_NAMES } = require('../config/parking');
const eventBus = require('../infrastructure/eventBus');
const realtime = require('../infrastructure/realtime');
const AppError = require('../utils/AppError');
const { normalizeLicensePlate, normalizeRfid, parseOccurredAt } = require('../utils/normalizers');
const { sendGateCommand } = require('./gateControlService');
const paymentService = require('./paymentService');

const VEHICLE_TYPES = new Set(['CAR', 'MOTORBIKE']);
const ACTIVE_FIRE_STATES = ['DETECTED', 'AIMING', 'SUPPRESSING'];

function parseAccessInput(input, direction) {
    const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : '';
    const rfidUid = normalizeRfid(input.rfidUid);
    const plateField = direction === 'ENTRY' ? 'rightPlate' : 'leftPlate';
    const recognizedPlate = normalizeLicensePlate(input[plateField]);
    const imageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : '';
    const occurredAt = parseOccurredAt(input.occurredAt);
    const vehicleType = typeof input.vehicleType === 'string'
        ? input.vehicleType.trim().toUpperCase()
        : 'CAR';
    const errors = [];

    if (!eventId || eventId.length > 80) errors.push('eventId là bắt buộc và tối đa 80 ký tự.');
    if (!rfidUid || rfidUid.length > 100) errors.push('rfidUid không hợp lệ.');
    if (!recognizedPlate || recognizedPlate.length > 50) errors.push(`${plateField} không hợp lệ.`);
    if (!imageUrl || imageUrl.length > 500) errors.push('imageUrl là bắt buộc và tối đa 500 ký tự.');
    if (!occurredAt) errors.push('occurredAt không hợp lệ.');
    if (direction === 'ENTRY' && !VEHICLE_TYPES.has(vehicleType)) {
        errors.push('vehicleType phải là CAR hoặc MOTORBIKE.');
    }

    if (errors.length > 0) {
        throw new AppError('Dữ liệu yêu cầu qua cổng không hợp lệ.', 400, { errors });
    }

    return {
        eventId,
        rfidUid,
        recognizedPlate,
        imageUrl,
        occurredAt,
        vehicleType,
        cameraDeviceCode: input.cameraDeviceCode || process.env.CAMERA_DEVICE_CODE || 'CAMERA_MAIN',
    };
}

async function saveCameraCapture(tx, data, direction) {
    return tx.cameraCapture.upsert({
        where: { eventId: `${data.eventId}:camera` },
        update: {},
        create: {
            eventId: `${data.eventId}:camera`,
            deviceCode: data.cameraDeviceCode,
            imageUrl: data.imageUrl,
            leftPlate: direction === 'EXIT' ? data.recognizedPlate : null,
            rightPlate: direction === 'ENTRY' ? data.recognizedPlate : null,
            capturedAt: data.occurredAt,
        },
    });
}

async function createDeniedEvent(tx, gate, data, direction, reason, state = 'CLOSED') {
    const event = await tx.gatePassageEvent.create({
        data: {
            eventId: data.eventId,
            gateId: gate.id,
            direction,
            imageUrl: data.imageUrl,
            imageHalf: direction === 'ENTRY' ? 'RIGHT' : 'LEFT',
            recognizedPlate: data.recognizedPlate,
            rfidUid: data.rfidUid,
            result: 'DENIED',
            reason,
            occurredAt: data.occurredAt,
        },
    });
    await tx.gate.update({ where: { id: gate.id }, data: { state } });
    return { allowed: false, reason, event, gate: { ...gate, state } };
}

async function processEntry(input) {
    const data = parseAccessInput(input, 'ENTRY');
    const result = await prisma.$transaction(async (tx) => {
        const gate = await tx.gate.findFirst({ where: { direction: 'ENTRY' } });
        if (!gate) throw new AppError('Chưa cấu hình cổng vào.', 503);

        const duplicate = await tx.gatePassageEvent.findUnique({
            where: { eventId: data.eventId },
            include: { ParkingSession: { include: { Vehicle: true, AssignedSpot: true } } },
        });
        if (duplicate) {
            return {
                allowed: duplicate.result === 'ALLOWED' || duplicate.result === 'COMPLETED',
                duplicate: true,
                event: duplicate,
                session: duplicate.ParkingSession,
                gate,
            };
        }

        await saveCameraCapture(tx, data, 'ENTRY');

        const activeFire = await tx.fireIncident.findFirst({
            where: { status: { in: ACTIVE_FIRE_STATES } },
            select: { id: true },
        });
        if (activeFire) {
            return createDeniedEvent(tx, gate, data, 'ENTRY', 'Hệ thống đang ở chế độ khẩn cấp.', 'BLOCKED');
        }

        const spot = await tx.parkingSpot.findFirst({
            where: {
                status: 'FREE',
                spotName: { in: PARKING_SPOT_NAMES },
            },
            orderBy: [{ zoneId: 'asc' }, { spotName: 'asc' }],
        });
        if (!spot) {
            return createDeniedEvent(tx, gate, data, 'ENTRY', 'Bãi xe đã đầy.', 'BLOCKED');
        }

        const card = await tx.accessCard.findUnique({ where: { uid: data.rfidUid } });
        if (!card || card.status !== 'AVAILABLE') {
            return createDeniedEvent(tx, gate, data, 'ENTRY', 'Thẻ RFID không tồn tại hoặc đang được sử dụng.');
        }

        let vehicle = await tx.vehicle.findUnique({ where: { licensePlate: data.recognizedPlate } });
        if (vehicle && vehicle.vehicleType !== data.vehicleType) {
            return createDeniedEvent(tx, gate, data, 'ENTRY', 'Loại xe không khớp dữ liệu đã đăng ký.');
        }
        if (!vehicle) {
            vehicle = await tx.vehicle.create({
                data: { licensePlate: data.recognizedPlate, vehicleType: data.vehicleType },
            });
        }

        const activeSession = await tx.parkingSession.findFirst({
            where: { vehicleId: vehicle.id, status: 'ACTIVE' },
            select: { id: true },
        });
        if (activeSession) {
            return createDeniedEvent(tx, gate, data, 'ENTRY', 'Xe đã có phiên gửi đang hoạt động.');
        }

        const session = await tx.parkingSession.create({
            data: {
                vehicleId: vehicle.id,
                assignedSpotId: spot.id,
                entryTime: data.occurredAt,
                entryImage: data.imageUrl,
                entryGate: gate.gateCode,
            },
        });
        await tx.cardAssignment.create({
            data: { cardId: card.id, sessionId: session.id, issuedAt: data.occurredAt },
        });
        await tx.accessCard.update({ where: { id: card.id }, data: { status: 'ISSUED' } });
        await tx.parkingSpot.update({ where: { id: spot.id }, data: { status: 'RESERVED' } });
        const event = await tx.gatePassageEvent.create({
            data: {
                eventId: data.eventId,
                gateId: gate.id,
                direction: 'ENTRY',
                imageUrl: data.imageUrl,
                imageHalf: 'RIGHT',
                recognizedPlate: data.recognizedPlate,
                rfidUid: data.rfidUid,
                result: 'ALLOWED',
                sessionId: session.id,
                occurredAt: data.occurredAt,
            },
        });
        await tx.gate.update({ where: { id: gate.id }, data: { state: 'OPENING' } });

        const completeSession = await tx.parkingSession.findUnique({
            where: { id: session.id },
            include: { Vehicle: true, AssignedSpot: true, CardAssignment: { include: { AccessCard: true } } },
        });
        return { allowed: true, duplicate: false, event, session: completeSession, gate };
    }, { isolationLevel: 'Serializable' });

    if (result.duplicate) return result;

    if (!result.allowed) {
        result.command = await sendGateCommand(result.gate, 'CLOSE', { reason: result.reason });
        realtime.emit('gate_access_denied', result);
        return result;
    }

    result.command = await sendGateCommand(result.gate, 'OPEN', {
        sessionId: result.session.id,
        assignedSpot: result.session.AssignedSpot?.spotName,
    });
    realtime.emit('vehicle_entered', result);
    return result;
}

async function processExit(input) {
    const data = parseAccessInput(input, 'EXIT');
    const result = await prisma.$transaction(async (tx) => {
        const gate = await tx.gate.findFirst({ where: { direction: 'EXIT' } });
        if (!gate) throw new AppError('Chưa cấu hình cổng ra.', 503);

        const duplicate = await tx.gatePassageEvent.findUnique({
            where: { eventId: data.eventId },
            include: { ParkingSession: { include: { Vehicle: true, AssignedSpot: true, Payment: true } } },
        });
        if (duplicate) {
            const paymentRequired = duplicate.result === 'PENDING' && Boolean(duplicate.ParkingSession?.Payment);
            return {
                allowed: duplicate.result === 'ALLOWED' || duplicate.result === 'COMPLETED',
                paymentRequired,
                duplicate: true,
                event: duplicate,
                session: duplicate.ParkingSession,
                payment: duplicate.ParkingSession?.Payment || null,
                gate,
            };
        }

        await saveCameraCapture(tx, data, 'EXIT');

        const card = await tx.accessCard.findUnique({
            where: { uid: data.rfidUid },
            include: {
                Assignment: {
                    where: { returnedAt: null },
                    take: 1,
                    orderBy: { issuedAt: 'desc' },
                    include: {
                        Session: { include: { Vehicle: true, AssignedSpot: true, Payment: true } },
                    },
                },
            },
        });
        const assignment = card?.Assignment?.[0];
        if (!card || card.status !== 'ISSUED' || !assignment || assignment.Session.status !== 'ACTIVE') {
            return createDeniedEvent(tx, gate, data, 'EXIT', 'Thẻ RFID không gắn với phiên gửi xe đang hoạt động.');
        }

        const expectedPlate = normalizeLicensePlate(assignment.Session.Vehicle?.licensePlate);
        if (!expectedPlate || expectedPlate !== data.recognizedPlate) {
            return createDeniedEvent(tx, gate, data, 'EXIT', 'Biển số xe không khớp với thẻ RFID.');
        }

        if (assignment.Session.Payment && assignment.Session.Payment.paymentStatus !== 'SUCCESS') {
            const pendingEvent = await tx.gatePassageEvent.findFirst({
                where: {
                    sessionId: assignment.sessionId,
                    direction: 'EXIT',
                    result: 'PENDING',
                },
                orderBy: { occurredAt: 'desc' },
            });
            if (pendingEvent) {
                return {
                    allowed: false,
                    paymentRequired: true,
                    duplicate: true,
                    event: pendingEvent,
                    session: assignment.Session,
                    payment: assignment.Session.Payment,
                    gate,
                };
            }
        }

        const event = await tx.gatePassageEvent.create({
            data: {
                eventId: data.eventId,
                gateId: gate.id,
                direction: 'EXIT',
                imageUrl: data.imageUrl,
                imageHalf: 'LEFT',
                recognizedPlate: data.recognizedPlate,
                rfidUid: data.rfidUid,
                result: 'PENDING',
                sessionId: assignment.sessionId,
                occurredAt: data.occurredAt,
            },
        });
        const session = assignment.Session;
        const payment = await paymentService.createPendingPayment(tx, session, data.occurredAt);

        return {
            allowed: false,
            paymentRequired: true,
            duplicate: false,
            event,
            session,
            payment,
            gate,
        };
    }, { isolationLevel: 'Serializable' });

    if (result.duplicate) return result;

    if (result.paymentRequired) {
        realtime.emit('payment_required', result);
        return result;
    }

    if (!result.allowed) {
        result.command = await sendGateCommand(result.gate, 'CLOSE', { reason: result.reason });
        realtime.emit('gate_access_denied', result);
        return result;
    }

    result.command = await sendGateCommand(result.gate, 'OPEN', { sessionId: result.session.id });
    realtime.emit('vehicle_exited', result);
    return result;
}

async function getAccessStatus() {
    const [gates, availableCards, issuedCards, activeSessions] = await Promise.all([
        prisma.gate.findMany({ orderBy: { direction: 'asc' } }),
        prisma.accessCard.count({ where: { status: 'AVAILABLE' } }),
        prisma.accessCard.count({ where: { status: 'ISSUED' } }),
        prisma.parkingSession.count({ where: { status: 'ACTIVE' } }),
    ]);
    return { gates, cards: { available: availableCards, issued: issuedCards }, activeSessions };
}

async function processGateState(input) {
    const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : '';
    const gateCode = typeof input.gateCode === 'string' ? input.gateCode.trim().toUpperCase() : '';
    const state = typeof input.state === 'string' ? input.state.trim().toUpperCase() : '';
    const occurredAt = parseOccurredAt(input.occurredAt);
    const validStates = new Set(['CLOSED', 'OPENING', 'OPEN', 'CLOSING', 'BLOCKED', 'ERROR', 'EVACUATION']);

    if (!eventId || eventId.length > 100 || !gateCode || !validStates.has(state) || !occurredAt) {
        throw new AppError('Sự kiện trạng thái cổng không hợp lệ.', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
        const duplicate = await tx.deviceEvent.findUnique({ where: { eventId } });
        if (duplicate) return { duplicate: true, event: duplicate };

        const gate = await tx.gate.findUnique({ where: { gateCode } });
        if (!gate) throw new AppError('Không tìm thấy cổng.', 404);
        const deviceCode = input.deviceCode || gate.servoDeviceCode;
        await tx.ioTDevice.upsert({
            where: { deviceCode },
            update: { status: state === 'ERROR' ? 'ERROR' : 'ONLINE', lastSeenAt: occurredAt },
            create: {
                deviceCode,
                type: 'BARRIER_SERVO',
                location: gate.gateCode,
                status: state === 'ERROR' ? 'ERROR' : 'ONLINE',
                lastSeenAt: occurredAt,
            },
        });
        const updatedGate = await tx.gate.update({ where: { id: gate.id }, data: { state } });
        const event = await tx.deviceEvent.create({
            data: {
                eventId,
                deviceCode,
                eventType: 'GATE_STATE',
                payload: input,
                occurredAt,
            },
        });

        if (state === 'CLOSED' && input.passageEventId) {
            await tx.gatePassageEvent.updateMany({
                where: { eventId: input.passageEventId, result: 'ALLOWED' },
                data: { result: 'COMPLETED' },
            });
        }

        return { duplicate: false, gate: updatedGate, event };
    });

    realtime.emit('gate_state_changed', result);
    return result;
}

module.exports = {
    parseAccessInput,
    processEntry,
    processExit,
    processGateState,
    getAccessStatus,
};
