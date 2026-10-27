const accessService = require('../services/accessService');

async function entry(req, res, next) {
    try {
        const result = await accessService.processEntry(req.body || {});
        return res.status(result.allowed ? 201 : 409).json({
            message: result.allowed ? 'Cho phép xe vào.' : result.reason,
            data: result,
        });
    } catch (error) {
        return next(error);
    }
}

async function exit(req, res, next) {
    try {
        const result = await accessService.processExit(req.body || {});
        const statusCode = result.paymentRequired ? 202 : (result.allowed ? 200 : 409);
        return res.status(statusCode).json({
            message: result.paymentRequired ? 'Đã xác thực xe. Đang chờ thanh toán.' : (result.allowed ? 'Cho phép xe ra.' : result.reason),
            data: result,
        });
    } catch (error) {
        return next(error);
    }
}

async function status(req, res, next) {
    try {
        return res.json({ data: await accessService.getAccessStatus() });
    } catch (error) {
        return next(error);
    }
}

async function gateState(req, res, next) {
    try {
        const result = await accessService.processGateState(req.body || {});
        return res.status(result.duplicate ? 200 : 201).json({
            message: 'Đã cập nhật trạng thái cổng.',
            data: result,
        });
    } catch (error) {
        return next(error);
    }
}

module.exports = { entry, exit, status, gateState };
