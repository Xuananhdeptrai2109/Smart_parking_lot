const express = require('express');
const { createExit } = require('../controllers/exitController');

const router = express.Router();

router.post('/exit', createExit);

module.exports = router;
