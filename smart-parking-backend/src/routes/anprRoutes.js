const express = require('express');
const controller = require('../controllers/anprController');

const router = express.Router();
router.post(
    '/recognize',
    express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '4mb' }),
    controller.recognize,
);

module.exports = router;
