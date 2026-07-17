# Alpine 3.20 даёт Asterisk 20 LTS готовым пакетом.
# Debian bookworm не подходит: пакет asterisk из main выпилен, остались только звуки.
FROM alpine:3.20

RUN apk add --no-cache \
    asterisk \
    asterisk-sounds-en \
    gettext \
    ca-certificates

RUN mkdir -p /var/lib/asterisk/sounds/voice /var/spool/asterisk/recording \
    && chown -R asterisk:asterisk /var/lib/asterisk /var/spool/asterisk

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 5060/udp 8088/tcp 10000-10100/udp

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# -f: foreground (не демонизировать, иначе контейнер сразу выйдет)
CMD ["asterisk", "-f", "-U", "asterisk", "-G", "asterisk"]
