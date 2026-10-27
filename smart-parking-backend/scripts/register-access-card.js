const prisma = require('../src/config/db');
const { normalizeRfid } = require('../src/utils/normalizers');

async function main() {
    const uid = normalizeRfid(process.argv[2]);
    const label = String(process.argv.slice(3).join(' ') || `Thẻ ${uid}`).trim();

    if (!uid || uid.length > 100) {
        throw new Error('UID không hợp lệ. Ví dụ: npm.cmd run card:register -- A9FB4420');
    }

    const existing = await prisma.accessCard.findUnique({ where: { uid } });
    const card = await prisma.accessCard.upsert({
        where: { uid },
        update: { label },
        create: { uid, label, status: 'AVAILABLE' },
    });

    console.log(existing ? 'Đã cập nhật thẻ:' : 'Đã thêm thẻ:');
    console.log(JSON.stringify(card, null, 2));
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
