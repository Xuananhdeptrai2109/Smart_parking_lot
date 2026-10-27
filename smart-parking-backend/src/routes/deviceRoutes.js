const express = require('express');
const controller = require('../controllers/deviceController');

const router = express.Router();
router.post('/heartbeat', controller.heartbeat);
router.post('/commands/:commandId/ack', controller.acknowledgeCommand);

module.exports = router;
