const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { normalizeLicensePlate } = require('../utils/normalizers');

const sessionInclude = {
    Vehicle: true,
    AssignedSpot: true,
    CardAssignment: { include: { AccessCard: true } },
    Payment: true,
};

const getActiveSession = async (req, res, next) => {
    try {
        const licensePlate = normalizeLicensePlate(req.params.licensePlate);
        if (!licensePlate) {
            throw new AppError('Biển số xe hợp lệ là bắt buộc.', 400);
        }

        const session = await prisma.parkingSession.findFirst({
            where: {
                status: 'ACTIVE',
                Vehicle: { licensePlate },
            },
            include: sessionInclude,
            orderBy: { entryTime: 'desc' },
        });
        if (!session) {
            throw new AppError(`Không tìm thấy phiên đang hoạt động của xe ${licensePlate}.`, 404);
        }

        return res.json({ data: session });
    } catch (error) {
        return next(error);
    }
};

const getSessionById = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw new AppError('ID phiên gửi xe phải là số nguyên dương.', 400);
        }

        const session = await prisma.parkingSession.findUnique({
            where: { id },
            include: sessionInclude,
        });
        if (!session) {
            throw new AppError(`Không tìm thấy phiên gửi xe ${id}.`, 404);
        }

        return res.json({ data: session });
    } catch (error) {
        return next(error);
    }
};

const handleEntry = async (req, res) => {
    try {
        const { licensePlate, entryImage, entryGate } = req.body;

        // 1. Kiểm tra xem xe này đã có trong hệ thống chưa (Vé tháng hoặc khách từng gửi)
        let vehicle = await prisma.vehicle.findUnique({
            where: { licensePlate }
        });

        // 2. Nếu xe mới hoàn toàn (khách vãng lai), tự động tạo record
        if (!vehicle) {
            vehicle = await prisma.vehicle.create({
                data: {
                    licensePlate,
                    vehicleType: 'MOTORBIKE' // Có thể lấy từ req.body nếu có AI phân loại xe
                }
            });
        }

        // 3. Tạo phiên đỗ xe (Parking Session)
        const session = await prisma.parkingSession.create({
            data: {
                vehicleId: vehicle.id,
                entryImage,
                entryGate,
                status: 'ACTIVE'
            }
        });

        // Trả về tín hiệu cho Local Controller để mở Barrier
        res.status(200).json({
            message: 'Entry recorded successfully',
            openBarrier: true,
            session
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', openBarrier: false });
    }
};

module.exports = { handleEntry, getActiveSession, getSessionById };
