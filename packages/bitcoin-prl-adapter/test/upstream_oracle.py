#!/usr/bin/env python3
"""Read-only differential oracle using retained, hash-pinned official Ledger Python modules.
No device, network, signing, seed, or private key operations are performed here.
"""
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
from typing import Protocol

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "apps/ledger-bitcoin-prl/bitcoin_client/ledger_bitcoin"
manifest = json.loads((Path(__file__).resolve().parents[1] / "provenance/python-oracle-sources.json").read_text())
for name, expected in manifest["files"].items():
    if hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() != expected:
        raise ValueError(f"Pinned official Python oracle changed: {name}")
# Do not import the package __init__: it loads hardware transports unrelated to
# these dependency-light, unmodified serialization/proof modules.
package = types.ModuleType("ledger_bitcoin")
package.__path__ = [str(SOURCE)]
sys.modules["ledger_bitcoin"] = package
# Protocol is a typing-only compatibility import, provided by Python's standard
# library on supported Python 3.8+. No package installation is needed for this oracle.
if importlib.util.find_spec("typing_extensions") is None:
    typing_compat = types.ModuleType("typing_extensions")
    typing_compat.Protocol = Protocol
    sys.modules["typing_extensions"] = typing_compat
from ledger_bitcoin.common import write_varint, read_varint
from ledger_bitcoin.merkle import MerkleTree, element_hash, get_merkleized_map_commitment
from ledger_bitcoin.client_command import ClientCommandInterpreter
from ledger_bitcoin.wallet import WalletPolicy
from ledger_bitcoin.psbt import PSBT

request = json.load(sys.stdin)
psbt = PSBT()
psbt.deserialize(base64.b64encode(bytes.fromhex(request["psbtHex"])).decode())
policy = WalletPolicy("", "tr(@0/**)", [request["policyKey"]])
maps = [{bytes.fromhex(k): bytes.fromhex(v) for k, v in mapping} for mapping in request["maps"]]
commitments = [get_merkleized_map_commitment(mapping) for mapping in maps]
interpreter = ClientCommandInterpreter()
interpreter.add_known_preimage(policy.serialize())
interpreter.add_known_preimage(b"tr(@0/**)")
interpreter.add_known_list([request["policyKey"].encode()])
for mapping in maps:
    interpreter.add_known_mapping(mapping)
interpreter.add_known_list(commitments[1:1 + len(psbt.inputs)])
interpreter.add_known_list(commitments[1 + len(psbt.inputs):])
# Extra public values exercise long-preimage and long-proof continuation paths.
extra = [bytes([i % 256]) * (1024 if i == 0 else 2) + i.to_bytes(2, "little") for i in range(300)]
interpreter.add_known_list(extra)
transcript = []
def execute(command):
    response = interpreter.execute(command)
    transcript.append({"request": command.hex(), "response": response.hex()})
    return response
for digest, preimage in sorted(interpreter.known_preimages.items()):
    response = execute(b"\x40\x00" + digest)
    reader = io.BytesIO(response)
    length = read_varint(reader)
    count = reader.read(1)[0]
    actual = reader.read(count)
    while len(actual) < length:
        more = execute(b"\xa0")
        assert more[1] == 1
        actual += more[2:]
    assert actual == preimage
for root, tree in sorted(interpreter.known_trees.items()):
    for index in sorted(set([0, len(tree) // 2, len(tree) - 1])):
        response = execute(b"\x41" + root + write_varint(len(tree)) + write_varint(index))
        proof_length, received = response[32:34]
        while received < proof_length:
            more = execute(b"\xa0")
            assert more[1] == 32
            received += more[0]
        execute(b"\x42" + root + tree.leaves[index].value)
    execute(b"\x42" + root + bytes(32))
merkle_vectors = []
for count in [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 300, 4096]:
    leaves = [hashlib.sha256(i.to_bytes(4, "little")).digest() for i in range(count)]
    tree = MerkleTree(leaves)
    merkle_vectors.append({"count": count, "root": tree.root.hex(), "proofs": {
        str(index): [p.hex() for p in tree.prove_leaf(index)]
        for index in sorted(set([0, count // 2, count - 1])) if count
    }})
json.dump({"policy": policy.serialize().hex(), "policyId": policy.id.hex(),
    "commitments": [c.hex() for c in commitments],
    "inputRoot": MerkleTree(element_hash(c) for c in commitments[1:1 + len(psbt.inputs)]).root.hex(),
    "outputRoot": MerkleTree(element_hash(c) for c in commitments[1 + len(psbt.inputs):]).root.hex(),
    "roundtripPsbt": base64.b64decode(psbt.serialize()).hex(),
    "inputAmounts": [str(i.witness_utxo.nValue) for i in psbt.inputs],
    "outputAmounts": [str(o.amount) for o in psbt.outputs],
    "transcript": transcript, "merkleVectors": merkle_vectors}, sys.stdout)
