let ioInstance = null;

function setIo(io) {
    ioInstance = io;
}

function emit(eventName, payload) {
    ioInstance?.emit(eventName, payload);
}

module.exports = { setIo, emit };
