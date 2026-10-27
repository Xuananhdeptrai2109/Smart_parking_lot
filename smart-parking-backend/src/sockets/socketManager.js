function registerSocketHandlers(io) {
    io.on('connection', (socket) => {
        console.log(`[Socket] Dashboard connected: ${socket.id}`);

        socket.on('subscribe_dashboard', () => {
            socket.join('dashboard');
            socket.emit('subscription_ready', { room: 'dashboard' });
        });

        socket.on('disconnect', () => {
            console.log(`[Socket] Dashboard disconnected: ${socket.id}`);
        });
    });
}

module.exports = registerSocketHandlers;
