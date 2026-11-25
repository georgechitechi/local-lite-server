# Deploying on a VPS (No Docker)

## 1. Prerequisites
- Node.js **24+**
- MySQL 8+ or PostgreSQL 15+
- Nginx or Caddy for HTTPS

## 2. Build
```bash
git clone <your-repo> /opt/local-lite-server
cd /opt/local-lite-server
npm install
cd admin && npm install && npm run build && cd ..
npm run build
cp .env.example .env
# Edit .env with your production DB credentials, SERVER_API_KEY, APP_SECRET, and CORS_ORIGINS
```

## 3. Run with systemd

Create `/etc/systemd/system/local-lite-server.service`:

```ini
[Unit]
Description=local-lite-server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/local-lite-server
Environment=NODE_ENV=production
ExecStart=/usr/bin/node --env-file=.env /opt/local-lite-server/dist/cli.js start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now local-lite-server
```

## 4. Reverse Proxy (Nginx)

Disable proxy buffering for SSE (`/sync/events` and `/subscribe/*`):

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

Then run `sudo certbot --nginx -d api.yourdomain.com` for HTTPS.
