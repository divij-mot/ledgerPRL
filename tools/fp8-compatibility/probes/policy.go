// Network-free direct invocation of the pinned actual Pearl mempool checker.
// All scripts/signatures come from the public BIP32 vector 1. Synthetic UTXOs.
package main
import (
 "bytes"
 "encoding/hex"
 "encoding/json"
 "fmt"
 "os"
 "strconv"
 "strings"
 "time"
 "github.com/pearl-research-labs/pearl/node/blockchain"
 "github.com/pearl-research-labs/pearl/node/btcutil"
 "github.com/pearl-research-labs/pearl/node/chaincfg"
 "github.com/pearl-research-labs/pearl/node/chaincfg/chainhash"
 "github.com/pearl-research-labs/pearl/node/mempool"
 "github.com/pearl-research-labs/pearl/node/txscript"
 "github.com/pearl-research-labs/pearl/node/wire"
)
type Case struct {
 Name,Network,RawTx,Txid,Wtxid,Expected string
 Vsize int64
 Coinbase bool
 OriginHeight,TipHeight int32
 RelayRate int64
 Bundle struct { Inputs []struct { Txid,Amount,ScriptPubKey string; Vout uint32 } }
}
func must(e error) {if e!=nil {panic(e)}}
func unhex(s string) []byte {b,e:=hex.DecodeString(s);must(e);return b}
func label(e error) string { if e==nil{return "accept"};s:=e.Error();if strings.Contains(s,"fees which is under"){return "fee"};if strings.Contains(s,"before required maturity"){return "immature"};if strings.Contains(s,"dust"){return "dust"};return "other" }
func params(name string) *chaincfg.Params {
 switch name {case "mainnet":return &chaincfg.MainNetParams;case "testnet":return &chaincfg.TestNetParams;case "testnet2":return &chaincfg.TestNet2Params;case "simnet":return &chaincfg.SimNetParams;default:return &chaincfg.RegressionNetParams}
}
func main(){
 raw,e:=os.ReadFile(os.Args[1]);must(e);var cases []Case;must(json.Unmarshal(raw,&cases));results:=[]map[string]interface{}{}
 for _,c:=range cases {
  msg:=wire.NewMsgTx(1);must(msg.Deserialize(bytes.NewReader(unhex(c.RawTx))));tx:=btcutil.NewTx(msg)
  if tx.Hash().String()!=c.Txid || msg.WitnessHash().String()!=c.Wtxid || blockchain.GetTransactionVsize(tx)!=c.Vsize {panic("serialization mismatch: "+c.Name)}
  view:=blockchain.NewUtxoViewpoint()
  fetcher:=txscript.NewMultiPrevOutFetcher(nil)
  for _,in:=range c.Bundle.Inputs {h,e:=chainhash.NewHashFromStr(in.Txid);must(e);v,e:=strconv.ParseInt(in.Amount,10,64);must(e);out:=wire.NewTxOut(v,unhex(in.ScriptPubKey));point:=wire.OutPoint{Hash:*h,Index:in.Vout};view.Entries()[point]=blockchain.NewUtxoEntry(out,c.OriginHeight,c.Coinbase);fetcher.AddPrevOut(point,out)}
  sanity:=blockchain.CheckTransactionSanity(tx)
  inputCheckFee,inputs:=blockchain.CheckTransactionInputs(tx,c.TipHeight+1,view,params(c.Network))
  var fee int64;for _,entry:=range view.Entries(){fee+=entry.Amount()};for _,out:=range msg.TxOut{fee-=out.Value}
  hashes:=txscript.NewTxSigHashes(msg,fetcher)
  for i,in:=range msg.TxIn {prev:=fetcher.FetchPrevOutput(in.PreviousOutPoint);eng,e:=txscript.NewEngine(prev.PkScript,msg,i,txscript.StandardVerifyFlags,nil,hashes,prev.Value,fetcher);must(e);must(eng.Execute())}
  pool:=mempool.New(&mempool.Config{Policy:mempool.Policy{MaxTxVersion:1,MinRelayTxFee:btcutil.Amount(c.RelayRate),DisableRelayPriority:true,FreeTxRelayLimit:15,MaxOrphanTxs:5,MaxOrphanTxSize:1000,MaxMempoolSize:mempool.DefaultMaxMempoolSize},ChainParams:params(c.Network),FetchUtxoView:func(*btcutil.Tx)(*blockchain.UtxoViewpoint,error){copy:=blockchain.NewUtxoViewpoint();for k,v:=range view.Entries(){copy.Entries()[k]=v.Clone()};return copy,nil},BestHeight:func()int32{return c.TipHeight},MedianTimePast:func()time.Time{return time.Unix(1_700_000_000,0)},CalcSequenceLock:func(*btcutil.Tx,*blockchain.UtxoViewpoint)(*blockchain.SequenceLock,error){return &blockchain.SequenceLock{Seconds:-1,BlockHeight:-1},nil},HashCache:txscript.NewHashCache(1000)})
  accepted,err:=pool.CheckMempoolAcceptance(tx)
  actual:=label(err);if actual!=c.Expected{panic(fmt.Sprintf("%s expected %s got %s: %v",c.Name,c.Expected,actual,err))};if actual=="accept" && (accepted==nil || len(accepted.MissingParents)>0){panic("not actual acceptance")}
  rejection:="";if err!=nil{rejection=err.Error()};inputError:="";if inputs!=nil{inputError=inputs.Error()}
  result:=map[string]interface{}{"name":c.Name,"network":c.Network,"vsize":c.Vsize,"fee":fee,"inputCheckFee":inputCheckFee,"relayRate":c.RelayRate,"expected":c.Expected,"actual":actual,"rejection":rejection,"sanityPass":sanity==nil,"inputsPass":inputs==nil,"inputsError":inputError,"scriptPass":true,"dustThreshold":mempool.GetDustThreshold(msg.TxOut[0])}
  results=append(results,result);fmt.Printf("%-48s vsize=%4d fee=%4d relay=%4d outcome=%s\n",c.Name,c.Vsize,fee,c.RelayRate,actual)
 }
 networks:=map[string]interface{}{};for _,name:=range []string{"mainnet","testnet","testnet2","regtest","simnet"}{p:=params(name);networks[name]=map[string]interface{}{"genesisHash":p.GenesisHash.String(),"hrp":p.Bech32HRPSegwit,"coinType":p.HDCoinType,"coinbaseMaturity":p.CoinbaseMaturity}}
 out,e:=json.MarshalIndent(map[string]interface{}{"networks":networks,"upstreamCommit":os.Args[3],"cases":results},"","  ");must(e);must(os.WriteFile(os.Args[2],append(out,'\n'),0644))
}
