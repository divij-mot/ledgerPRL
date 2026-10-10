//go:build !zkpow || !xmss

package main

import "errors"

func serve(string) error {
	return errors.New("SPV requires the pinned native build with xmss,zkpow; verification stubs cannot synchronize")
}
