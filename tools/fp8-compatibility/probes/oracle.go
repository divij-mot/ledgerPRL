// Differential verification against the pinned upstream Pearl implementation.
// Uses only published deterministic fixtures. Never connects to a node or signs.
package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"github.com/pearl-research-labs/pearl/node/btcec/schnorr"
	"github.com/pearl-research-labs/pearl/node/btcutil"
	"github.com/pearl-research-labs/pearl/node/btcutil/hdkeychain"
	"github.com/pearl-research-labs/pearl/node/chaincfg"
	"github.com/pearl-research-labs/pearl/node/chaincfg/chainhash"
	"github.com/pearl-research-labs/pearl/node/txscript"
	"github.com/pearl-research-labs/pearl/node/wire"
)

type input struct {
	Txid         string
	Vout         uint32
	Amount       string
	ScriptPubKey string
	Branch       uint32
	Index        uint32
}
type fixture struct {
	PublicAccount struct {
		PublicKey string
		ChainCode string
	}
	Bundle     struct{ Inputs []input }
	Sighashes  []string
	Signatures []string
	RawTx      string
	Txid       string
	Wtxid      string
	Addresses  map[string]string
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func unhex(s string) []byte { b, err := hex.DecodeString(s); must(err); return b }
func equal(label, got, want string) {
	if got != want {
		panic(fmt.Sprintf("%s: got %s, want %s", label, got, want))
	}
}
func main() {
	if len(os.Args) != 2 {
		panic("usage: pearl-oracle fixture.json")
	}
	raw, err := os.ReadFile(os.Args[1])
	must(err)
	var f fixture
	must(json.Unmarshal(raw, &f))
	tx := wire.NewMsgTx(1)
	reader := bytes.NewReader(unhex(f.RawTx))
	must(tx.Deserialize(reader))
	if reader.Len() != 0 {
		panic("trailing transaction bytes")
	}
	equal("txid", tx.TxHash().String(), f.Txid)
	equal("wtxid", tx.WitnessHash().String(), f.Wtxid)
	fetcher := txscript.NewMultiPrevOutFetcher(nil)
	for _, in := range f.Bundle.Inputs {
		hash, err := chainhash.NewHashFromStr(in.Txid)
		must(err)
		amount, err := strconv.ParseInt(in.Amount, 10, 64)
		must(err)
		fetcher.AddPrevOut(wire.OutPoint{Hash: *hash, Index: in.Vout}, wire.NewTxOut(amount, unhex(in.ScriptPubKey)))
	}
	hashes := txscript.NewTxSigHashes(tx, fetcher)
	// BIP32 official vector 1, publicly known forever. No custody material.
	master, err := hdkeychain.NewMaster(unhex("000102030405060708090a0b0c0d0e0f"), &chaincfg.RegressionNetParams)
	must(err)
	account := master
	for _, n := range []uint32{86, 1, 0} {
		account, err = account.Derive(n + hdkeychain.HardenedKeyStart)
		must(err)
	}
	pub, err := account.ECPubKey()
	must(err)
	equal("account public key", hex.EncodeToString(pub.SerializeCompressed()), f.PublicAccount.PublicKey)
	for i, in := range f.Bundle.Inputs {
		digest, err := txscript.CalcTaprootSignatureHash(hashes, txscript.SigHashDefault, tx, i, fetcher)
		must(err)
		equal(fmt.Sprintf("sighash %d", i), hex.EncodeToString(digest), f.Sighashes[i])
		branch, err := account.Derive(in.Branch)
		must(err)
		child, err := branch.Derive(in.Index)
		must(err)
		internal, err := child.ECPubKey()
		must(err)
		output := txscript.ComputeTaprootKeyNoScript(internal)
		outputBytes := schnorr.SerializePubKey(output)
		equal(fmt.Sprintf("owned script %d", i), "5120"+hex.EncodeToString(outputBytes), in.ScriptPubKey)
		sig, err := schnorr.ParseSignature(unhex(f.Signatures[i]))
		must(err)
		if !sig.Verify(digest, output) {
			panic("signature verification failed")
		}
		prev := fetcher.FetchPrevOutput(tx.TxIn[i].PreviousOutPoint)
		engine, err := txscript.NewEngine(prev.PkScript, tx, i, txscript.StandardVerifyFlags, nil, hashes, prev.Value, fetcher)
		must(err)
		must(engine.Execute())
		if i == 0 {
			addr, err := btcutil.NewAddressTaproot(outputBytes, &chaincfg.RegressionNetParams)
			must(err)
			equal("receive address", addr.EncodeAddress(), f.Addresses["input"])
		}
	}
	fmt.Printf("Pearl upstream oracle passed: %d BIP341 digests, %d BIP340 signatures and script-engine executions, account key, BIP86 scripts, receive address, txid and wtxid.\n", len(f.Sighashes), len(f.Signatures))
}
