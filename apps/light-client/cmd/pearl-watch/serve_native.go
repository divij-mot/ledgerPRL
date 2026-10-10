//go:build zkpow && xmss

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/pearl-research-labs/pearl/node/chaincfg"
	"github.com/pearl-research-labs/pearl/node/wire"
	neutrino "github.com/pearl-research-labs/pearl/spv"
	"github.com/pearl-research-labs/pearl/wallet/chain"
	"github.com/pearl-research-labs/pearl/wallet/waddrmgr"
	"github.com/pearl-research-labs/pearl/wallet/wallet"
	"github.com/pearl-research-labs/pearl/wallet/walletdb"
)

type chainTip struct {
	Height int32  `json:"height"`
	Hash   string `json:"hash"`
}
type scanCoverage struct {
	ExternalScannedThrough uint32 `json:"externalScannedThrough"`
	ChangeScannedThrough   uint32 `json:"changeScannedThrough"`
	GapLimit               int    `json:"gapLimit"`
	ScanComplete           bool   `json:"scanComplete"`
}
type runtimeStatus struct {
	RestartRequired   bool          `json:"restartRequired"`
	Schema            int           `json:"schema"`
	SourceCommit      string        `json:"sourceCommit"`
	WatchOnly         bool          `json:"watchOnly"`
	Network           string        `json:"network"`
	Account           uint32        `json:"account"`
	PublicAccount     publicAccount `json:"publicAccount"`
	GenesisHash       string        `json:"genesisHash"`
	Tip               chainTip      `json:"tip"`
	HeaderHeight      int32         `json:"headerHeight"`
	FilterHeight      int32         `json:"filterHeight"`
	BestPeerHeight    int32         `json:"bestPeerHeight"`
	Connections       int           `json:"connections"`
	WalletSynced      bool          `json:"walletSynced"`
	Synced            bool          `json:"synced"`
	Ready             bool          `json:"ready"`
	Coverage          scanCoverage  `json:"coverage"`
	RegisteredThrough [2]uint32     `json:"registeredThrough"`
	LastUsed          [2]int        `json:"lastUsed"`
	NeedsRegistration bool          `json:"needsRegistration"`
}
type transaction struct {
	Txid           string    `json:"txid"`
	RawTransaction string    `json:"rawTransaction"`
	Block          *chainTip `json:"block"`
}
type outpoint struct {
	Txid string `json:"txid"`
	Vout uint32 `json:"vout"`
}
type snapshotResult struct {
	runtimeStatus
	Complete     bool          `json:"complete"`
	Transactions []transaction `json:"transactions"`
	Unspent      []outpoint    `json:"unspent"`
}
type rpcRequest struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}
type rpcError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type rpcResponse struct {
	ID     string    `json:"id"`
	Result any       `json:"result,omitempty"`
	Error  *rpcError `json:"error,omitempty"`
}
type facade struct {
	dir      string
	shutdown func() error
	closed   bool
	watch    *wallet.Wallet
	cs       *neutrino.ChainService
	client   *chain.NeutrinoClient
	account  publicAccount
}

func serve(dir string) error {
	if !filepath.IsAbs(dir) || filepath.Clean(dir) != dir {
		return errors.New("expected clean absolute profile path")
	}
	if err := securePath(filepath.Join(dir, markerName), false); err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(dir, markerName))
	if err != nil {
		return err
	}
	var saved marker
	if len(data) > 4096 || json.Unmarshal(data, &saved) != nil || saved.Schema != 1 || saved.SourceCommit != sourceCommit {
		return errors.New("invalid profile marker")
	}
	if _, err := run("verify", request{dir, saved.Account, [2]int{-1, -1}}); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	netDir := filepath.Join(dir, "mainnet")
	loader := wallet.NewLoader(&chaincfg.MainNetParams, netDir, true, time.Second, gap)
	watch, err := loader.OpenExistingWallet([]byte(wallet.InsecurePubPassphrase), false)
	if err != nil {
		return err
	}
	defer loader.UnloadWallet()
	spvPath := filepath.Join(netDir, "neutrino.db")
	if _, err := os.Lstat(spvPath); err == nil {
		if err := securePath(spvPath, false); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	spvDB, err := walletdb.Create("bdb", spvPath, true, time.Second, false)
	if err != nil {
		return err
	}
	defer spvDB.Close()
	cs, err := neutrino.NewChainService(neutrino.Config{DataDir: netDir, Database: spvDB, ChainParams: chaincfg.MainNetParams, PersistToDisk: true})
	if err != nil {
		return err
	}
	client := chain.NewNeutrinoClient(&chaincfg.MainNetParams, cs)
	if err := client.Start(ctx); err != nil {
		return err
	}
	defer cs.Stop()
	defer client.Stop()
	watch.SynchronizeRPC(client)
	f := &facade{watch: watch, cs: cs, client: client, account: saved.Account, dir: dir}
	f.shutdown = func() error {
		if f.closed {
			return nil
		}
		f.closed = true
		watch.Stop()
		watch.WaitForShutdown()
		client.Stop()
		client.WaitForShutdown()
		return errors.Join(cs.Stop(), loader.UnloadWallet(), spvDB.Close())
	}
	defer f.shutdown()
	// Only the inherited private pipes expose this API. No network RPC listener.
	lines := make(chan []byte)
	readErr := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		scanner.Buffer(make([]byte, 4096), 64*1024)
		for scanner.Scan() {
			line := append([]byte(nil), scanner.Bytes()...)
			select {
			case lines <- line:
			case <-ctx.Done():
				return
			}
		}
		readErr <- scanner.Err()
	}()
	enc := json.NewEncoder(os.Stdout)
	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-readErr:
			return err
		case line := <-lines:
			var req rpcRequest
			dec := json.NewDecoder(bytes.NewReader(line))
			if err := uniqueJSON(dec); err != nil {
				return errors.New("invalid RPC JSON")
			}
			if _, err := dec.Token(); err != io.EOF {
				return errors.New("trailing RPC JSON")
			}
			if err := exactKeys(line, "id", "method", "params"); err != nil {
				return err
			}
			if err := json.Unmarshal(line, &req); err != nil || len(req.ID) == 0 || len(req.ID) > 128 {
				return errors.New("invalid RPC request")
			}
			requestCtx, stop := context.WithTimeout(ctx, 30*time.Second)
			result, err := f.handle(requestCtx, req)
			stop()
			response := rpcResponse{ID: req.ID, Result: result}
			if err != nil {
				code := "UNAVAILABLE"
				if req.Method == "broadcast" {
					code = "BROADCAST_UNKNOWN"
				}
				response.Result = nil
				response.Error = &rpcError{code, err.Error()}
			}
			if err := enc.Encode(response); err != nil {
				return err
			}
			if f.closed {
				return nil
			}
		}
	}
}

func (f *facade) status() (runtimeStatus, error) {
	result := runtimeStatus{Schema: 1, SourceCommit: sourceCommit, WatchOnly: f.watch.Manager.WatchOnly(), Network: "mainnet", Account: 0, PublicAccount: f.account, GenesisHash: chaincfg.MainNetParams.GenesisHash.String(), LastUsed: [2]int{-1, -1}}
	if !result.WatchOnly {
		return result, errors.New("watch-only invariant failed")
	}
	progress, err := f.client.SyncProgress()
	if err != nil {
		return result, err
	}
	result.HeaderHeight = progress.HeaderHeight
	result.FilterHeight = progress.FilterHeaderHeight
	result.BestPeerHeight = progress.BestPeerHeight
	result.Connections = int(progress.Connections)
	tip := f.watch.SyncedTo()
	result.Tip = chainTip{tip.Height, tip.Hash.String()}
	result.WalletSynced = f.watch.ChainSynced()
	canonical, err := f.cs.GetBlockHash(int64(tip.Height))
	if err != nil {
		return result, err
	}
	result.Synced = synchronizedChain(result, f.cs.IsCurrent(), canonical.String())
	manager, err := f.watch.Manager.FetchScopedKeyManager(scope)
	if err != nil {
		return result, err
	}
	err = walletdb.View(f.watch.Database(), func(tx walletdb.ReadTx) error {
		ns := tx.ReadBucket(namespace)
		props, err := manager.AccountProperties(ns, 0)
		if err != nil {
			return err
		}
		if props.ExternalKeyCount < 20 || props.InternalKeyCount < 20 || props.ExternalKeyCount > 1000 || props.InternalKeyCount > 1000 {
			return errors.New("account exceeds supported address range")
		}
		result.RegisteredThrough = [2]uint32{props.ExternalKeyCount - 1, props.InternalKeyCount - 1}
		return manager.ForEachAccountAddress(ns, 0, func(address waddrmgr.ManagedAddress) error {
			if !address.Used(ns) {
				return nil
			}
			pub, ok := address.(waddrmgr.ManagedPubKeyAddress)
			if !ok {
				return errors.New("unsupported owned address policy")
			}
			keyScope, path, known := pub.DerivationInfo()
			if !known || keyScope != scope || path.InternalAccount != 0 || path.Branch > 1 || path.Index > 979 || len(pub.TapscriptRoot()) != 0 {
				return errors.New("owned address is outside supported account policy")
			}
			if int(path.Index) > result.LastUsed[path.Branch] {
				result.LastUsed[path.Branch] = int(path.Index)
			}
			return nil
		})
	})
	if err != nil {
		return result, err
	}
	for branch, used := range result.LastUsed {
		if used+gap > int(result.RegisteredThrough[branch]) {
			result.NeedsRegistration = true
		}
	}
	result.Ready = result.Synced && !result.NeedsRegistration
	result.Coverage = scanCoverage{result.RegisteredThrough[0], result.RegisteredThrough[1], gap, result.Ready}
	return result, nil
}

// IsCurrent follows Neutrino's selected sync peer. A newly connected peer may
// already advertise a higher tip before that peer becomes the sync peer, so
// also require our verified headers to cover every currently reported height.
func synchronizedChain(s runtimeStatus, current bool, canonicalHash string) bool {
	return s.WalletSynced && s.Connections > 0 && current &&
		s.HeaderHeight >= s.BestPeerHeight && s.HeaderHeight == s.Tip.Height &&
		s.FilterHeight == s.Tip.Height && canonicalHash == s.Tip.Hash
}

func (f *facade) ready() (runtimeStatus, error) {
	s, err := f.status()
	if err == nil && !s.Ready {
		err = errors.New("SPV account is still syncing or needs address registration")
	}
	return s, err
}
func sameTip(a, b runtimeStatus) bool {
	return a.Ready && b.Ready && a.Tip == b.Tip && a.RegisteredThrough == b.RegisteredThrough && a.LastUsed == b.LastUsed
}

func (f *facade) handle(ctx context.Context, req rpcRequest) (any, error) {
	if bytes.Contains(req.Params, []byte("null")) {
		return nil, errors.New("null RPC values are not allowed")
	}
	switch req.Method {
	case "status":
		if err := exactKeys(req.Params); err != nil {
			return nil, err
		}
		return f.status()
	case "snapshot":
		if err := exactKeys(req.Params); err != nil {
			return nil, err
		}
		return f.snapshot(ctx)
	case "blockHash":
		if err := exactKeys(req.Params, "height"); err != nil {
			return nil, err
		}
		var p struct {
			Height int64 `json:"height"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, err
		}
		before, err := f.ready()
		if err != nil {
			return nil, err
		}
		if p.Height < 0 || p.Height > int64(before.Tip.Height) {
			return nil, errors.New("height outside synced chain")
		}
		hash, err := f.cs.GetBlockHash(p.Height)
		if err != nil {
			return nil, err
		}
		after, err := f.ready()
		if err != nil || !sameTip(before, after) {
			return nil, errors.New("chain changed during header query")
		}
		return struct {
			Height int64    `json:"height"`
			Hash   string   `json:"hash"`
			Tip    chainTip `json:"tip"`
		}{p.Height, hash.String(), after.Tip}, ctx.Err()
	case "register":
		if err := exactKeys(req.Params, "minimumIndex"); err != nil {
			return nil, err
		}
		var p struct {
			MinimumIndex []int `json:"minimumIndex"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil || len(p.MinimumIndex) != 2 {
			return nil, errors.New("invalid registration bounds")
		}
		return f.register(ctx, p.MinimumIndex)
	case "broadcast":
		return f.broadcast(ctx, req.Params)
	default:
		return nil, errors.New("unsupported light-client method")
	}
}

func (f *facade) snapshot(ctx context.Context) (snapshotResult, error) {
	before, err := f.ready()
	result := snapshotResult{runtimeStatus: before, Transactions: []transaction{}, Unspent: []outpoint{}}
	if err != nil {
		return result, err
	}
	seen := make(map[string]*wire.MsgTx)
	rawSize := 0
	add := func(summary wallet.TransactionSummary, block *chainTip) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if len(seen) >= 2000 {
			return errors.New("history exceeds 2000 transactions")
		}
		rawSize += len(summary.Transaction) * 2
		if rawSize > 3*1024*1024 {
			return errors.New("history exceeds 3 MiB raw hex")
		}
		var tx wire.MsgTx
		reader := bytes.NewReader(summary.Transaction)
		if err := tx.Deserialize(reader); err != nil || reader.Len() != 0 {
			return errors.New("invalid raw wallet transaction")
		}
		id := tx.TxHash().String()
		if summary.Hash == nil || id != summary.Hash.String() {
			return errors.New("raw wallet transaction ID mismatch")
		}
		if _, exists := seen[id]; exists {
			return errors.New("duplicate wallet history transaction")
		}
		seen[id] = &tx
		result.Transactions = append(result.Transactions, transaction{id, hex.EncodeToString(summary.Transaction), block})
		return nil
	}
	for start := int32(0); start <= before.Tip.Height; start += 256 {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		end := start + 255
		if end > before.Tip.Height {
			end = before.Tip.Height
		}
		batch, err := f.watch.GetTransactions(wallet.NewBlockIdentifierFromHeight(start), wallet.NewBlockIdentifierFromHeight(end), "ledger", ctx.Done())
		if err != nil {
			return result, err
		}
		if err := ctx.Err(); err != nil {
			return result, err
		}
		for _, block := range batch.MinedTransactions {
			hash, err := f.cs.GetBlockHash(int64(block.Height))
			if err != nil || block.Hash == nil || hash.String() != block.Hash.String() {
				return result, errors.New("wallet transaction is not on the synced chain")
			}
			ref := &chainTip{block.Height, hash.String()}
			for _, tx := range block.Transactions {
				if err := add(tx, ref); err != nil {
					return result, err
				}
			}
		}
	}
	pending, err := f.watch.GetTransactions(wallet.NewBlockIdentifierFromHeight(-1), wallet.NewBlockIdentifierFromHeight(-1), "ledger", ctx.Done())
	if err != nil {
		return result, err
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	for _, tx := range pending.UnminedTransactions {
		if err := add(tx, nil); err != nil {
			return result, err
		}
	}
	coins, err := f.watch.UnspentOutputs(wallet.OutputSelectionPolicy{Account: 0, RequiredConfirmations: 0})
	if err != nil {
		return result, err
	}
	if len(coins) > 256 {
		return result, errors.New("account exceeds 256 unspent outputs")
	}
	for _, coin := range coins {
		id := coin.OutPoint.Hash.String()
		tx := seen[id]
		if tx == nil || int(coin.OutPoint.Index) >= len(tx.TxOut) {
			return result, errors.New("unspent output is missing from complete raw history")
		}
		output := tx.TxOut[coin.OutPoint.Index]
		if output.Value != coin.Output.Value || !bytes.Equal(output.PkScript, coin.Output.PkScript) {
			return result, errors.New("unspent output disagrees with raw transaction")
		}
		result.Unspent = append(result.Unspent, outpoint{id, coin.OutPoint.Index})
	}
	after, err := f.ready()
	if err != nil || !sameTip(before, after) {
		return result, errors.New("chain or recovery range changed during snapshot")
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	result.Complete = true
	return result, nil
}

func (f *facade) register(ctx context.Context, bounds []int) (runtimeStatus, error) {
	before, err := f.status()
	if err != nil {
		return before, err
	}
	if !before.Synced {
		return before, errors.New("wait for current synchronization before extending history")
	}
	needs := false
	for branch, n := range bounds {
		if n < -1 || n > 979 {
			return before, errors.New("registration index outside -1 through 979")
		}
		if n+gap > int(before.RegisteredThrough[branch]) {
			needs = true
		}
	}
	if !needs {
		return before, nil
	}
	if err := ctx.Err(); err != nil {
		return before, err
	}
	// No new request is accepted after shutdown. A new process starts a fresh
	// Neutrino notification stream and genuinely scans from the durable rewind.
	if err := f.shutdown(); err != nil {
		return before, err
	}
	extended, err := extendProfile(request{f.dir, f.account, [2]int{bounds[0], bounds[1]}})
	if err != nil {
		return before, err
	}
	before.Ready = false
	before.Synced = false
	before.WalletSynced = false
	before.RestartRequired = true
	before.RegisteredThrough = [2]uint32{extended.Coverage.ExternalScannedThrough, extended.Coverage.ChangeScannedThrough}
	before.Coverage = scanCoverage{before.RegisteredThrough[0], before.RegisteredThrough[1], gap, false}
	before.NeedsRegistration = false
	return before, nil
}

func (f *facade) broadcast(ctx context.Context, params json.RawMessage) (any, error) {
	if err := exactKeys(params, "rawTransaction", "expectedTxid"); err != nil {
		return nil, err
	}
	var p struct {
		Raw  string `json:"rawTransaction"`
		Txid string `json:"expectedTxid"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}
	if len(p.Raw) == 0 || len(p.Raw) > 16384 {
		return nil, errors.New("raw transaction exceeds supported size")
	}
	raw, err := canonicalHex(p.Raw, len(p.Raw)/2)
	if err != nil {
		return nil, err
	}
	if _, err := canonicalHex(p.Txid, 32); err != nil {
		return nil, err
	}
	var tx wire.MsgTx
	reader := bytes.NewReader(raw)
	if err := tx.Deserialize(reader); err != nil || reader.Len() != 0 {
		return nil, errors.New("invalid raw transaction")
	}
	var canonical bytes.Buffer
	if err := tx.Serialize(&canonical); err != nil || !bytes.Equal(canonical.Bytes(), raw) {
		return nil, errors.New("noncanonical raw transaction")
	}
	if tx.TxHash().String() != p.Txid || tx.Version != 1 || tx.LockTime != 0 || len(tx.TxIn) < 1 || len(tx.TxIn) > 16 || len(tx.TxOut) < 1 || len(tx.TxOut) > 2 {
		return nil, errors.New("raw transaction does not match supported payment")
	}
	for _, input := range tx.TxIn {
		if input.Sequence != 0xffffffff || len(input.SignatureScript) != 0 || len(input.Witness) != 1 || len(input.Witness[0]) != 64 {
			return nil, errors.New("unsupported input signing policy")
		}
	}
	for _, output := range tx.TxOut {
		if output.Value <= 0 || len(output.PkScript) != 34 || output.PkScript[1] != 32 || (output.PkScript[0] != 0x51 && output.PkScript[0] != 0x52) {
			return nil, errors.New("unsupported destination policy")
		}
	}
	if _, err := f.ready(); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// A response failure remains ambiguous. No retries or journal mutation here.
	if err := f.cs.SendTransaction(&tx); err != nil {
		return nil, fmt.Errorf("submission status unknown; retain this exact payment: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return struct {
		Txid string `json:"txid"`
	}{p.Txid}, nil
}
