# Khởi tạo lại Smart Parking trên Aiven for MySQL

File cần import: `smart_parking_init.sql`.

File SQL dành cho database mới/trống và chứa:

- 20 bảng cùng index/foreign key theo `prisma/schema.prisma`;
- 26 thiết bị IoT;
- hai cổng `ENTRY_GATE`, `EXIT_GATE`;
- zone `ZONE_A` và bốn ô `A1`–`A4`;
- năm UID RFID thật.

File không chứa hostname, username hoặc password Aiven.

## 1. Tạo service

Trong Aiven Console:

1. Vào project cần sử dụng.
2. Chọn **Create service**.
3. Chọn **MySQL**, cloud/region và plan.
4. Chờ trạng thái service chuyển sang **Running**.
5. Mở **Overview > Quick connect** và ghi lại Host, Port, User, Password, Database và Service URI.

Database mặc định thường là `defaultdb`.

## 2. Import bằng MySQL CLI

Mở PowerShell:

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" `
  --host="HOST_AIVEN" `
  --port=PORT_AIVEN `
  --user="avnadmin" `
  --password `
  --ssl-mode=REQUIRED `
  defaultdb
```

Không đặt password trực tiếp trong câu lệnh. MySQL sẽ hỏi password sau khi chạy.

Tại dấu nhắc `mysql>`, chạy:

```sql
SOURCE C:/Users/ADMIN/OneDrive/Documents/Project/Smart_parking_lot/smart-parking-backend/database/smart_parking_init.sql;
```

Cuối quá trình, kết quả mong đợi:

```text
deviceCount = 26
gateCount   = 2
spotCount   = 4
cardCount   = 5
```

Thoát MySQL:

```sql
exit;
```

## 3. Cập nhật backend

Trong Aiven Quick connect, sao chép nguyên **Service URI**. Mở `.env` và thay dòng cũ:

```env
DATABASE_URL="mysql://avnadmin:PASSWORD_DA_MA_HOA@HOST:PORT/defaultdb?ssl-mode=REQUIRED"
```

Nên dùng nguyên Service URI do Aiven cung cấp. Nếu tự tạo URL, các ký tự đặc biệt trong password như `@`, `:`, `/`, `?`, `#`, `%` phải được percent-encode.

Không gửi hoặc commit file `.env` vì nó chứa password thật.

## 4. Kiểm tra

Tại thư mục `smart-parking-backend`:

```powershell
npm.cmd run prisma:validate
npm.cmd run db:push
npm.cmd run dev
```

Vì SQL đã chứa seed, không bắt buộc chạy `db:seed`. Có thể chạy lại nếu cần đồng bộ dữ liệu nền:

```powershell
npm.cmd run db:seed
```

Kiểm tra:

```text
http://localhost:3000/health
http://localhost:3000/api/v1/parking/status
http://localhost:3000/api/v1/fire/status
```

`parking/status` và `fire/status` không được trả HTTP 500.

## 5. Cách import thay thế bằng Prisma

Sau khi cập nhật `DATABASE_URL`, có thể chạy:

```powershell
npx.cmd prisma db execute --file database/smart_parking_init.sql --schema prisma/schema.prisma
```

Chỉ dùng một trong hai cách import. Không chạy lại toàn bộ file SQL nếu schema đã được tạo, vì các lệnh `CREATE TABLE` sẽ báo bảng đã tồn tại.
