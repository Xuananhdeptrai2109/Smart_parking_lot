const prisma = require('../src/config/db');

async function inspect() {
    const [gates, cards, sessions, events, commands, devices] = await Promise.all([
        prisma.gate.findMany({
            select: {
                gateCode: true,
                state: true,
                openAngle: true,
                closedAngle: true,
                lastUpdated: true,
            },
            orderBy: { id: 'asc' },
        }),
        prisma.accessCard.findMany({
            select: { uid: true, status: true },
            orderBy: { id: 'asc' },
        }),
        prisma.parkingSession.findMany({
            where: { status: 'ACTIVE' },
            select: {
                id: true,
                entryTime: true,
                status: true,
                Vehicle: { select: { licensePlate: true } },
                CardAssignment: { select: { AccessCard: { select: { uid: true } } } },
                AssignedSpot: { select: { spotName: true, status: true } },
            },
            orderBy: { id: 'desc' },
        }),
        prisma.gatePassageEvent.findMany({
            take: 10,
            select: {
                eventId: true,
                direction: true,
                recognizedPlate: true,
                rfidUid: true,
                result: true,
                reason: true,
                occurredAt: true,
            },
            orderBy: { id: 'desc' },
        }),
        prisma.deviceCommand.findMany({
            where: { domain: 'ACCESS' },
            take: 10,
            select: {
                commandId: true,
                deviceCode: true,
                commandType: true,
                status: true,
                createdAt: true,
                acknowledgedAt: true,
                failureReason: true,
            },
            orderBy: { id: 'desc' },
        }),
        prisma.ioTDevice.findMany({
            where: {
                deviceCode: { in: ['GATE_ENTRY_SERVO', 'GATE_EXIT_SERVO', 'RFID_ENTRY'] },
            },
            select: {
                deviceCode: true,
                status: true,
                ipAddress: true,
                lastSeenAt: true,
            },
            orderBy: { deviceCode: 'asc' },
        }),
    ]);

    console.log(JSON.stringify({ gates, cards, sessions, events, commands, devices }, null, 2));
}

inspect()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
