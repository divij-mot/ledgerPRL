//go:build zkpow && xmss

package main

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMalformedRPCDoesNotReachNativeState(t *testing.T) {
	f := &facade{}
	for _, tc := range []struct{ method, params string }{
		{"status", "null"}, {"snapshot", "null"}, {"register", `{"minimumIndex":[null,null]}`}, {"blockHash", `{"height":null}`},
		{"status", `{"unexpected":1}`}, {"broadcast", `{"rawTransaction":null,"expectedTxid":null}`},
	} {
		if _, err := f.handle(context.Background(), rpcRequest{ID: "test", Method: tc.method, Params: json.RawMessage(tc.params)}); err == nil {
			t.Fatalf("accepted malformed %s", tc.method)
		}
	}
}

func TestPeerAheadPreventsReadinessUntilVerifiedCatchup(t *testing.T) {
	s := runtimeStatus{
		Tip:          chainTip{Height: 100, Hash: "old-tip"},
		HeaderHeight: 100, FilterHeight: 100, BestPeerHeight: 100,
		Connections: 2, WalletSynced: true,
	}
	if !synchronizedChain(s, true, "old-tip") {
		t.Fatal("initial fully verified tip was not current")
	}
	// Neutrino may still consider the selected peer current when a second
	// connected peer announces a higher block. The old view must be unusable.
	s.BestPeerHeight = 101
	if synchronizedChain(s, true, "old-tip") {
		t.Fatal("peer-ahead view was considered synchronized")
	}
	s.HeaderHeight = 101
	if synchronizedChain(s, true, "old-tip") {
		t.Fatal("headers alone restored readiness before filters and wallet")
	}
	s.FilterHeight = 101
	if synchronizedChain(s, true, "old-tip") {
		t.Fatal("filters restored readiness before wallet")
	}
	s.Tip = chainTip{Height: 101, Hash: "new-tip"}
	if synchronizedChain(s, true, "old-tip") {
		t.Fatal("noncanonical wallet tip restored readiness")
	}
	if !synchronizedChain(s, true, "new-tip") {
		t.Fatal("verified catchup did not restore readiness")
	}
	// Lagging peers are permitted; their advertised height is not a ceiling.
	s.BestPeerHeight = 100
	if !synchronizedChain(s, true, "new-tip") {
		t.Fatal("lagging peers incorrectly disabled the verified current tip")
	}
}
