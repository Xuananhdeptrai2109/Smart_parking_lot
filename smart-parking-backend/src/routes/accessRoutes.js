const express = require('express');
const controller = require('../controllers/accessController');

const router = express.Router();
router.get('/status', controller.status);
router.post('/entry', controller.entry);
router.post('/exit', controller.exit);
router.post('/gates/state', controller.gateState);

module.exports = router;
