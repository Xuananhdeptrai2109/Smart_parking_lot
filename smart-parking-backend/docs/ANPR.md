# Camera and license-plate recognition

## Data flow

1. A gate sensor creates an `eventId` and publishes a camera capture request.
2. The ESP32-CAM captures one shared JPEG for the two lanes.
3. The camera uploads the JPEG to `POST /api/v1/anpr/recognize` over HTTPS.
4. The backend stores the original image and calls Plate Recognizer with region `vn`.
5. For `ENTRY`, the backend selects a plate from the right half of the image. For
   `EXIT`, it selects a plate from the left half.
6. The camera publishes the image URL and recognized plate to the Gate ESP32 over
   MQTT. The Gate combines them with the RFID UID and sends the access request.
7. The backend stores the capture in `CameraCapture` and the entry/exit image on
   the parking session.

The provider token exists only in the backend environment. The ESP32-CAM uses a
separate device key generated in the ignored `anpr_credentials.h` file. Do not
reuse the MQTT password for image-upload authentication.

## Production activation

1. Set `PLATE_RECOGNIZER_TOKEN` in `.env.production` on AWS.
2. Allow inbound TCP ports 80 and 443 in the EC2 Security Group. Caddy then
   obtains and renews the HTTPS certificate for `3-105-215-46.sslip.io`.
3. Run `node scripts/configure-anpr.js 3-105-215-46.sslip.io` before deploying
   to generate and synchronize the dedicated camera key.
4. Set `USE_MOCK_ANPR=false` in `firmware/esp32_cam/esp32_cam.ino`.
5. Set `USE_MOCK_CAMERA=false` in
   `firmware/esp32_main_controller/esp32_main_controller.ino`.
6. Upload both sketches and perform the test scenario below.

The stored images live in the Docker volume `anpr-images`, so rebuilding the
backend container does not delete them.

## Real test scenario

- ENTRY: cover/show only the right-side sample plate, trigger the entry sensor,
  scan an available RFID card, and verify that the entry gate opens.
- EXIT: cover/show only the left-side sample plate, trigger the exit sensor, scan
  the same RFID card, complete sandbox payment, and verify the exit gate opens.
- Check the dashboard/session record for the recognized plate, entry/exit time,
  and both stored image links.

Expected ESP32-CAM log:

```text
[CAMERA] Request event=... direction=ENTRY
[CAMERA] Capturing event=... direction=ENTRY
[ANPR] Result event=... published=YES
```

If recognition fails, the HTTP error body and the saved image URL are logged so
the camera angle, light, focus, lane half, and confidence threshold can be checked.
