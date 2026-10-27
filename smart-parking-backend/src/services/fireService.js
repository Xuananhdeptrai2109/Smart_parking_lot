const { randomUUID } = require('crypto');
const prisma = require('../config/db');
const eventBus = require('../infrastructure/eventBus');
const realtime = require('../infrastructure/realtime');
const AppError = require('../utils/AppError');
const { parseOccurredAt } = require('../utils/normalizers');
const gateControlService = require('./gateControlService');
const commandService = require('./commandService');

const ACTIVE_STATES = ['DETECTED', 'AIMING', 'SUPPRESSING'];

function numberFromEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function getFireConfig() {
    return {
        flameThreshold: numberFromEnv('FIRE_FLAME_THRESHOLD', 0.65),
        gasThreshold: numberFromEnv('FIRE_GAS_THRESHOLD', 0.7),
        panMinAngle: numberFromEnv('FIRE_PAN_MIN_ANGLE', 20),
        panMaxAngle: numberFromEnv('FIRE_PAN_MAX_ANGLE', 160),
        tiltMinAngle: numberFromEnv('FIRE_TILT_MIN_ANGLE', 40),
        tiltMaxAngle: numberFromEnv('FIRE_TILT_MAX_ANGLE', 120),
        pumpMaxRunSeconds: numberFromEnv('FIRE_PUMP_MAX_RUN_SECONDS', 30),
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function estimateFireLocation(readings, config = getFireConfig()) {
    const values = {
        nw: Number(readings.flameNW),
        ne: Number(readings.flameNE),
        sw: Number(readings.flameSW),
        se: Number(readings.flameSE),
    };
    const allValues = Object.values(values);

    if (allValues.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
        throw new AppError('Cường độ bốn cảm biến lửa phải nằm trong khoảng 0..1.', 400);
    }

    const maxFlameIntensity = Math.max(...allValues);
    const flameDetected = maxFlameIntensity >= config.flameThreshold;
    const total = allValues.reduce((sum, value) => sum + value, 0);

    if (!flameDetected || total === 0) {
        return {
            flameDetected,
            maxFlameIntensity,
            estimatedX: null,
            estimatedY: null,
            confidence: 0,
            horizontalAngle: null,
            verticalAngle: null,
        };
    }

    // Hệ tọa độ 5x5: SW=(0,0), SE=(4,0), NW=(0,4), NE=(4,4).
    const rawX = ((values.ne + values.se) * 4) / total;
    const rawY = ((values.nw + values.ne) * 4) / total;
    const estimatedX = clamp(Math.round(rawX), 0, 4);
    const estimatedY = clamp(Math.round(rawY), 0, 4);
    const confidence = Number((maxFlameIntensity / total).toFixed(3));
    const horizontalAngle = Math.round(
        config.panMinAngle + (estimatedX / 4) * (config.panMaxAngle - config.panMinAngle),
    );
    const verticalAngle = Math.round(
        config.tiltMinAngle + (estimatedY / 4) * (config.tiltMaxAngle - config.tiltMinAngle),
    );

    return {
        flameDetected,
        maxFlameIntensity,
        estimatedX,
        estimatedY,
        confidence,
        horizontalAngle,
        verticalAngle,
    };
}

function parseSnapshot(input) {
    const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : '';
    const occurredAt = parseOccurredAt(input.occurredAt);
    const gasLevel = Number(input.gasLevel);

    if (!eventId || eventId.length > 100 || !occurredAt) {
        throw new AppError('eventId và occurredAt hợp lệ là bắt buộc.', 400);
    }
    if (!Number.isFinite(gasLevel) || gasLevel < 0 || gasLevel > 1) {
        throw new AppError('gasLevel phải nằm trong khoảng 0..1.', 400);
    }

    return {
        eventId,
        occurredAt,
        gasLevel,
        flameNW: Number(input.flameNW),
        flameNE: Number(input.flameNE),
        flameSW: Number(input.flameSW),
        flameSE: Number(input.flameSE),
    };
}

function buildAction(incidentId, actionType, payload) {
    return {
        commandId: randomUUID(),
        incidentId,
        actionType,
        payload,
    };
}

function buildSnapshotData(snapshot, location, incidentId) {
    return {
        eventId: snapshot.eventId,
        incidentId,
        flameNW: snapshot.flameNW,
        flameNE: snapshot.flameNE,
        flameSW: snapshot.flameSW,
        flameSE: snapshot.flameSE,
        gasLevel: snapshot.gasLevel,
        estimatedX: location.estimatedX,
        estimatedY: location.estimatedY,
        confidence: location.confidence,
        occurredAt: snapshot.occurredAt,
    };
}

async function deliverAction(action) {
    if (action.actionType === 'ENTER_EVACUATION') {
        await gateControlService.enterEvacuation();
        return prisma.fireAction.update({
            where: { id: action.id },
            data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
        });
    }
    if (action.actionType === 'EXIT_EVACUATION') {
        await gateControlService.exitEvacuation();
        return prisma.fireAction.update({
            where: { id: action.id },
            data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
        });
    }

    const deviceByAction = {
        BUZZER_ON: process.env.FIRE_BUZZER_DEVICE_CODE || 'FIRE_BUZZER',
        BUZZER_OFF: process.env.FIRE_BUZZER_DEVICE_CODE || 'FIRE_BUZZER',
        AIM_SERVOS: process.env.FIRE_SERVO_DEVICE_CODE || 'FIRE_SERVO_CONTROLLER',
        PUMP_ON: process.env.FIRE_PUMP_DEVICE_CODE || 'FIRE_PUMP_RELAY',
        PUMP_OFF: process.env.FIRE_PUMP_DEVICE_CODE || 'FIRE_PUMP_RELAY',
    };
    const deviceCode = deviceByAction[action.actionType];
    const payload = {
        commandId: action.commandId,
        incidentId: action.incidentId,
        action: action.actionType,
        ...action.payload,
        issuedAt: new Date().toISOString(),
    };
    const command = await commandService.dispatch({
        commandId: action.commandId,
        domain: 'FIRE',
        deviceCode,
        topic: eventBus.topics.command('fire', deviceCode),
        commandType: action.actionType,
        payload,
    });

    if (command.status === 'SENT' || command.status === 'ACKNOWLEDGED') {
        return prisma.fireAction.update({
            where: { id: action.id },
            data: { status: 'SENT' },
        });
    }
    return action;
}

async function processSnapshot(input) {
    const snapshot = parseSnapshot(input);
    const config = getFireConfig();
    const location = estimateFireLocation(snapshot, config);
    const gasDetected = snapshot.gasLevel >= config.gasThreshold;
    const hazardDetected = location.flameDetected || gasDetected;

    const result = await prisma.$transaction(async (tx) => {
        const duplicate = await tx.fireDetectionSnapshot.findUnique({
            where: { eventId: snapshot.eventId },
            include: { Incident: { include: { Action: true } } },
        });
        if (duplicate) {
            return { duplicate: true, hazardDetected, snapshot: duplicate, incident: duplicate.Incident, newActions: [] };
        }

        if (!hazardDetected) {
            const stored = await tx.fireDetectionSnapshot.create({
                data: buildSnapshotData(snapshot, location, null),
            });
            return { duplicate: false, hazardDetected: false, snapshot: stored, incident: null, newActions: [] };
        }

        let incident = await tx.fireIncident.findFirst({
            where: { status: { in: ACTIVE_STATES } },
            include: { Action: true },
            orderBy: { detectedAt: 'desc' },
        });
        const isNewIncident = !incident;

        if (!incident) {
            incident = await tx.fireIncident.create({
                data: {
                    status: location.flameDetected ? 'AIMING' : 'DETECTED',
                    detectedAt: snapshot.occurredAt,
                    estimatedX: location.estimatedX,
                    estimatedY: location.estimatedY,
                    confidence: location.confidence,
                    gasLevel: snapshot.gasLevel,
                    maxFlameIntensity: location.maxFlameIntensity,
                    horizontalAngle: location.horizontalAngle,
                    verticalAngle: location.verticalAngle,
                },
                include: { Action: true },
            });
        } else {
            incident = await tx.fireIncident.update({
                where: { id: incident.id },
                data: {
                    status: incident.status === 'DETECTED' && location.flameDetected ? 'AIMING' : incident.status,
                    estimatedX: location.estimatedX ?? incident.estimatedX,
                    estimatedY: location.estimatedY ?? incident.estimatedY,
                    confidence: Math.max(incident.confidence || 0, location.confidence),
                    gasLevel: Math.max(incident.gasLevel || 0, snapshot.gasLevel),
                    maxFlameIntensity: Math.max(incident.maxFlameIntensity || 0, location.maxFlameIntensity),
                    horizontalAngle: location.horizontalAngle ?? incident.horizontalAngle,
                    verticalAngle: location.verticalAngle ?? incident.verticalAngle,
                },
                include: { Action: true },
            });
        }

        const storedSnapshot = await tx.fireDetectionSnapshot.create({
            data: buildSnapshotData(snapshot, location, incident.id),
        });

        const actionData = [];
        const existingTypes = new Set(incident.Action.map((action) => action.actionType));
        if (isNewIncident || !existingTypes.has('BUZZER_ON')) {
            actionData.push(buildAction(incident.id, 'BUZZER_ON', { enabled: true }));
        }
        if (isNewIncident || !existingTypes.has('ENTER_EVACUATION')) {
            actionData.push(buildAction(incident.id, 'ENTER_EVACUATION', { emergency: true }));
        }
        if (location.flameDetected && !existingTypes.has('AIM_SERVOS')) {
            actionData.push(buildAction(incident.id, 'AIM_SERVOS', {
                gridX: location.estimatedX,
                gridY: location.estimatedY,
                horizontalAngle: location.horizontalAngle,
                verticalAngle: location.verticalAngle,
            }));
        }

        const newActions = [];
        for (const action of actionData) {
            newActions.push(await tx.fireAction.create({ data: action }));
        }

        return {
            duplicate: false,
            hazardDetected: true,
            flameDetected: location.flameDetected,
            gasDetected,
            snapshot: storedSnapshot,
            incident,
            newActions,
        };
    }, { isolationLevel: 'Serializable' });

    for (const action of result.newActions) {
        await deliverAction(action);
    }

    if (result.hazardDetected) {
        realtime.emit('fire_alarm', result);
    } else {
        realtime.emit('fire_snapshot', result.snapshot);
    }
    return result;
}

async function acknowledgeAction(commandId, success, failureReason) {
    const action = await prisma.fireAction.findUnique({
        where: { commandId },
        include: { Incident: true },
    });
    if (!action) throw new AppError('Không tìm thấy lệnh thiết bị.', 404);
    if (action.status === 'ACKNOWLEDGED' || action.status === 'FAILED') return action;

    const updated = await prisma.fireAction.update({
        where: { id: action.id },
        data: {
            status: success ? 'ACKNOWLEDGED' : 'FAILED',
            acknowledgedAt: new Date(),
            failureReason: success ? null : (failureReason || 'Thiết bị báo thực thi thất bại.'),
        },
    });

    if (success && action.actionType === 'AIM_SERVOS') {
        const pumpAction = await prisma.$transaction(async (tx) => {
            const existing = await tx.fireAction.findFirst({
                where: { incidentId: action.incidentId, actionType: 'PUMP_ON' },
            });
            if (existing) return existing;

            await tx.fireIncident.update({
                where: { id: action.incidentId },
                data: { status: 'SUPPRESSING', pumpStartedAt: new Date() },
            });
            return tx.fireAction.create({
                data: buildAction(action.incidentId, 'PUMP_ON', {
                    enabled: true,
                    maxRunSeconds: getFireConfig().pumpMaxRunSeconds,
                    requiresLocalSafetyCheck: true,
                }),
            });
        });
        await deliverAction(pumpAction);
    }

    const incident = await prisma.fireIncident.findUnique({
        where: { id: action.incidentId },
        include: { Action: { orderBy: { requestedAt: 'asc' } }, Snapshot: { orderBy: { occurredAt: 'desc' }, take: 10 } },
    });
    realtime.emit('fire_action_updated', { action: updated, incident });
    return { action: updated, incident };
}

async function resolveIncident(id, resolution = 'RESOLVED', notes) {
    if (!['RESOLVED', 'FALSE_ALARM'].includes(resolution)) {
        throw new AppError('resolution phải là RESOLVED hoặc FALSE_ALARM.', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
        const incident = await tx.fireIncident.findUnique({ where: { id } });
        if (!incident) throw new AppError('Không tìm thấy sự cố cháy.', 404);
        if (!ACTIVE_STATES.includes(incident.status)) {
            return { incident, actions: [], duplicate: true };
        }

        const updatedIncident = await tx.fireIncident.update({
            where: { id },
            data: {
                status: resolution,
                resolvedAt: new Date(),
                pumpStoppedAt: new Date(),
                notes: notes || incident.notes,
            },
        });
        const actionData = [
            buildAction(id, 'PUMP_OFF', { enabled: false }),
            buildAction(id, 'BUZZER_OFF', { enabled: false }),
            buildAction(id, 'EXIT_EVACUATION', { emergency: false }),
        ];
        const actions = [];
        for (const action of actionData) actions.push(await tx.fireAction.create({ data: action }));
        return { incident: updatedIncident, actions, duplicate: false };
    });

    for (const action of result.actions) await deliverAction(action);
    realtime.emit('fire_resolved', result);
    return result;
}

async function getFireStatus() {
    return prisma.fireIncident.findFirst({
        orderBy: { detectedAt: 'desc' },
        include: {
            Action: { orderBy: { requestedAt: 'asc' } },
            Snapshot: { orderBy: { occurredAt: 'desc' }, take: 10 },
        },
    });
}

module.exports = {
    getFireConfig,
    estimateFireLocation,
    processSnapshot,
    acknowledgeAction,
    resolveIncident,
    getFireStatus,
};
