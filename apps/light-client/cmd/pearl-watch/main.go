// pearl-watch creates or verifies a public-only database for the official Oyster binary.
// It has no chain connection, seed input, software signing or broadcast operation.
package main

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pearl-research-labs/pearl/node/btcec"
	"github.com/pearl-research-labs/pearl/node/btcutil/hdkeychain"
	"github.com/pearl-research-labs/pearl/node/chaincfg"
	"github.com/pearl-research-labs/pearl/wallet/waddrmgr"
	"github.com/pearl-research-labs/pearl/wallet/wallet"
	"github.com/pearl-research-labs/pearl/wallet/walletdb"
	_ "github.com/pearl-research-labs/pearl/wallet/walletdb/bdb"
)

const sourceCommit = "2f8b770cac8f8b74be05c1fc51c2baeb76ce0701"
const markerName = ".pearl-watch.json"
const gap = 20

var namespace = []byte("waddrmgr")
var scope = waddrmgr.KeyScope{Purpose: 86, Coin: 808276}
var schema = waddrmgr.ScopeAddrSchema{ExternalAddrType: waddrmgr.TaprootPubKey, InternalAddrType: waddrmgr.TaprootPubKey}

type publicAccount struct {
	Network           string `json:"network"`
	Account           uint32 `json:"account"`
	MasterFingerprint string `json:"masterFingerprint"`
	PublicKey         string `json:"publicKey"`
	ChainCode         string `json:"chainCode"`
}
type request struct {
	DataDir      string        `json:"dataDir"`
	Account      publicAccount `json:"account"`
	MinimumIndex [2]int        `json:"minimumIndex"`
}
type marker struct {
	Schema       int           `json:"schema"`
	SourceCommit string        `json:"sourceCommit"`
	Account      publicAccount `json:"account"`
}
type coverage struct {
	ExternalScannedThrough uint32 `json:"externalScannedThrough"`
	ChangeScannedThrough   uint32 `json:"changeScannedThrough"`
	GapLimit               int    `json:"gapLimit"`
}
type response struct {
	Schema       int      `json:"schema"`
	SourceCommit string   `json:"sourceCommit"`
	WatchOnly    bool     `json:"watchOnly"`
	Network      string   `json:"network"`
	Account      uint32   `json:"account"`
	DataDir      string   `json:"dataDir"`
	DBPath       string   `json:"dbPath"`
	Coverage     coverage `json:"coverage"`
}

func main() {
	if len(os.Args) == 4 && os.Args[1] == "serve" && os.Args[2] == "--dir" {
		if err := serve(os.Args[3]); err != nil {
			fail(err)
		}
		return
	}
	if len(os.Args) != 2 || (os.Args[1] != "init" && os.Args[1] != "verify") {
		fail(errors.New("usage: pearl-watch init|verify; request JSON on stdin"))
	}
	data, err := io.ReadAll(io.LimitReader(os.Stdin, 8193))
	if err != nil {
		fail(err)
	}
	req, err := parseRequest(data)
	if err != nil {
		fail(err)
	}
	result, err := run(os.Args[1], req)
	if err != nil {
		fail(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fail(err)
	}
}

func fail(err error) { fmt.Fprintln(os.Stderr, "pearl-watch:", err); os.Exit(1) }

// JSON's default duplicate-key behavior is inappropriate for a custody boundary.
func uniqueJSON(dec *json.Decoder) error {
	token, err := dec.Token()
	if err != nil {
		return err
	}
	delim, composite := token.(json.Delim)
	if !composite {
		return nil
	}
	switch delim {
	case '{':
		seen := make(map[string]bool)
		for dec.More() {
			key, err := dec.Token()
			if err != nil {
				return err
			}
			name, ok := key.(string)
			if !ok || seen[name] {
				return errors.New("duplicate or invalid JSON key")
			}
			seen[name] = true
			if err := uniqueJSON(dec); err != nil {
				return err
			}
		}
	case '[':
		for dec.More() {
			if err := uniqueJSON(dec); err != nil {
				return err
			}
		}
	default:
		return errors.New("invalid JSON structure")
	}
	_, err = dec.Token()
	return err
}

func exactKeys(data []byte, keys ...string) error {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return err
	}
	if object == nil {
		return errors.New("expected JSON object")
	}
	if len(object) != len(keys) {
		return errors.New("unexpected or missing JSON fields")
	}
	for _, key := range keys {
		if _, ok := object[key]; !ok {
			return errors.New("missing JSON field")
		}
	}
	return nil
}

// Range expansion happens only with every chain worker stopped and the database
// exclusively reopened. The same transaction rewinds historical scan progress.
func extendProfile(req request) (response, error) {
	base := req
	base.MinimumIndex = [2]int{-1, -1}
	if _, err := run("verify", base); err != nil {
		return response{}, err
	}
	loader := wallet.NewLoader(&chaincfg.MainNetParams, filepath.Join(req.DataDir, "mainnet"), true, time.Second, gap)
	watch, err := loader.OpenExistingWallet([]byte(wallet.InsecurePubPassphrase), false)
	if err != nil {
		return response{}, err
	}
	manager, err := watch.Manager.FetchScopedKeyManager(scope)
	if err == nil {
		err = walletdb.Update(watch.Database(), func(tx walletdb.ReadWriteTx) error {
			ns := tx.ReadWriteBucket(namespace)
			props, err := manager.AccountProperties(ns, 0)
			if err != nil {
				return err
			}
			for branch, n := range req.MinimumIndex {
				if n < -1 || n > 979 {
					return errors.New("registration index outside -1 through 979")
				}
				target := uint32(n + gap + 1)
				have := props.ExternalKeyCount
				if branch == 1 {
					have = props.InternalKeyCount
				}
				if target <= have {
					continue
				}
				if branch == 0 {
					_, err = manager.NextExternalAddresses(ns, 0, target-have, false)
				} else {
					_, err = manager.NextInternalAddresses(ns, 0, target-have, false)
				}
				if err != nil {
					return err
				}
			}
			if err := watch.TxStore.Rollback(tx.ReadWriteBucket([]byte("wtxmgr")), 0); err != nil {
				return err
			}
			genesis := waddrmgr.BlockStamp{Height: 0, Hash: *chaincfg.MainNetParams.GenesisHash, Timestamp: chaincfg.MainNetParams.GenesisBlock.BlockHeader().Timestamp}
			return watch.Manager.Rollback(ns, &genesis)
		})
	}
	closeErr := loader.UnloadWallet()
	if err != nil {
		return response{}, err
	}
	if closeErr != nil {
		return response{}, closeErr
	}
	return run("verify", req)
}

func parseRequest(data []byte) (request, error) {
	var req request
	if len(data) == 0 || len(data) > 8192 {
		return req, errors.New("request exceeds 8 KiB")
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := uniqueJSON(dec); err != nil {
		return req, err
	}
	if _, err := dec.Token(); err != io.EOF {
		return req, errors.New("trailing JSON data")
	}
	if err := exactKeys(data, "dataDir", "account", "minimumIndex"); err != nil {
		return req, err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return req, err
	}
	if err := exactKeys(raw["account"], "network", "account", "masterFingerprint", "publicKey", "chainCode"); err != nil {
		return req, err
	}
	var bounds []int
	if err := json.Unmarshal(raw["minimumIndex"], &bounds); err != nil || len(bounds) != 2 {
		return req, errors.New("minimumIndex must contain two integer bounds")
	}
	if bytes.Contains(raw["minimumIndex"], []byte("null")) {
		return req, errors.New("null recovery bounds are not allowed")
	}
	if bytes.Contains(raw["account"], []byte("null")) {
		return req, errors.New("null account fields are not allowed")
	}
	if err := json.Unmarshal(data, &req); err != nil {
		return req, err
	}
	for _, bound := range req.MinimumIndex {
		if bound < -1 || bound > 979 {
			return req, errors.New("recovery bound must be -1 through 979")
		}
	}
	if req.DataDir == "" || !filepath.IsAbs(req.DataDir) || filepath.Clean(req.DataDir) != req.DataDir {
		return req, errors.New("dataDir must be a clean absolute path")
	}
	if _, err := accountKey(req.Account); err != nil {
		return req, err
	}
	return req, nil
}

func canonicalHex(s string, size int) ([]byte, error) {
	if len(s) != size*2 || strings.ToLower(s) != s {
		return nil, errors.New("public metadata must be canonical lowercase hex")
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil, errors.New("invalid public metadata hex")
	}
	return b, nil
}

func accountKey(account publicAccount) (*hdkeychain.ExtendedKey, error) {
	if account.Network != "mainnet" || account.Account != 0 {
		return nil, errors.New("only mainnet account 0 is supported")
	}
	pub, err := canonicalHex(account.PublicKey, 33)
	if err != nil {
		return nil, err
	}
	if pub[0] != 2 && pub[0] != 3 {
		return nil, errors.New("expected compressed public key")
	}
	parsed, err := btcec.ParsePubKey(pub)
	if err != nil || !bytes.Equal(parsed.SerializeCompressed(), pub) {
		return nil, errors.New("invalid secp256k1 public key")
	}
	chainCode, err := canonicalHex(account.ChainCode, 32)
	if err != nil {
		return nil, err
	}
	if _, err := canonicalHex(account.MasterFingerprint, 4); err != nil {
		return nil, err
	}
	// Parent fingerprint is absent from the canonical public-account record.
	// Zero denotes unspecified metadata; do not substitute the master fingerprint.
	key := hdkeychain.NewExtendedKey(chaincfg.MainNetParams.HDPublicKeyID[:], pub, chainCode, make([]byte, 4), 3, hdkeychain.HardenedKeyStart, false)
	if key.IsPrivate() || key.Depth() != 3 || key.ChildIndex() != hdkeychain.HardenedKeyStart {
		return nil, errors.New("invalid public account depth or child")
	}
	return key, nil
}

func securePath(path string, directory bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || info.IsDir() != directory || (!directory && !info.Mode().IsRegular()) {
		return errors.New("unsafe wallet file type")
	}
	want := os.FileMode(0600)
	if directory {
		want = 0700
	}
	if info.Mode().Perm() != want {
		return errors.New("wallet path permissions must be private")
	}
	return nil
}

func noSymlinkParents(path string) error {
	for current := path; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("data directory parents must be real directories")
		}
		if current == filepath.Dir(current) {
			break
		}
	}
	return nil
}

func writeMarker(path string, value marker) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := json.NewEncoder(f).Encode(value); err != nil {
		return err
	}
	return f.Sync()
}

func run(command string, req request) (result response, err error) {
	key, err := accountKey(req.Account)
	if err != nil {
		return result, err
	}
	if err := noSymlinkParents(filepath.Dir(req.DataDir)); err != nil {
		return result, err
	}
	networkDir := filepath.Join(req.DataDir, "mainnet")
	dbPath := filepath.Join(networkDir, wallet.WalletDBName)
	markerPath := filepath.Join(req.DataDir, markerName)
	if command == "init" {
		// Exclusive creation ensures this never initializes an existing wallet directory.
		if err := os.Mkdir(req.DataDir, 0700); err != nil {
			return result, err
		}
		if err := os.Mkdir(networkDir, 0700); err != nil {
			return result, err
		}
	} else {
		for _, p := range []string{req.DataDir, networkDir} {
			if err := securePath(p, true); err != nil {
				return result, err
			}
		}
		for _, p := range []string{markerPath, dbPath} {
			if err := securePath(p, false); err != nil {
				return result, err
			}
		}
		data, err := os.ReadFile(markerPath)
		if err != nil {
			return result, err
		}
		var saved marker
		if len(data) > 4096 || json.Unmarshal(data, &saved) != nil || saved != (marker{1, sourceCommit, req.Account}) {
			return result, errors.New("profile marker does not match the requested public account")
		}
	}
	waddrmgr.InitKeyScopes(chaincfg.MainNetParams.HDCoinType)
	loader := wallet.NewLoader(&chaincfg.MainNetParams, networkDir, true, time.Second, gap)
	var watch *wallet.Wallet
	if command == "init" {
		watch, err = loader.CreateNewWatchingOnlyWallet([]byte(wallet.InsecurePubPassphrase), chaincfg.MainNetParams.GenesisBlock.MsgHeader.BlockHeader.Timestamp)
	} else {
		watch, err = loader.OpenExistingWallet([]byte(wallet.InsecurePubPassphrase), false)
	}
	if err != nil {
		return result, err
	}
	defer func() {
		if closeErr := loader.UnloadWallet(); err == nil {
			err = closeErr
		}
	}()
	if !watch.Manager.WatchOnly() {
		return result, errors.New("database is not watch-only")
	}
	if command == "init" {
		fingerprint, _ := hex.DecodeString(req.Account.MasterFingerprint)
		props, err := watch.ImportAccountWithScope("ledger", key, binary.BigEndian.Uint32(fingerprint), scope, schema)
		if err != nil {
			return result, err
		}
		if props.AccountNumber != 0 {
			return result, errors.New("unexpected internal account number")
		}
		manager, err := watch.Manager.FetchScopedKeyManager(scope)
		if err != nil {
			return result, err
		}
		err = walletdb.Update(watch.Database(), func(tx walletdb.ReadWriteTx) error {
			ns := tx.ReadWriteBucket(namespace)
			for branch, minimum := range req.MinimumIndex {
				count := uint32(minimum + gap + 1)
				if branch == 0 {
					_, err = manager.NextExternalAddresses(ns, 0, count, false)
				} else {
					_, err = manager.NextInternalAddresses(ns, 0, count, false)
				}
				if err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return result, err
		}
	}
	manager, err := watch.Manager.FetchScopedKeyManager(scope)
	if err != nil {
		return result, err
	}
	if len(watch.Manager.ActiveScopedKeyManagers()) != 1 {
		return result, errors.New("unexpected additional wallet scope")
	}
	var props *waddrmgr.AccountProperties
	err = walletdb.View(watch.Database(), func(tx walletdb.ReadTx) error {
		var err error
		props, err = manager.AccountProperties(tx.ReadBucket(namespace), 0)
		if err != nil {
			return err
		}
		if !props.IsWatchOnly || props.AccountPubKey == nil || props.AccountPubKey.IsPrivate() || props.AccountPubKey.String() != key.String() || props.KeyScope != scope || props.AddrSchema == nil || *props.AddrSchema != schema {
			return errors.New("stored public account or address policy mismatch")
		}
		fingerprint, _ := hex.DecodeString(req.Account.MasterFingerprint)
		if props.MasterKeyFingerprint != binary.BigEndian.Uint32(fingerprint) {
			return errors.New("stored fingerprint mismatch")
		}
		for branch, count := range []uint32{props.ExternalKeyCount, props.InternalKeyCount} {
			if count < uint32(req.MinimumIndex[branch]+gap+1) || count > 1000 {
				return errors.New("stored recovery range is insufficient or outside supported bounds")
			}
		}
		return manager.ForEachAccount(tx.ReadBucket(namespace), func(account uint32) error {
			if account != 0 && account != waddrmgr.ImportedAddrAccount {
				return errors.New("unexpected additional wallet account")
			}
			if account == waddrmgr.ImportedAddrAccount {
				imported, err := manager.AccountProperties(tx.ReadBucket(namespace), account)
				if err != nil {
					return err
				}
				if imported.ImportedKeyCount != 0 {
					return errors.New("unexpected loose imported keys")
				}
			}
			return nil
		})
	})
	if err != nil {
		return result, err
	}
	if err := securePath(dbPath, false); err != nil {
		return result, err
	}
	if command == "init" {
		if err := writeMarker(markerPath, marker{1, sourceCommit, req.Account}); err != nil {
			return result, err
		}
	}
	return response{1, sourceCommit, true, "mainnet", 0, req.DataDir, dbPath, coverage{props.ExternalKeyCount - 1, props.InternalKeyCount - 1, gap}}, nil
}
