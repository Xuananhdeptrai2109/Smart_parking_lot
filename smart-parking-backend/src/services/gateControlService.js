const { randomUUID } = require('crypto');
const prisma = require('../config/db');
const eventBus = require('../infrastructure/eventBus');
const commandService = require('./commandService');

async function sendGateCommand(gate, action, extra = {}) {
    const command = {
        commandId: randomUUID(),
        type: 'gate.command',
        gateCode: gate.gateCode,
        servoDeviceCode: gate.servoDeviceCode,
        action,
        angle: action === 'OPEN' ? gate.openAngle : gate.closedAngle,
        autoCloseMs: action === 'OPEN' ? gate.autoCloseMs : undefined,
        issuedAt: new Date().toISOString(),
        ...extra,
    };

    return commandService.dispatch({
        commandId: command.commandId,
        domain: 'ACCESS',
        deviceCode: gate.servoDeviceCode,
        topic: eventBus.topics.command('gate', gate.servoDeviceCode),
        commandType: `GATE_${action}`,
        payload: command,
    });
}

async function enterEvacuation() {
    const gates = await prisma.gate.findMany();
    const commands = [];

    for (const gate of gates) {
        const isExit = gate.direction === 'EXIT';
        await prisma.gate.update({
            where: { id: gate.id },
            data: { state: isExit ? 'EVACUATION' : 'BLOCKED' },
        });
        commands.push(await sendGateCommand(gate, isExit ? 'OPEN' : 'CLOSE', {
            emergency: true,
            autoCloseMs: isExit ? 0 : undefined,
        }));
    }

    return commands;
}

async function exitEvacuation() {
    const gates = await prisma.gate.findMany();
    const commands = [];

    for (const gate of gates) {
        await prisma.gate.update({
            where: { id: gate.id },
            data: { state: 'CLOSED' },
        });
        commands.push(await sendGateCommand(gate, 'CLOSE', { emergency: false }));
    }

    return commands;
}

module.exports = {
    sendGateCommand,
    enterEvacuation,
    exitEvacuation,
};
