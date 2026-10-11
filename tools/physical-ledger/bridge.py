"""Pinned ledgerblue HID only. No proxy, network, signing keys or auto-approval."""
import json
import signal
import sys
from importlib.metadata import version
from ledgerblue.commException import CommException


def raw_exchange(dongle, apdu):
    try:
        return bytes(dongle.exchange(bytearray(apdu), timeout=120)) + b"\x90\x00"
    except CommException as error:
        if error.data is None:  # A timeout is not a device status word.
            raise
        return bytes(error.data) + error.sw.to_bytes(2, "big")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        class Mock:
            def __init__(self, status): self.status = status
            def exchange(self, _apdu, timeout):
                if self.status != 0x9000:
                    raise CommException("mock", self.status, b"\x10\x01")
                return b"\x10\x01"
        for status in [0x9000, 0xe000, 0x6985, 0x6a80]:
            assert raw_exchange(Mock(status), b"") == b"\x10\x01" + status.to_bytes(2, "big")
        class Timeout:
            def exchange(self, _apdu, timeout): raise CommException("timeout")
        try:
            raw_exchange(Timeout(), b"")
            raise AssertionError("Transport timeout was converted to a device status")
        except CommException:
            pass
        print("PASS: success/continuation/rejection statuses preserved; timeout stays terminal; no HID opened")
        sys.exit(0)
    if sys.argv[1:] != ["--physical"]: raise SystemExit("Explicit --physical required")
    if version("ledgerblue") != "0.1.58": raise SystemExit("Pinned ledgerblue 0.1.58 required")
    import hid
    from ledgerblue import comm
    assert not comm.APDUGEN, "APDU generation environment is unsupported"
    paths = {d["path"] for d in hid.enumerate(0x2c97, 0)
             if d.get("interface_number") == 0 or d.get("usage_page") == 0xffa0}
    assert len(paths) == 1, "Exactly one Ledger HID interface required"
    device = hid.device()
    dongle = None
    def terminate(_signal, _frame): raise SystemExit(1)
    signal.signal(signal.SIGTERM, terminate)
    try:
        device.open_path(paths.pop())
        device.set_nonblocking(True)
        dongle = comm.HIDDongleHIDAPI(device, ledger=True, debug=False)
        for line in sys.stdin:
            request = json.loads(line)
            apdu = bytes.fromhex(request["apdu"])
            assert 5 <= len(apdu) <= 260 and len(apdu) == 5 + apdu[4]
            response = raw_exchange(dongle, apdu)
            print(json.dumps({"response": response.hex()}), flush=True)
            if response[-2:] not in (b"\x90\x00", b"\xe0\x00"):
                break
    finally:
        if dongle: dongle.close()
        else: device.close()
