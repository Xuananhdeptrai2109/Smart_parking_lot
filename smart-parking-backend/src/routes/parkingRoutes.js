const express = require('express');
const controller = require('../controllers/parkingController');

const router = express.Router();
router.get('/status', controller.getStatus);
router.post('/spots/events', controller.updateSpot);

module.exports = router;
