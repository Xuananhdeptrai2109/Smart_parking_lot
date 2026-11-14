# Smart Parking - AWS deployment

This deployment is independent from the local development stack.

## Public endpoints

- Frontend: `https://vuaiot.io.vn`
- Backend: `https://api.vuaiot.io.vn`
- MQTT stage 1: `mqtt.vuaiot.io.vn:1883` with username/password

The stage-1 MQTT listener is for initial end-to-end validation only. Migrate it
to MQTT/TLS `8883` (or AWS IoT Core) before treating the system as production.

## Server prerequisites

- Docker Engine and Docker Compose v2
- Ports 80/443 open to the Internet
- Port 1883 open only during the stage-1 MQTT test
- RDS port 3306 open only from the EC2 security group
- An Elastic IP associated with the EC2 instance

## Cloudflare DNS

Create these records and initially set Proxy status to **DNS only**:

| Type | Name | Target |
|---|---|---|
| A | `@` | EC2 Elastic IP |
| A | `api` | EC2 Elastic IP |
| A | `mqtt` | EC2 Elastic IP |

After Caddy has issued certificates successfully, the `@` and `api` records
may be changed to Proxied. Keep `mqtt` as DNS only because normal Cloudflare
proxying does not forward arbitrary MQTT TCP traffic.

## Deploy

Copy the repository to `/opt/smart-parking`, then create the production env:

```bash
cd /opt/smart-parking
cp .env.aws.example smart-parking-backend/.env.production
nano smart-parking-backend/.env.production
```

Validate and start:

```bash
docker compose \
  --env-file smart-parking-backend/.env.production \
  -f docker-compose.aws.yml config --quiet

docker compose \
  --env-file smart-parking-backend/.env.production \
  -f docker-compose.aws.yml up -d --build
```

Check health:

```bash
docker compose \
  --env-file smart-parking-backend/.env.production \
  -f docker-compose.aws.yml ps

docker compose \
  --env-file smart-parking-backend/.env.production \
  -f docker-compose.aws.yml logs --tail=100 backend caddy mqtt

curl -fsS https://api.vuaiot.io.vn/health
```

## Rollback

Do not delete volumes. To stop this stack without removing data:

```bash
docker compose \
  --env-file smart-parking-backend/.env.production \
  -f docker-compose.aws.yml down
```

The named volumes preserve MQTT state, ANPR images, and Caddy certificates.

## Local development remains unchanged

Local commands still use the files inside `smart-parking-backend`:

```powershell
docker compose up -d mqtt
npm.cmd run dev
```

The local frontend continues to use `.env.local` and `npm run dev`.
