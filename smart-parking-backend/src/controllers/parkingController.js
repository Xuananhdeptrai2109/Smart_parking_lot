const parkingService = require('../services/parkingService');

async function updateSpot(req, res, next) {
    try {
        const result = await parkingService.processSpotState(req.body || {});
        return res.status(result.duplicate ? 200 : 201).json({
            message: result.duplicate ? 'Sự kiện đã được xử lý trước đó.' : 'Đã cập nhật cảm biến vị trí đỗ.',
            data: result,
        });
    } catch (error) {
        return next(error);
    }
}

async function getStatus(req, res, next) {
    try {
        return res.json({ data: await parkingService.getLotStatus() });
    } catch (error) {
        return next(error);
    }
}

module.exports = { updateSpot, getStatus };
