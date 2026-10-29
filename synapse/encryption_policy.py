"""Synapse policy: reject any plaintext timeline event on the local homeserver."""


class RequireEncryptedTimelineEvents:
    """Fail closed unless an event is sent as Matrix ciphertext."""

    @staticmethod
    def parse_config(config):
        return config

    def __init__(self, config, module_api):
        module_api.register_third_party_rules_callbacks(
            check_event_allowed=self.check_event_allowed,
        )

    async def check_event_allowed(self, event, state_events):
        # State events (membership, room name, encryption state) carry room metadata.
        # Timeline events carrying conversation content must use Matrix E2EE.
        if not event.is_state() and event.type != "m.room.encrypted":
            return False, None
        return True, None
