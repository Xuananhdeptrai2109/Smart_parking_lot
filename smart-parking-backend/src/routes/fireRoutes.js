const express = require('express');
const controller = require('../controllers/fireController');

const router = express.Router();
router.get('/status', controller.getStatus);
router.post('/snapshots', controller.createSnapshot);
router.post('/actions/:commandId/ack', controller.acknowledge);
router.post('/incidents/:id/resolve', controller.resolve);

module.exports = router;
