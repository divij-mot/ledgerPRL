package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pearl-research-labs/pearl/node/chaincfg"
	"github.com/pearl-research-labs/pearl/wallet/waddrmgr"
	"github.com/pearl-research-labs/pearl/wallet/wallet"
	"github.com/pearl-research-labs/pearl/wallet/walletdb"
)

// Public deterministic fixture. Never fund any address derived from it.
func fixtureAccount() publicAccount {
	return publicAccount{"mainnet", 0, "11223344", "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", strings.Repeat("42", 32)}
}
func fixtureRequest(t *testing.T) request {
	t.Helper()
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return request{filepath.Join(parent, "profile"), fixtureAccount(), [2]int{-1, -1}}
}
func TestStrictPublicOnlyRequest(t *testing.T) {
	req := fixtureRequest(t)
	valid, _ := json.Marshal(req)
	if _, err := parseRequest(valid); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{
		strings.Replace(string(valid), `"account":0`, `"account":1`, 1),
		strings.Replace(string(valid), `"network":"mainnet"`, `"network":"regtest"`, 1),
		strings.Replace(string(valid), `"account":0`, `"account":null`, 1),
		strings.Replace(string(valid), `"account":0`, `"account":0,"seed":"forbidden"`, 1),
		strings.Replace(string(valid), `"account":0`, `"account":0,"account":0`, 1),
		strings.Replace(string(valid), `[-1,-1]`, `[980,-1]`, 1),
		strings.Replace(string(valid), `[-1,-1]`, `[-1]`, 1),
		strings.Replace(string(valid), `[-1,-1]`, `[-1.5,-1]`, 1),
		strings.Replace(string(valid), `[-1,-1]`, `[null,-1]`, 1),
		strings.Replace(string(valid), req.Account.PublicKey, "02"+strings.Repeat("ff", 32), 1),
		strings.Replace(string(valid), req.Account.PublicKey, strings.ToUpper(req.Account.PublicKey), 1),
		string(valid) + `{}`,
	} {
		if _, err := parseRequest([]byte(invalid)); err == nil {
			t.Fatalf("accepted malformed public request: %s", invalid)
		}
	}
}
func TestWatchOnlyCreateReopenAndBounds(t *testing.T) {
	req := fixtureRequest(t)
	created, err := run("init", req)
	if err != nil {
		t.Fatal(err)
	}
	if !created.WatchOnly || created.SourceCommit != sourceCommit || created.Coverage.ExternalScannedThrough != 19 || created.Coverage.ChangeScannedThrough != 19 {
		t.Fatalf("unexpected watch metadata: %+v", created)
	}
	verified, err := run("verify", req)
	if err != nil {
		t.Fatal(err)
	}
	if verified != created {
		t.Fatal("reopened profile identity differs")
	}
	if _, err := run("init", req); err == nil {
		t.Fatal("reinitialized existing profile")
	}
	req.MinimumIndex[0] = 0
	if _, err := run("verify", req); err == nil {
		t.Fatal("claimed unregistered historical range")
	}
	req.MinimumIndex[0] = -1
	req.Account.ChainCode = strings.Repeat("43", 32)
	if _, err := run("verify", req); err == nil {
		t.Fatal("accepted another public account")
	}
	if err := os.Chmod(created.DBPath, 0644); err != nil {
		t.Fatal(err)
	}
	req.Account = fixtureAccount()
	if _, err := run("verify", req); err == nil {
		t.Fatal("accepted public database permissions")
	}
}
func TestRestoredRangesAndSymlinkRefusal(t *testing.T) {
	req := fixtureRequest(t)
	req.MinimumIndex = [2]int{5, 7}
	created, err := run("init", req)
	if err != nil {
		t.Fatal(err)
	}
	if created.Coverage.ExternalScannedThrough != 25 || created.Coverage.ChangeScannedThrough != 27 {
		t.Fatal("restore ranges did not retain a complete gap")
	}
	if _, err := run("verify", req); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(filepath.Dir(req.DataDir), "alias")
	if err := os.Symlink(req.DataDir, alias); err != nil {
		t.Fatal(err)
	}
	req.DataDir = alias
	if _, err := run("verify", req); err == nil {
		t.Fatal("accepted profile symlink")
	}
}

func TestStoredAddressesMatchIndependentTypeScriptDerivation(t *testing.T) {
	req := fixtureRequest(t)
	if _, err := run("init", req); err != nil {
		t.Fatal(err)
	}
	loader := wallet.NewLoader(&chaincfg.MainNetParams, filepath.Join(req.DataDir, "mainnet"), true, time.Second, gap)
	watch, err := loader.OpenExistingWallet([]byte(wallet.InsecurePubPassphrase), false)
	if err != nil {
		t.Fatal(err)
	}
	defer loader.UnloadWallet()
	manager, err := watch.Manager.FetchScopedKeyManager(scope)
	if err != nil {
		t.Fatal(err)
	}
	// Generated with packages/sdk/src/keys.ts for the same public-only fixture.
	expected := [2][3]string{
		{"prl1pjzmchtmvqav5fgrxtl3ll6w90eg4z4ne3rsjkdjjfdvkls4vmffsfgpmxc", "prl1pf99fdemamf75xx7tuvys4tg0e49r3sdep68j3hzhuq6g9s7vq6nqqye4cj", "prl1pgf7hgzdgncg8vc7egyect4lftckgez4rfsqf8qatlq0086st57zqgmp9kh"},
		{"prl1pny4nnjyjnutx5yuecj39k3e9q73gu20hq5rmr7csmvtp50dz0grqux250k", "prl1p3zsdjd4rpz69g3t7hpnh5z5305p2tpmglmxqq2qpanhyhlew2rfsgava5u", "prl1pe4gwh9pqtz3r5zy7c6qe4wv9jlxweuugn28ml4uhnrffy86d7cgs5axv7t"},
	}
	err = walletdb.Update(watch.Database(), func(tx walletdb.ReadWriteTx) error {
		for branch := uint32(0); branch < 2; branch++ {
			for n, index := range []uint32{0, 7, 19} {
				address, err := manager.DeriveFromKeyPath(tx.ReadWriteBucket(namespace), waddrmgr.DerivationPath{InternalAccount: 0, Account: 0, Branch: branch, Index: index}, false)
				if err != nil {
					return err
				}
				if address.Address().String() != expected[branch][n] {
					t.Fatalf("branch %d index %d differs", branch, index)
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestOfflineExtensionRetainsRangesAndRewindsBeforeReopen(t *testing.T) {
	req := fixtureRequest(t)
	if _, err := run("init", req); err != nil {
		t.Fatal(err)
	}
	loader := wallet.NewLoader(&chaincfg.MainNetParams, filepath.Join(req.DataDir, "mainnet"), true, time.Second, gap)
	watch, err := loader.OpenExistingWallet([]byte(wallet.InsecurePubPassphrase), false)
	if err != nil {
		t.Fatal(err)
	}
	stamp := watch.SyncedTo()
	stamp.Height = 1
	stamp.Hash[0] ^= 1
	err = walletdb.Update(watch.Database(), func(tx walletdb.ReadWriteTx) error {
		return watch.Manager.SetSyncedTo(tx.ReadWriteBucket(namespace), &stamp)
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := loader.UnloadWallet(); err != nil {
		t.Fatal(err)
	}
	req.MinimumIndex = [2]int{0, 4}
	extended, err := extendProfile(req)
	if err != nil {
		t.Fatal(err)
	}
	if extended.Coverage.ExternalScannedThrough != 20 || extended.Coverage.ChangeScannedThrough != 24 {
		t.Fatal("extended range mismatch")
	}
	watch, err = loader.OpenExistingWallet([]byte(wallet.InsecurePubPassphrase), false)
	if err != nil {
		t.Fatal(err)
	}
	defer loader.UnloadWallet()
	if watch.SyncedTo().Height != 0 || watch.SyncedTo().Hash != *chaincfg.MainNetParams.GenesisHash {
		t.Fatal("expanded range retained an old scan checkpoint")
	}
}
