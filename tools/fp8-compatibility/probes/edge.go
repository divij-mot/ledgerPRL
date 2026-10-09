// Network-free differential probe. Public fixture signatures only; no signing or custody data.
package main
import (
 "bytes"
 "encoding/hex"
 "encoding/json"
 "fmt"
 "os"
 "reflect"
 "strconv"
 "strings"
 "github.com/pearl-research-labs/pearl/node/blockchain"
 "github.com/pearl-research-labs/pearl/node/btcec/schnorr"
 "github.com/pearl-research-labs/pearl/node/btcutil"
 "github.com/pearl-research-labs/pearl/node/btcutil/hdkeychain"
 "github.com/pearl-research-labs/pearl/node/chaincfg"
 "github.com/pearl-research-labs/pearl/node/chaincfg/chainhash"
 "github.com/pearl-research-labs/pearl/node/mempool"
 "github.com/pearl-research-labs/pearl/node/txscript"
 "github.com/pearl-research-labs/pearl/node/wire"
)
func must(e error){if e!=nil{panic(e)}}
func check(ok bool,label string){if !ok{panic(label)}}
func unhex(s string)[]byte{b,e:=hex.DecodeString(s);must(e);return b}
func params(s string)*chaincfg.Params{switch s{case "mainnet":return &chaincfg.MainNetParams;case "testnet":return &chaincfg.TestNetParams;case "testnet2":return &chaincfg.TestNet2Params;case "regtest":return &chaincfg.RegressionNetParams;case "simnet":return &chaincfg.SimNetParams};panic(s)}
func script(tx *wire.MsgTx,i int,f *txscript.MultiPrevOutFetcher)error{p:=f.FetchPrevOutput(tx.TxIn[i].PreviousOutPoint);h:=txscript.NewTxSigHashes(tx,f);eng,e:=txscript.NewEngine(p.PkScript,tx,i,txscript.StandardVerifyFlags,nil,h,p.Value,f);if e!=nil{return e};return eng.Execute()}
type AddressData struct{
 GrainPerPearl,MaxGrain string
 Networks map[string]struct{Hrp,GenesisHash string;CoinType uint32}
 Vectors []struct{Network,Address,ScriptPubKey string;Branch,Index uint32;Account struct{PublicKey,ChainCode string}}
}
type Case struct{Name,RawTx,Network string;Bundle struct{Inputs []struct{Txid,Amount,ScriptPubKey string;Vout uint32}}}
func main(){
 raw,e:=os.ReadFile(os.Args[1]);must(e);var a AddressData;must(json.Unmarshal(raw,&a))
 check(strconv.FormatInt(btcutil.GrainPerPearl,10)==a.GrainPerPearl,"grain scale mismatch")
 check(strconv.FormatInt(btcutil.MaxGrain,10)==a.MaxGrain,"max grain mismatch")
 check(mempool.DefaultMinRelayTxFee==1000,"default relay policy changed")
 ns:=map[string]interface{}{}
 for name,n:=range a.Networks{p:=params(name);check(n.Hrp==p.Bech32HRPSegwit&&n.GenesisHash==p.GenesisHash.String()&&n.CoinType==p.HDCoinType,"network constants "+name);check(p.CoinbaseMaturity==100,"maturity "+name)
  field:=reflect.ValueOf(*p).FieldByName("Fp8ForkHeight");var activation interface{}=nil;if field.IsValid(){activation=field.Int()}
  ns[name]=map[string]interface{}{"hrp":p.Bech32HRPSegwit,"coinType":p.HDCoinType,"genesisHash":p.GenesisHash.String(),"coinbaseMaturity":p.CoinbaseMaturity,"fp8ForkHeight":activation,"requiredCertVersionAt0":p.RequiredCertVersion(0),"requiredCertVersionAt1":p.RequiredCertVersion(1),"requiredCertVersionAt200":p.RequiredCertVersion(200)}
 }
 for _,v:=range a.Vectors{p:=params(v.Network);key:=hdkeychain.NewExtendedKey(p.HDPublicKeyID[:],unhex(v.Account.PublicKey),unhex(v.Account.ChainCode),[]byte{0,0,0,0},3,hdkeychain.HardenedKeyStart,false);branch,e:=key.Derive(v.Branch);must(e);child,e:=branch.Derive(v.Index);must(e);pub,e:=child.ECPubKey();must(e);output:=schnorr.SerializePubKey(txscript.ComputeTaprootKeyNoScript(pub));addr,e:=btcutil.NewAddressTaproot(output,p);must(e);check(addr.EncodeAddress()==v.Address,"address mismatch");check("5120"+hex.EncodeToString(output)==v.ScriptPubKey,"script mismatch");for _,s:=range []string{v.Address,strings.ToUpper(v.Address)}{decoded,e:=btcutil.DecodeAddress(s,p);must(e);check(decoded.IsForNet(p),"address net");pk,e:=txscript.PayToAddrScript(decoded);must(e);check(hex.EncodeToString(pk)==v.ScriptPubKey,"decoded script")}}
 raw,e=os.ReadFile(os.Args[2]);must(e);var cs []Case;must(json.Unmarshal(raw,&cs));negative:=map[string]int{};positive:=0;roundtrip:=0
 for _,c:=range cs{tx:=wire.NewMsgTx(1);reader:=bytes.NewReader(unhex(c.RawTx));must(tx.Deserialize(reader));check(reader.Len()==0,"trailing bytes");var b bytes.Buffer;must(tx.Serialize(&b));check(hex.EncodeToString(b.Bytes())==c.RawTx,"roundtrip");roundtrip++
  truncated:=wire.NewMsgTx(1);check(truncated.Deserialize(bytes.NewReader(b.Bytes()[:b.Len()-1]))!=nil,"truncated encoding accepted");negative["truncated transaction"]++
  f:=txscript.NewMultiPrevOutFetcher(nil);view:=blockchain.NewUtxoViewpoint();for _,in:=range c.Bundle.Inputs{h,e:=chainhash.NewHashFromStr(in.Txid);must(e);value,e:=strconv.ParseInt(in.Amount,10,64);must(e);point:=wire.OutPoint{Hash:*h,Index:in.Vout};out:=wire.NewTxOut(value,unhex(in.ScriptPubKey));f.AddPrevOut(point,out);view.Entries()[point]=blockchain.NewUtxoEntry(out,1,false)}
  for i,in:=range tx.TxIn{must(script(tx,i,f));positive++
   bad:=tx.Copy();bad.TxIn[i].Witness[0][0]^=1;check(script(bad,i,f)!=nil,"corrupt signature accepted");negative["corrupt signature"]++
   bad=tx.Copy();bad.TxIn[i].Witness=nil;check(script(bad,i,f)!=nil,"missing witness accepted");negative["missing witness"]++
   bad=tx.Copy();bad.TxOut[0].Value++;check(script(bad,i,f)!=nil,"changed output accepted");negative["changed output"]++
   bad=tx.Copy();bad.TxIn[i].Sequence^=1;check(script(bad,i,f)!=nil,"changed sequence accepted");negative["changed sequence"]++
   prev:=f.FetchPrevOutput(in.PreviousOutPoint);old:=prev.Value;prev.Value++;check(script(tx,i,f)!=nil,"changed amount accepted");prev.Value=old;negative["changed prevout amount"]++
  }
  for _,v:=range []int64{-1,btcutil.MaxGrain+1}{bad:=tx.Copy();bad.TxOut[0].Value=v;check(blockchain.CheckTransactionSanity(btcutil.NewTx(bad))!=nil,"bad output value accepted");negative["out-of-range output"]++}
  bad:=tx.Copy();bad.TxOut=[]*wire.TxOut{wire.NewTxOut(btcutil.MaxGrain,tx.TxOut[0].PkScript),wire.NewTxOut(1,tx.TxOut[0].PkScript)};check(blockchain.CheckTransactionSanity(btcutil.NewTx(bad))!=nil,"aggregate output overflow accepted");negative["aggregate output limit"]++
  first:=tx.TxIn[0].PreviousOutPoint;view.Entries()[first]=blockchain.NewUtxoEntry(wire.NewTxOut(btcutil.MaxGrain+1,f.FetchPrevOutput(first).PkScript),1,false);_,e=blockchain.CheckTransactionInputs(btcutil.NewTx(tx),201,view,params(c.Network));check(e!=nil,"oversize input accepted");negative["out-of-range input"]++
 }
 result:=map[string]interface{}{"upstreamCommit":os.Args[4],"networks":ns,"addressVectors":len(a.Vectors),"addressDecodings":2*len(a.Vectors),"transactionRoundtrips":roundtrip,"validScriptExecutions":positive,"expectedRejections":negative,"grainPerPearl":btcutil.GrainPerPearl,"maxGrain":btcutil.MaxGrain,"defaultMinRelayTxFee":mempool.DefaultMinRelayTxFee}
 out,e:=json.MarshalIndent(result,"","  ");must(e);must(os.WriteFile(os.Args[3],append(out,'\n'),0644));fmt.Println(string(out))
}
