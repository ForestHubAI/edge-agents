# ForestHub MQTT broker component — a thin wrapper over stock mosquitto.
#
# No auth plugin: mosquitto enforces auth (password_file) and topic ACL (acl_file)
# natively, offline, from files the entrypoint renders at boot out of the component
# boot config + secret file. The base image already ships the broker; nothing is
# compiled here.
FROM eclipse-mosquitto:2

# jq: the entrypoint parses the JSON boot config and secret file with it.
RUN apk add --no-cache jq

COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# The fixed component-contract port (contract/component-constants.json → mosquitto).
EXPOSE 1883

ENTRYPOINT ["/entrypoint.sh"]
