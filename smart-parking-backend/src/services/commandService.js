const prisma = require('../config/db');
const eventBus = require('../infrastructure/eventBus');
const AppError = require('../utils/AppError');

async function dispatch(command) {
    const serializablePayload = JSON.parse(JSON.stringify(command.payload));
    const stored = await prisma.deviceCommand.upsert({
        where: { commandId: command.commandId },
        update: {},
        create: {
            commandId: command.commandId,
            domain: command.domain,
            deviceCode: command.deviceCode,
            topic: command.topic,
            commandType: command.commandType,
            payload: serializablePayload,
            qos: command.qos ?? 1,
            retained: command.retained ?? false,
        },
    });

    if (stored.status === 'ACKNOWLEDGED') {
        return { ...stored, delivery: 'ALREADY_ACKNOWLEDGED' };
    }

    const delivered = await eventBus.publish(stored.topic, stored.payload, {
        qos: stored.qos,
        retain: stored.retained,
    });

    if (!delivered) {
        return { ...stored, delivery: 'BROKER_OFFLINE' };
    }

    const updated = await prisma.deviceCommand.update({
        where: { id: stored.id },
        data: { status: 'SENT', sentAt: new Date(), failureReason: null },
    });
    return { ...updated, delivery: 'PUBLISHED' };
}

async function acknowledge(commandId, success = true, failureReason) {
    const command = await prisma.deviceCommand.findUnique({ where: { commandId } });
    if (!command) throw new AppError('Không tìm thấy commandId.', 404);
    if (['ACKNOWLEDGED', 'FAILED'].includes(command.status)) return command;

    return prisma.deviceCommand.update({
        where: { id: command.id },
        data: {
            status: success ? 'ACKNOWLEDGED' : 'FAILED',
            acknowledgedAt: new Date(),
            failureReason: success ? null : (failureReason || 'Thiết bị báo thực thi thất bại.'),
        },
    });
}

async function retryPending(limit = 100) {
    if (!eventBus.isConnected()) return { attempted: 0, delivered: 0 };

    const commands = await prisma.deviceCommand.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: limit,
    });
    let delivered = 0;

    for (const command of commands) {
        const published = await eventBus.publish(command.topic, command.payload, {
            qos: command.qos,
            retain: command.retained,
        });
        if (published) {
            delivered += 1;
            await prisma.deviceCommand.update({
                where: { id: command.id },
                data: { status: 'SENT', sentAt: new Date(), failureReason: null },
            });
        }
    }

    return { attempted: commands.length, delivered };
}

module.exports = { dispatch, acknowledge, retryPending };
