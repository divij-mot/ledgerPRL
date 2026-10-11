package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/pearl-research-labs/pearl/node/blockchain"
	"github.com/pearl-research-labs/pearl/node/btcutil"
	"github.com/pearl-research-labs/pearl/node/chaincfg"
	"github.com/pearl-research-labs/pearl/node/chaincfg/chainhash"
	"github.com/pearl-research-labs/pearl/node/txscript"
	"github.com/pearl-research-labs/pearl/node/wire"
	"os"
	"path/filepath"
	"strconv"
)

type Row struct {
	RawTx, Txid string
	Bundle      struct {
		Inputs []struct {
			Txid, Amount, ScriptPubKey string
			Vout                       uint32
		}
	}
}

func must(e error) {
	if e != nil {
		panic(e)
	}
}
func check(b bool, s string) {
	if !b {
		panic(s)
	}
}
func unhex(s string) []byte { b, e := hex.DecodeString(s); must(e); return b }
func verify(t *wire.MsgTx, i int, f *txscript.MultiPrevOutFetcher) error {
	p := f.FetchPrevOutput(t.TxIn[i].PreviousOutPoint)
	h := txscript.NewTxSigHashes(t, f)
	eng, e := txscript.NewEngine(p.PkScript, t, i, txscript.StandardVerifyFlags, nil, h, p.Value, f)
	if e != nil {
		return e
	}
	return eng.Execute()
}
func main() {
	out := map[string]any{"scope": "Synthetic UTXO script/sanity/input validation; no live chain, mempool fee policy, or P2MR spending claim", "upstream": "2f8b770cac8f8b74be05c1fc51c2baeb76ce0701"}
	var rows []map[string]any
	names := os.Args[2:]
	if len(names) == 0 {
		names = []string{"overflow-high-fee", "max-minus-one", "p2mr-ff-root"}
	}
	for _, name := range names {
		raw, e := os.ReadFile(filepath.Join(os.Args[1], name+".json"))
		must(e)
		var c Row
		must(json.Unmarshal(raw, &c))
		tx := wire.NewMsgTx(1)
		must(tx.Deserialize(bytes.NewReader(unhex(c.RawTx))))
		check(tx.TxHash().String() == c.Txid, "txid mismatch")
		f := txscript.NewMultiPrevOutFetcher(nil)
		view := blockchain.NewUtxoViewpoint()
		for _, in := range c.Bundle.Inputs {
			h, e := chainhash.NewHashFromStr(in.Txid)
			must(e)
			v, e := strconv.ParseInt(in.Amount, 10, 64)
			must(e)
			p := wire.OutPoint{Hash: *h, Index: in.Vout}
			o := wire.NewTxOut(v, unhex(in.ScriptPubKey))
			f.AddPrevOut(p, o)
			view.Entries()[p] = blockchain.NewUtxoEntry(o, 1, false)
		}
		must(blockchain.CheckTransactionSanity(btcutil.NewTx(tx)))
		fee, e := blockchain.CheckTransactionInputs(btcutil.NewTx(tx), 201, view, &chaincfg.RegressionNetParams)
		must(e)
		negative := 0
		for i := range tx.TxIn {
			must(verify(tx, i, f))
			bad := tx.Copy()
			bad.TxOut[0].Value++
			check(verify(bad, i, f) != nil, "mutated amount accepted")
			negative++
			bad = tx.Copy()
			bad.TxOut[0].PkScript[2] ^= 1
			check(verify(bad, i, f) != nil, "mutated recipient accepted")
			negative++
			bad = tx.Copy()
			bad.TxIn[i].Sequence--
			check(verify(bad, i, f) != nil, "mutated sequence accepted")
			negative++
		}
		rows = append(rows, map[string]any{"name": name, "txid": c.Txid, "validInputScripts": len(tx.TxIn), "negativeScriptChecks": negative, "feeGrains": strconv.FormatInt(fee, 10), "recipientClass": txscript.GetScriptClass(tx.TxOut[0].PkScript).String()})
	}
	out["cases"] = rows
	data, e := json.MarshalIndent(out, "", "  ")
	must(e)
	must(os.WriteFile(filepath.Join(os.Args[1], "pearl-oracle.json"), data, 0644))
	fmt.Println(string(data))
}
