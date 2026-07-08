#!/bin/sh
set -eu

: "${PROXY_USER:?PROXY_USER is required}"
: "${PROXY_PASS:?PROXY_PASS is required}"
: "${ALLOWED_SOURCE_IP:?ALLOWED_SOURCE_IP is required}"

cat > /etc/tinyproxy/tinyproxy.conf <<EOF
User tinyproxy
Group tinyproxy
Port 8888
Listen 0.0.0.0
Timeout 600
DefaultErrorFile "/usr/share/tinyproxy/default.html"
StatFile "/usr/share/tinyproxy/stats.html"
LogFile "/dev/stdout"
LogLevel Connect
PidFile "/run/tinyproxy/tinyproxy.pid"
MaxClients 100
MinSpareServers 2
MaxSpareServers 10
StartServers 2
DisableViaHeader Yes
ConnectPort 443
Allow ${ALLOWED_SOURCE_IP}
BasicAuth ${PROXY_USER} ${PROXY_PASS}
EOF

exec tinyproxy -d -c /etc/tinyproxy/tinyproxy.conf
