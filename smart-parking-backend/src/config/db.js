const { PrismaClient } = require('@prisma/client');

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Interactive transactions default to only 5 seconds in Prisma. That is too
// short when the MySQL database is hosted remotely (for example, AWS RDS),
// because the access flow performs several dependent reads/writes in one
// transaction. Keep these configurable while providing safe cloud defaults.
const transactionMaxWaitMs = positiveInteger(
    process.env.PRISMA_TRANSACTION_MAX_WAIT_MS,
    15000,
);
const transactionTimeoutMs = positiveInteger(
    process.env.PRISMA_TRANSACTION_TIMEOUT_MS,
    30000,
);

const prisma = new PrismaClient({
    transactionOptions: {
        maxWait: transactionMaxWaitMs,
        timeout: transactionTimeoutMs,
    },
});

module.exports = prisma;
