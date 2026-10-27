const prisma = require('../config/db');

function normalizeLicensePlate(value) {
    return typeof value === 'string'
        ? value.trim().toUpperCase().replace(/\s+/g, '')
        : '';
}

function validateExitInput(body) {
    const licensePlate = normalizeLicensePlate(body.licensePlate);
    const exitImage = typeof body.exitImage === 'string' ? body.exitImage.trim() : '';
    const exitGate = typeof body.exitGate === 'string' ? body.exitGate.trim() : '';
    const errors = [];

    if (!licensePlate || licensePlate.length > 50) {
        errors.push('licensePlate là bắt buộc và không được vượt quá 50 ký tự.');
    }
    if (!exitImage || exitImage.length > 500) {
        errors.push('exitImage là bắt buộc và không được vượt quá 500 ký tự.');
    }
    if (!exitGate || exitGate.length > 100) {
        errors.push('exitGate là bắt buộc và không được vượt quá 100 ký tự.');
    }

    return { errors, data: { licensePlate, exitImage, exitGate } };
}

async function createExit(req, res, next) {
    try {
        const { errors, data } = validateExitInput(req.body || {});

        if (errors.length > 0) {
            return res.status(400).json({
                message: 'Dữ liệu xe ra không hợp lệ.',
                errors,
            });
        }

        const session = await prisma.$transaction(async (tx) => {
            const activeSession = await tx.parkingSession.findFirst({
                where: {
                    status: 'ACTIVE',
                    Vehicle: { licensePlate: data.licensePlate },
                },
                include: { Vehicle: true },
                orderBy: { entryTime: 'desc' },
            });

            if (!activeSession) {
                const error = new Error('Không tìm thấy phiên gửi xe đang hoạt động cho biển số này.');
                error.statusCode = 404;
                throw error;
            }

            const updated = await tx.parkingSession.updateMany({
                where: {
                    id: activeSession.id,
                    status: 'ACTIVE',
                },
                data: {
                    exitTime: new Date(),
                    exitImage: data.exitImage,
                    exitGate: data.exitGate,
                    status: 'COMPLETED',
                },
            });

            if (updated.count !== 1) {
                const error = new Error('Phiên gửi xe đã được xử lý bởi một yêu cầu khác.');
                error.statusCode = 409;
                throw error;
            }

            return tx.parkingSession.findUnique({
                where: { id: activeSession.id },
                include: {
                    Vehicle: {
                        include: { MonthlyPass: true },
                    },
                    Payment: true,
                },
            });
        });

        const entryTime = session.entryTime ? new Date(session.entryTime).getTime() : Date.now();
        const exitTime = session.exitTime ? new Date(session.exitTime).getTime() : Date.now();
        const durationMinutes = Math.max(0, Math.ceil((exitTime - entryTime) / 60000));
        const responseData = { ...session, durationMinutes };

        const io = req.app.get('io');
        io?.emit('session_exit', responseData);

        return res.json({
            message: 'Đã ghi nhận xe ra khỏi bãi.',
            data: responseData,
        });
    } catch (error) {
        return next(error);
    }
}

module.exports = { createExit };
