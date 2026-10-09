// Public-only BIP32/BIP86 parity oracle from the pinned Pearl implementation.
// No seed, private derivation, signature generation, network or wallet calls.
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"

	"github.com/pearl-research-labs/pearl/node/btcec/schnorr"
	"github.com/pearl-research-labs/pearl/node/btcutil"
	"github.com/pearl-research-labs/pearl/node/btcutil/hdkeychain"
	"github.com/pearl-research-labs/pearl/node/chaincfg"
	"github.com/pearl-research-labs/pearl/node/txscript"
)

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func decode(s string) []byte { b, err := hex.DecodeString(s); must(err); return b }
func main() {
	if len(os.Args) != 2 {
		panic("usage: parity-oracle public-account.json")
	}
	raw, err := os.ReadFile(os.Args[1])
	must(err)
	var account struct {
		PublicKey string
		ChainCode string
	}
	must(json.Unmarshal(raw, &account))
	params := &chaincfg.SimNetParams
	key := hdkeychain.NewExtendedKey(params.HDPublicKeyID[:], decode(account.PublicKey), decode(account.ChainCode), []byte{0, 0, 0, 0}, 3, hdkeychain.HardenedKeyStart, false)
	branch, err := key.Derive(0)
	must(err)
	found := map[string]bool{}
	var results []map[string]interface{}
	for index := uint32(0); index < 100 && len(found) < 4; index++ {
		child, err := branch.Derive(index)
		must(err)
		internal, err := child.ECPubKey()
		must(err)
		output := txscript.ComputeTaprootKeyNoScript(internal)
		internalParity, outputParity := internal.SerializeCompressed()[0]&1, output.SerializeCompressed()[0]&1
		pair := fmt.Sprintf("%d/%d", internalParity, outputParity)
		if found[pair] {
			continue
		}
		found[pair] = true
		address, err := btcutil.NewAddressTaproot(schnorr.SerializePubKey(output), params)
		must(err)
		results = append(results, map[string]interface{}{"branch": 0, "index": index, "internalParity": internalParity, "outputParity": outputParity, "compressedInternalKey": hex.EncodeToString(internal.SerializeCompressed()), "compressedOutputKey": hex.EncodeToString(output.SerializeCompressed()), "address": address.EncodeAddress(), "scriptPubKey": "5120" + hex.EncodeToString(schnorr.SerializePubKey(output))})
	}
	if len(found) != 4 {
		panic("Did not cover all parity combinations")
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	must(enc.Encode(results))
}
