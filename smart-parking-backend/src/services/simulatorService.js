const prisma = require('../config/db');
const realtime = require('../infrastructure/realtime');
const { getLotStatus } = require('./parkingService');

const SAMPLE_VEHICLES = [
    { plate: '30A-868.86', type: 'CAR' },
    { plate: '29X1-567.89', type: 'MOTORBIKE' },
    { plate: '51B-123.45', type: 'CAR' },
    { plate: '30H-999.99', type: 'CAR' },
    { plate: '43A-333.22', type: 'CAR' },
    { plate: '14B-888.66', type: 'CAR' },
    { plate: '29A-678.90', type: 'CAR' },
];

let simulatorInterval = null;
let heartbeatInterval = null;
let fireSnapshotInterval = null;
let isRunning = false;

async function sendDeviceHeartbeats() {
    try {
        const devices = await prisma.ioTDevice.findMany();
        const now = new Date();
        for (const device of devices) {
            await prisma.ioTDevice.update({
                where: { id: device.id },
                data: {
                    status: 'ONLINE',
                    lastSeenAt: now,
                    ipAddress: device.ipAddress || '192.168.1.100',
                },
            });
            realtime.emit('device_heartbeat', {
                device: {
                    ...device,
                    status: 'ONLINE',
                    lastSeenAt: now,
                },
            });
        }
    } catch (err) {
        console.error('[Simulator] Heartbeat error:', err.message);
    }
}

function sendSafeFireSnapshot() {
    try {
        const snapshot = {
            flameNW: +(0.01 + Math.random() * 0.03).toFixed(3),
            flameNE: +(0.01 + Math.random() * 0.02).toFixed(3),
            flameSW: +(0.01 + Math.random() * 0.03).toFixed(3),
            flameSE: +(0.01 + Math.random() * 0.02).toFixed(3),
            gasLevel: +(0.08 + Math.random() * 0.06).toFixed(3),
            maxFlameIntensity: 0.04,
            status: 'SAFE',
            recordedAt: new Date().toISOString(),
        };
        realtime.emit('fire_snapshot', { snapshot });
    } catch (err) {
        console.error('[Simulator] Fire snapshot error:', err.message);
    }
}

async function simulateTrafficCycle() {
    try {
        const spots = await prisma.parkingSpot.findMany({
            orderBy: { id: 'asc' },
        });

        const activeSessions = await prisma.parkingSession.findMany({
            where: { status: 'ACTIVE' },
            include: { Vehicle: true, AssignedSpot: true },
        });

        const freeSpots = spots.filter(s => s.status === 'FREE');
        const occupiedSpots = spots.filter(s => s.status === 'OCCUPIED');

        // Target: Keep between 1 and 3 spots occupied to show a realistic, active parking lot
        const shouldEnter = freeSpots.length > 0 && (occupiedSpots.length < 2 || (occupiedSpots.length < 3 && Math.random() > 0.4));

        if (shouldEnter) {
            // Pick a random free spot
            const spot = freeSpots[Math.floor(Math.random() * freeSpots.length)];
            
            // Pick a vehicle that is not already actively parked
            const activePlates = new Set(activeSessions.map(s => s.Vehicle?.licensePlate));
            const availableVehicle = SAMPLE_VEHICLES.find(v => !activePlates.has(v.plate)) 
                || { plate: `30A-${Math.floor(10000 + Math.random() * 90000)}`, type: 'CAR' };

            let vehicle = await prisma.vehicle.findUnique({
                where: { licensePlate: availableVehicle.plate },
            });
            if (!vehicle) {
                vehicle = await prisma.vehicle.create({
                    data: {
                        licensePlate: availableVehicle.plate,
                        vehicleType: availableVehicle.type,
                    },
                });
            }

            const now = new Date();
            const session = await prisma.parkingSession.create({
                data: {
                    vehicleId: vehicle.id,
                    assignedSpotId: spot.id,
                    entryTime: now,
                    entryGate: 'ENTRY_GATE',
                    entryImage: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=600&auto=format&fit=crop&q=80',
                    status: 'ACTIVE',
                },
                include: { Vehicle: true, AssignedSpot: true },
            });

            await prisma.parkingSpot.update({
                where: { id: spot.id },
                data: { status: 'OCCUPIED', lastUpdated: now },
            });

            const lot = await getLotStatus();

            realtime.emit('gate_state_changed', {
                gate: { gateCode: 'ENTRY_GATE', state: 'OPEN' },
            });

            setTimeout(() => {
                realtime.emit('gate_state_changed', {
                    gate: { gateCode: 'ENTRY_GATE', state: 'CLOSED' },
                });
            }, 3000);

            realtime.emit('spot_status_changed', {
                spot: { ...spot, status: 'OCCUPIED' },
                lot,
            });

            realtime.emit('vehicle_entered', {
                session,
                lot,
            });

            console.log(`[Simulator] Xe vào: ${vehicle.licensePlate} -> Ô ${spot.spotName}`);
        } else if (activeSessions.length > 0) {
            // An active vehicle leaves
            const sessionToExit = activeSessions[Math.floor(Math.random() * activeSessions.length)];
            const spot = spots.find(s => s.id === sessionToExit.assignedSpotId);
            const now = new Date();

            const fee = 10000;
            await prisma.payment.upsert({
                where: { sessionId: sessionToExit.id },
                update: {
                    paymentStatus: 'SUCCESS',
                    amount: fee,
                    transactionTime: now,
                },
                create: {
                    sessionId: sessionToExit.id,
                    amount: fee,
                    paymentMethod: 'CASH',
                    paymentStatus: 'SUCCESS',
                    transactionTime: now,
                },
            });

            const updatedSession = await prisma.parkingSession.update({
                where: { id: sessionToExit.id },
                data: {
                    status: 'COMPLETED',
                    exitTime: now,
                    exitGate: 'EXIT_GATE',
                    exitImage: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=600&auto=format&fit=crop&q=80',
                },
                include: { Vehicle: true, AssignedSpot: true },
            });

            if (spot) {
                await prisma.parkingSpot.update({
                    where: { id: spot.id },
                    data: { status: 'FREE', lastUpdated: now },
                });
            }

            const lot = await getLotStatus();

            realtime.emit('gate_state_changed', {
                gate: { gateCode: 'EXIT_GATE', state: 'OPEN' },
            });

            setTimeout(() => {
                realtime.emit('gate_state_changed', {
                    gate: { gateCode: 'EXIT_GATE', state: 'CLOSED' },
                });
            }, 3000);

            if (spot) {
                realtime.emit('spot_status_changed', {
                    spot: { ...spot, status: 'FREE' },
                    lot,
                });
            }

            realtime.emit('vehicle_exited', {
                session: updatedSession,
                lot,
            });

            realtime.emit('payment_status_changed', {
                payment: {
                    sessionId: updatedSession.id,
                    amount: fee,
                    paymentStatus: 'SUCCESS',
                    ParkingSession: updatedSession,
                },
            });

            console.log(`[Simulator] Xe ra & thanh toán: ${sessionToExit.Vehicle?.licensePlate} rời ô ${spot?.spotName || 'N/A'}`);
        }
    } catch (err) {
        console.error('[Simulator] Traffic cycle error:', err.message);
    }
}

async function ensureInitialRealisticState() {
    try {
        const spots = await prisma.parkingSpot.findMany({ orderBy: { id: 'asc' } });
        const activeSessions = await prisma.parkingSession.count({ where: { status: 'ACTIVE' } });
        
        // If parking lot has 0 active sessions, seed 2 realistic cars parked in A1 and A3
        if (activeSessions === 0 && spots.length >= 2) {
            console.log('[Simulator] Khởi tạo dữ liệu bãi đỗ xe ban đầu (A1 và A3 có xe)...');
            const targetSpots = [spots[0], spots[2]]; // A1 and A3
            const initialVehicles = [SAMPLE_VEHICLES[0], SAMPLE_VEHICLES[1]];

            for (let i = 0; i < targetSpots.length; i++) {
                const targetSpot = targetSpots[i];
                const sampleV = initialVehicles[i];

                let vehicle = await prisma.vehicle.findUnique({
                    where: { licensePlate: sampleV.plate },
                });
                if (!vehicle) {
                    vehicle = await prisma.vehicle.create({
                        data: { licensePlate: sampleV.plate, vehicleType: sampleV.type },
                    });
                }

                const entryTime = new Date(Date.now() - (45 + i * 30) * 60 * 1000); // 45-75 mins ago
                await prisma.parkingSession.create({
                    data: {
                        vehicleId: vehicle.id,
                        assignedSpotId: targetSpot.id,
                        entryTime,
                        entryGate: 'ENTRY_GATE',
                        entryImage: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=600&auto=format&fit=crop&q=80',
                        status: 'ACTIVE',
                    },
                });

                await prisma.parkingSpot.update({
                    where: { id: targetSpot.id },
                    data: { status: 'OCCUPIED', lastUpdated: entryTime },
                });
            }
        }
    } catch (err) {
        console.error('[Simulator] Initial state error:', err.message);
    }
}

function start() {
    if (isRunning) return;
    isRunning = true;

    console.log('🚗 [Simulator] Demo Simulator được kích hoạt (mô phỏng bãi xe trực quan thời gian thực)');

    // Ensure initial state
    ensureInitialRealisticState().then(() => {
        sendDeviceHeartbeats();
        sendSafeFireSnapshot();
    });

    // Device heartbeats every 20 seconds
    heartbeatInterval = setInterval(sendDeviceHeartbeats, 20000);
    heartbeatInterval.unref();

    // Fire ambient snapshot every 10 seconds
    fireSnapshotInterval = setInterval(sendSafeFireSnapshot, 10000);
    fireSnapshotInterval.unref();

    // Simulated traffic cycle every 35-45 seconds
    const intervalSeconds = Number.parseInt(process.env.SIMULATOR_INTERVAL_SECONDS, 10) || 40;
    simulatorInterval = setInterval(simulateTrafficCycle, intervalSeconds * 1000);
    simulatorInterval.unref();
}

function stop() {
    if (!isRunning) return;
    isRunning = false;
    clearInterval(heartbeatInterval);
    clearInterval(fireSnapshotInterval);
    clearInterval(simulatorInterval);
    console.log('🛑 [Simulator] Demo Simulator đã dừng.');
}

module.exports = {
    start,
    stop,
};

