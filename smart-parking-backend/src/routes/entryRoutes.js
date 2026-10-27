const express = require('express');
const {
    getActiveSession,
    getSessionById,
} = require('../controllers/entryController');

const router = express.Router();

router.get('/active/:licensePlate', getActiveSession);
router.get('/:id', getSessionById);

module.exports = router;
