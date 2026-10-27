const express = require('express');
const controller = require('../controllers/paymentController');

const router = express.Router();

router.get('/', controller.list);
router.get('/checkout/:token', controller.checkout);
router.post('/checkout/:token/sandbox-confirm', controller.confirmSandbox);
router.get('/:id', controller.detail);
router.post('/:id/cash/confirm', controller.confirmCash);
router.post('/:id/qr-sandbox', controller.createQrSandbox);

module.exports = router;
