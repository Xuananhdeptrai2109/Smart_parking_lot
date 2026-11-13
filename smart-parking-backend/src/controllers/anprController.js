const crypto = require('crypto');
const anprService = require('../services/anprService');
const AppError = require('../utils/AppError');

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function recognize(req, res, next) {
    try {
        const expectedKey = process.env.ANPR_DEVICE_KEY;
        if (!expectedKey) throw new AppError('ANPR_DEVICE_KEY is not configured.', 503);
        if (!safeEqual(req.get('X-Device-Key'), expectedKey)) {
            throw new AppError('The camera is not authorized to upload images.', 401);
        }

        const result = await anprService.recognize({
            buffer: req.body,
            eventId: req.get('X-Event-Id'),
            direction: String(req.get('X-Direction') || '').toUpperCase(),
            imageWidth: req.get('X-Image-Width'),
            imageHeight: req.get('X-Image-Height'),
            requestBaseUrl: `${req.protocol}://${req.get('host')}`,
        });
        return res.status(201).json(result);
    } catch (error) {
        return next(error);
    }
}

module.exports = { recognize };
