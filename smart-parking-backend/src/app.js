require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const entryRoutes = require('./routes/entryRoutes');
const accessRoutes = require('./routes/accessRoutes');
const parkingRoutes = require('./routes/parkingRoutes');
const fireRoutes = require('./routes/fireRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const registerSocketHandlers = require('./sockets/socketManager');
const registerMqttHandlers = require('./infrastructure/mqttRouter');
const eventBus = require('./infrastructure/eventBus');
const realtime = require('./infrastructure/realtime');
const commandService = require('./services/commandService');
const prisma = require('./config/db');

const app = express();
const server = http.createServer(app);

const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '1mb' })); // Phân tích JSON body từ thiết bị IoT

// Đăng ký API Routes
app.use('/api/v1/sessions', entryRoutes);
app.use('/api/v1/access', accessRoutes);
app.use('/api/v1/parking', parkingRoutes);
app.use('/api/v1/fire', fireRoutes);
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/v1/payments', paymentRoutes);

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'smart-parking-backend',
        mqtt: eventBus.isConnected() ? 'connected' : 'disconnected',
    });
});

// Cấu hình WebSocket cho các tính năng realtime (bảng LED, báo cháy)
const io = new Server(server, {
    cors: { origin: allowedOrigin },
});
registerSocketHandlers(io);
realtime.setIo(io);
app.set('io', io);

registerMqttHandlers();

app.use((req, res) => {
    res.status(404).json({ message: 'Không tìm thấy API.' });
});

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    const prismaStatusCodes = {
        P2002: 409,
        P2025: 404,
        P2034: 409,
    };
    const statusCode = error.statusCode
        || error.status
        || prismaStatusCodes[error.code]
        || 500;

    if (statusCode >= 500) {
        console.error(error);
    }

    const knownMessages = {
        P2002: 'Dữ liệu đã tồn tại.',
        P2025: 'Không tìm thấy dữ liệu cần xử lý.',
        P2034: 'Dữ liệu đang được xử lý bởi một yêu cầu khác. Vui lòng thử lại.',
    };
    const response = {
        message: knownMessages[error.code]
            || (statusCode >= 500 ? 'Đã xảy ra lỗi máy chủ.' : error.message),
    };

    if (error.details) {
        response.details = error.details;
    }

    return res.status(statusCode).json(response);
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    eventBus.start();
    const commandRetryTimer = setInterval(() => {
        commandService.retryPending().catch((error) => {
            console.error('[Command outbox] Retry failed:', error.message);
        });
    }, 5000);
    commandRetryTimer.unref();
    server.listen(PORT, () => {
        console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });

    const shutdown = async (signal) => {
        console.log(`\n${signal} received. Shutting down...`);
        clearInterval(commandRetryTimer);
        server.close(async () => {
            await eventBus.stop();
            await prisma.$disconnect();
            process.exit(0);
        });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { app, server, io };
