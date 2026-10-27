const AppError = require('../utils/AppError');
const paymentService = require('../services/paymentService');

function parseId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Mã giao dịch không hợp lệ.', 400);
    return id;
}

async function list(req, res, next) {
    try {
        return res.json({ data: await paymentService.listPayments(req.query) });
    } catch (error) {
        return next(error);
    }
}

async function detail(req, res, next) {
    try {
        return res.json({ data: await paymentService.getPayment(parseId(req.params.id)) });
    } catch (error) {
        return next(error);
    }
}

async function createQrSandbox(req, res, next) {
    try {
        const result = await paymentService.createQrSandbox(parseId(req.params.id), req.get('origin'));
        return res.status(result.duplicate ? 200 : 201).json({ message: 'Đã tạo mã QR sandbox.', data: result });
    } catch (error) {
        return next(error);
    }
}

async function confirmCash(req, res, next) {
    try {
        const result = await paymentService.confirmCash(parseId(req.params.id), req.body?.confirmedBy);
        return res.json({ message: 'Đã xác nhận thanh toán tiền mặt và gửi lệnh mở cổng.', data: result });
    } catch (error) {
        return next(error);
    }
}

async function checkout(req, res, next) {
    try {
        const token = String(req.params.token || '').trim();
        if (!token) throw new AppError('Mã thanh toán là bắt buộc.', 400);
        return res.json({ data: await paymentService.getCheckoutByToken(token) });
    } catch (error) {
        return next(error);
    }
}

async function confirmSandbox(req, res, next) {
    try {
        const token = String(req.params.token || '').trim();
        if (!token) throw new AppError('Mã thanh toán là bắt buộc.', 400);
        const result = await paymentService.confirmQrSandbox(token);
        return res.json({ message: 'Thanh toán QR sandbox thành công.', data: result });
    } catch (error) {
        return next(error);
    }
}

module.exports = { list, detail, createQrSandbox, confirmCash, checkout, confirmSandbox };
