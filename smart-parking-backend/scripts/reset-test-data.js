const prisma = require('../src/config/db');

const confirmation = process.env.RESET_CONFIRM;

if (confirmation !== 'RESET_AWS_TEST_DATA') {
    throw new Error('Refusing to reset data. Set RESET_CONFIRM=RESET_AWS_TEST_DATA.');
}

async function resetTestData() {
    const deleted = await prisma.$transaction(async (tx) => {
        const result = {};

        result.payments = (await tx.payment.deleteMany()).count;
        result.gateEvents = (await tx.gatePassageEvent.deleteMany()).count;
        result.cameraCaptures = (await tx.cameraCapture.deleteMany()).count;
        result.cardAssignments = (await tx.cardAssignment.deleteMany()).count;
        result.parkingSessions = (await tx.parkingSession.deleteMany()).count;
        result.spotEvents = (await tx.spotStateEvent.deleteMany()).count;

        result.fireActions = (await tx.fireAction.deleteMany()).count;
        result.fireSnapshots = (await tx.fireDetectionSnapshot.deleteMany()).count;
        result.fireIncidents = (await tx.fireIncident.deleteMany()).count;
        result.incidentLogs = (await tx.incidentLog.deleteMany()).count;

        result.deviceCommands = (await tx.deviceCommand.deleteMany()).count;
        result.deviceEvents = (await tx.deviceEvent.deleteMany()).count;

        await tx.accessCard.updateMany({ data: { status: 'AVAILABLE' } });
        await tx.parkingSpot.updateMany({
            data: {
                status: 'FREE',
                lastDistanceCm: null,
                lastUpdated: new Date(),
            },
        });
        await tx.gate.updateMany({
            data: {
                state: 'CLOSED',
                openAngle: 90,
                closedAngle: 0,
            },
        });
        await tx.ioTDevice.updateMany({
            data: {
                status: 'OFFLINE',
                lastSeenAt: null,
            },
        });

        return result;
    });

    const [cards, spots, gates, activeSessions, pendingPayments] = await Promise.all([
        prisma.accessCard.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.parkingSpot.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.gate.findMany({ select: { gateCode: true, state: true }, orderBy: { id: 'asc' } }),
        prisma.parkingSession.count({ where: { status: 'ACTIVE' } }),
        prisma.payment.count({ where: { paymentStatus: { in: ['PENDING', 'PROCESSING'] } } }),
    ]);

    console.log(JSON.stringify({
        reset: true,
        deleted,
        cards,
        spots,
        gates,
        activeSessions,
        pendingPayments,
    }, null, 2));
}

resetTestData()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
