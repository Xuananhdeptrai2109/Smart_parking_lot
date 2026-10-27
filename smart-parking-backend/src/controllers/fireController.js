const fireService = require('../services/fireService');
const commandService = require('../services/commandService');
const AppError = require('../utils/AppError');

async function createSnapshot(req, res, next) {
    try {
        const result = await fireService.processSnapshot(req.body || {});
        return res.status(result.duplicate ? 200 : 201).json({
            message: result.hazardDetected ? 'Đã phát hiện nguy cơ cháy.' : 'Không phát hiện nguy cơ cháy.',
            data: result,
        });
    } catch (error) {
        return next(error);
    }
}

async function acknowledge(req, res, next) {
    try {
        if (!req.params.commandId) throw new AppError('commandId là bắt buộc.', 400);
        await commandService.acknowledge(
            req.params.commandId,
            req.body?.success !== false,
            req.body?.failureReason,
        );
        const result = await fireService.acknowledgeAction(
            req.params.commandId,
            req.body?.success !== false,
            req.body?.failureReason,
        );
        return res.json({ message: 'Đã ghi nhận phản hồi thiết bị.', data: result });
    } catch (error) {
        return next(error);
    }
}

async function resolve(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) throw new AppError('Mã sự cố không hợp lệ.', 400);
        const result = await fireService.resolveIncident(id, req.body?.resolution, req.body?.notes);
        return res.json({ message: 'Đã kết thúc chế độ khẩn cấp.', data: result });
    } catch (error) {
        return next(error);
    }
}

async function getStatus(req, res, next) {
    try {
        return res.json({ data: await fireService.getFireStatus() });
    } catch (error) {
        return next(error);
    }
}

module.exports = { createSnapshot, acknowledge, resolve, getStatus };
