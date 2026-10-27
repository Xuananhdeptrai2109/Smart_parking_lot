const eventBus = require('./eventBus');
const accessService = require('../services/accessService');
const parkingService = require('../services/parkingService');
const fireService = require('../services/fireService');
const deviceService = require('../services/deviceService');
const commandService = require('../services/commandService');

function registerMqttHandlers() {
    eventBus.registerHandler(eventBus.topics.events.entryRequest, accessService.processEntry);
    eventBus.registerHandler(eventBus.topics.events.exitRequest, accessService.processExit);
    eventBus.registerHandler(eventBus.topics.events.gateState, accessService.processGateState);
    eventBus.registerHandler(eventBus.topics.events.spotState, parkingService.processSpotState);
    eventBus.registerHandler(eventBus.topics.events.fireSnapshot, fireService.processSnapshot);
    eventBus.registerHandler(eventBus.topics.events.heartbeat, deviceService.processHeartbeat);
    eventBus.registerHandler(eventBus.topics.events.commandAck, async (payload) => {
        const command = await commandService.acknowledge(
            payload.commandId,
            payload.success !== false,
            payload.failureReason,
        );
        if (command.domain === 'FIRE') {
            await fireService.acknowledgeAction(
                payload.commandId,
                payload.success !== false,
                payload.failureReason,
            );
        }
        return command;
    });
}

module.exports = registerMqttHandlers;
