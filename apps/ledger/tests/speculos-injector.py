#!/usr/bin/env python3
"""Test-only SEPH injector around unmodified Speculos 0.27.1.

Upstream RAW! rejects tags absent from its Python enum before firmware receives
anything. Permit numeric byte tags for USB status/ITC fault tests. This changes
only the emulator input generator, never the app, crypto, review or syscall code.
"""
from speculos.mcu.seproxyhal import SeProxyHal
from speculos import main
original = SeProxyHal.to_app

def to_app(self, packet):
    if packet.startswith(b"RAW!") and len(packet) >= 5:
        self.socket_helper.queue_packet(packet[4], packet[5:])
    else:
        original(self, packet)

SeProxyHal.to_app = to_app
if __name__ == "__main__":
    main.main(prog="speculos-injector")
