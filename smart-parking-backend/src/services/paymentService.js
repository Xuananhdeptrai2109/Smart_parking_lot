const crypto = require('crypto');
const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const realtime = require('../infrastructure/realtime');
const { getPricingConfig } = require('../config/pricing');
const { sendGateCommand } = require('./gateControlService');

const PENDING_STATUSES = ['PENDING', 'PROCESSING'];

function calculateParkingFee(entryTime, checkoutTime = new Date()) {
    const entry = new Date(entryTime);
    const checkout = new Date(checkoutTime);
    if (Number.isNaN(entry.getTime()) || Number.isNaN(checkout.getTime()) || checkout < entry) {
        throw new AppError('Thời gian phiên gửi xe không hợp lệ.', 400);
    }

    const config = getPricingConfig();
    const durationMinutes = Math.max(1, Math.ceil((checkout.getTime() - entry.getTime()) / 60000));
    let amount;
    let tier;
    let extraHours = 0;

    if (durationMinutes <= 120) {
        amount = config.firstTwoHours;
        tier = 'FIRST_2_HOURS';
    } else if (durationMinutes <= 300) {
        amount = config.upToFiveHours;
        tier = 'UP_TO_5_HOURS';
    } else {
        extraHours = Math.ceil((durationMinutes - 300) / 60);
        amount = config.upToFiveHours + (extraHours * config.extraHour);
        tier = 'OVER_5_HOURS';
    }

    return {
        amount,
        durationMinutes,
        tier,
        extraHours,
        checkoutAt: checkout.toISOString(),
        currency: 'VND',
        rates: {
            firstTwoHours: config.firstTwoHours,
            upToFiveHours: config.upToFiveHours,
            extraHour: config.extraHour,
        },
    };
}

async function createPendingPayment(tx, session, checkoutTime) {
    const pricing = calculateParkingFee(session.entryTime, checkoutTime);
    return tx.payment.upsert({
        where: { sessionId: session.id },
        update: {
            amount: pricing.amount,
            paymentMethod: null,
            paymentStatus: 'PENDING',
            provider: null,
            providerOrderId: null,
            providerTransactionId: null,
            checkoutToken: null,
            pricingDetails: pricing,
            expiresAt: null,
            confirmedBy: null,
            transactionTime: null,
        },
        create: {
            sessionId: session.id,
            amount: pricing.amount,
            paymentStatus: 'PENDING',
            pricingDetails: pricing,
        },
    });
}

const paymentInclude = {
    ParkingSession: {
        include: {
            Vehicle: true,
            AssignedSpot: true,
            CardAssignment: { include: { AccessCard: true } },
            GatePassageEvent: { where: { direction: 'EXIT' }, orderBy: { occurredAt: 'desc' }, take: 1 },
        },
    },
};

async function listPayments(query = {}) {
    const status = typeof query.status === 'string' ? query.status.trim().toUpperCase() : '';
    const validStatuses = new Set(['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED']);
    const take = Math.min(100, Math.max(1, Number(query.limit) || 50));
    return prisma.payment.findMany({
        where: status && validStatuses.has(status) ? { paymentStatus: status } : undefined,
        include: paymentInclude,
        orderBy: { createdAt: 'desc' },
        take,
    });
}

async function getPayment(id) {
    const payment = await prisma.payment.findUnique({ where: { id }, include: paymentInclude });
    if (!payment) throw new AppError('Không tìm thấy giao dịch thanh toán.', 404);
    return payment;
}

async function getCheckoutByToken(token) {
    const payment = await prisma.payment.findUnique({ where: { checkoutToken: token }, include: paymentInclude });
    if (!payment) throw new AppError('Mã thanh toán không tồn tại.', 404);

    if (payment.paymentStatus === 'PROCESSING' && payment.expiresAt && payment.expiresAt < new Date()) {
        return prisma.payment.update({
            where: { id: payment.id },
            data: { paymentStatus: 'EXPIRED' },
            include: paymentInclude,
        });
    }
    return payment;
}

function resolveFrontendUrl(requestOrigin) {
    const candidate = process.env.FRONTEND_URL || requestOrigin || 'http://localhost:5173';
    try {
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
        return parsed.origin;
    } catch {
        return 'http://localhost:5173';
    }
}

async function createQrSandbox(id, requestOrigin) {
    const payment = await getPayment(id);
    if (payment.paymentStatus === 'SUCCESS') return { payment, checkoutUrl: null, duplicate: true };

    const config = getPricingConfig();
    const checkoutToken = crypto.randomUUID();
    const providerOrderId = `QR-SANDBOX-${payment.id}-${Date.now()}`;
    const expiresAt = new Date(Date.now() + config.qrExpiresMinutes * 60000);
    const updated = await prisma.payment.update({
        where: { id },
        data: {
            paymentMethod: 'VNPAY',
            paymentStatus: 'PROCESSING',
            provider: 'QR_SANDBOX',
            providerOrderId,
            providerTransactionId: null,
            checkoutToken,
            expiresAt,
        },
        include: paymentInclude,
    });
    const frontendUrl = resolveFrontendUrl(requestOrigin);
    const checkoutUrl = `${frontendUrl}/#/checkout/${checkoutToken}`;
    realtime.emit('payment_status_changed', { payment: updated, checkoutUrl });
    return { payment: updated, checkoutUrl, duplicate: false };
}

async function finalizePayment(id, { method, provider, providerTransactionId, confirmedBy }) {
    const result = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
            where: { id },
            include: paymentInclude,
        });
        if (!payment) throw new AppError('Không tìm thấy giao dịch thanh toán.', 404);
        if (payment.paymentStatus === 'SUCCESS') {
            return { payment, session: payment.ParkingSession, duplicate: true };
        }

        const session = payment.ParkingSession;
        if (!session || session.status !== 'ACTIVE') {
            throw new AppError('Phiên gửi xe không còn ở trạng thái chờ thanh toán.', 409);
        }
        const exitEvent = session.GatePassageEvent?.[0];
        if (!exitEvent || exitEvent.result !== 'PENDING') {
            throw new AppError('Không tìm thấy yêu cầu xe ra đang chờ thanh toán.', 409);
        }
        const gate = await tx.gate.findUnique({ where: { id: exitEvent.gateId } });
        if (!gate) throw new AppError('Không tìm thấy cổng ra.', 404);

        const paidAt = new Date();
        const updatedPayment = await tx.payment.update({
            where: { id },
            data: {
                paymentMethod: method,
                paymentStatus: 'SUCCESS',
                provider,
                providerTransactionId,
                confirmedBy,
                transactionTime: paidAt,
                expiresAt: null,
            },
        });
        await tx.parkingSession.update({
            where: { id: session.id },
            data: {
                exitTime: paidAt,
                exitImage: exitEvent.imageUrl,
                exitGate: gate.gateCode,
                status: 'COMPLETED',
            },
        });
        if (session.CardAssignment) {
            await tx.cardAssignment.update({
                where: { id: session.CardAssignment.id },
                data: { returnedAt: paidAt },
            });
            await tx.accessCard.update({
                where: { id: session.CardAssignment.cardId },
                data: { status: 'AVAILABLE' },
            });
        }
        await tx.gatePassageEvent.update({
            where: { id: exitEvent.id },
            data: { result: 'ALLOWED' },
        });
        await tx.gate.update({ where: { id: gate.id }, data: { state: 'OPENING' } });

        const completeSession = await tx.parkingSession.findUnique({
            where: { id: session.id },
            include: {
                Vehicle: true,
                AssignedSpot: true,
                CardAssignment: { include: { AccessCard: true } },
                Payment: true,
            },
        });
        return { payment: updatedPayment, session: completeSession, event: exitEvent, gate, duplicate: false };
    }, { isolationLevel: 'Serializable' });

    if (result.duplicate) return result;
    result.command = await sendGateCommand(result.gate, 'OPEN', {
        sessionId: result.session.id,
        paymentId: result.payment.id,
        amount: Number(result.payment.amount),
    });
    realtime.emit('payment_status_changed', result);
    realtime.emit('vehicle_exited', result);
    return result;
}

async function confirmCash(id, confirmedBy = 'OPERATOR') {
    return finalizePayment(id, {
        method: 'CASH',
        provider: 'CASH_DESK',
        providerTransactionId: `CASH-${id}-${Date.now()}`,
        confirmedBy: String(confirmedBy || 'OPERATOR').slice(0, 100),
    });
}

async function confirmQrSandbox(token) {
    const payment = await getCheckoutByToken(token);
    if (payment.paymentStatus === 'SUCCESS') return { payment, session: payment.ParkingSession, duplicate: true };
    if (payment.paymentStatus === 'EXPIRED' || (payment.expiresAt && payment.expiresAt < new Date())) {
        throw new AppError('Mã QR đã hết hạn. Vui lòng tạo lại giao dịch.', 410);
    }
    if (!PENDING_STATUSES.includes(payment.paymentStatus) || payment.provider !== 'QR_SANDBOX') {
        throw new AppError('Giao dịch QR không ở trạng thái có thể thanh toán.', 409);
    }
    return finalizePayment(payment.id, {
        method: 'QR_SANDBOX',
        provider: 'QR_SANDBOX',
        providerTransactionId: `SANDBOX-PAID-${Date.now()}`,
        confirmedBy: 'QR_SANDBOX_IPN',
    });
}

module.exports = {
    calculateParkingFee,
    createPendingPayment,
    listPayments,
    getPayment,
    getCheckoutByToken,
    createQrSandbox,
    confirmCash,
    confirmQrSandbox,
};
