#!/bin/sh
set -eu

# Asterisk не умеет подставлять переменные окружения в конфиги, поэтому рендерим
# шаблоны из /etc/asterisk-template (смонтирован ro) в рабочий /etc/asterisk.
# Так SIP-креды живут в .env и не попадают в git.

: "${SIP_PROVIDER_HOST:?SIP_PROVIDER_HOST не задан в .env}"
: "${SIP_USER:?SIP_USER не задан в .env}"
: "${SIP_PASSWORD:?SIP_PASSWORD не задан в .env}"
: "${SIP_CALLER_ID:?SIP_CALLER_ID не задан в .env}"
: "${ARI_USER:?ARI_USER не задан в .env}"
: "${ARI_PASSWORD:?ARI_PASSWORD не задан в .env}"
: "${RTP_EXTERNAL_HOST:=}"

mkdir -p /etc/asterisk

for template in /etc/asterisk-template/*; do
    name=$(basename "$template")
    case "$name" in
    *.template)
        envsubst <"$template" >"/etc/asterisk/${name%.template}"
        ;;
    *)
        cp "$template" "/etc/asterisk/$name"
        ;;
    esac
done

chown -R asterisk:asterisk /etc/asterisk
chmod 640 /etc/asterisk/pjsip.conf /etc/asterisk/ari.conf

exec "$@"
