const deviceService = require('../services/deviceService');
const commandService = require('../services/commandService');
const fireService = require('../services/fireService');

async function heartbeat(req, res, next) {
    try {
        const result = await deviceService.processHeartbeat(req.body || {});
        return res.status(result.duplicate ? 200 : 201).json({
            message: 'Đã ghi nhận heartbeat thiết bị.',
            data: result,
        });
    } catch (error) {
        return next(error);
    }
}

async function acknowledgeCommand(req, res, next) {
    try {
        const success = req.body?.success !== false;
        const command = await commandService.acknowledge(
            req.params.commandId,
            success,
            req.body?.failureReason,
        );
        let fire = null;
        if (command.domain === 'FIRE') {
            fire = await fireService.acknowledgeAction(
                req.params.commandId,
                success,
                req.body?.failureReason,
            );
        }
        return res.json({ message: 'Đã ghi nhận phản hồi lệnh.', data: { command, fire } });
    } catch (error) {
        return next(error);
    }
}

module.exports = { heartbeat, acknowledgeCommand };
