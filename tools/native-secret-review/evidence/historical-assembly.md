# Historical machine-code observations (not final-artifact qualification)

## Original Nano X simnet artifact

ELF SHA256: 4771a8b5349042bfac313e33e5b66229c2e76e327469e8af01c86dede68356a0
Source crypto SHA256: e29384e20151aca794771c2026aa93ac710ad796ac6c44f0f1ca4ae3a378f563

The original signing call at 0xc0de38c4 entered cx_rng_no_throw, selector 0x6a, through the OS-shared CX trampoline. The pinned SDK implementation loops if cx_get_random_bytes returns an error; the loop is not itself in the app ELF. Exact physical OS shared code was not inspected.

Scalar-zero implementation:

```text
c0de7728 <pearl_scalar_is_zero>:
c0de7728:	2100      	movs	r1, #0
c0de772a:	2200      	movs	r2, #0
c0de772c:	2a20      	cmp	r2, #32
c0de772e:	d003      	beq.n	c0de7738 <pearl_scalar_is_zero+0x10>
c0de7730:	5c83      	ldrb	r3, [r0, r2]
c0de7732:	3201      	adds	r2, #1
c0de7734:	4319      	orrs	r1, r3
c0de7736:	e7f9      	b.n	c0de772c <pearl_scalar_is_zero+0x4>
c0de7738:	fab1 f081 	clz	r0, r1
c0de773c:	0940      	lsrs	r0, r0, #5
c0de773e:	4770      	bx	lr
```

The SDK C entrypoint's EXCEPTION_IO_RESET branch is:

```text
c0de7692: cmp r0, #5
c0de7694: beq.n c0de76c4
...
c0de76c4: ldr r0, [sp, #40]
c0de76c6: strh.w r5, [sp, #44]
c0de76ca: bl c0de7c8c <try_context_set>
c0de76ce: b.n c0de7686 <c_main+0x3a>
```

This returns to setjmp/boot/sample_main inside the same C loop. The initial BSS clear is outside it. No explicit app-RAM/stack wipe exists on that edge; OS cleanup behavior remains unverified.

## Intermediate checked-RNG Nano S Plus simnet artifact

ELF SHA256: 0d4f8030a4566260713193aa6d13fa0d4d520a81ef0694cec9ae4af38626aa7c
Source crypto SHA256: f2cfc84d6661f7ef4f2b011476352a9dc5bb64875b02bc5302f93fb54860b135

```text
c0de34e6: bl c0de7864 <cx_get_random_bytes>
c0de34ea: cmp r0, #0
c0de34ec: bne.w c0de3662 <sample_main+0x2666>
... private-key initialization follows only on success ...
c0de3504: bl c0de0c68 <...crypto11tweaked_key>
```

The final expected source adds shorter private-key lifetimes. These intermediate addresses, hashes and observations must not be represented as final-artifact disassembly.

## Rejected explicit-by-value-drop intermediate

Crypto SHA256: `7245b73f22769869bcd9440469a45adfce2b9878b9f5567bbad759742b38d1d9`. This intermediate did not qualify.

```text
Defective intermediate 7245b73f source; Nano S Plus mainnet ELF a6342ae7be6a3bfb30363b587bd5240859bf0aaf7616d2daf68300d64b5014dd
c0de355e:	a906      	add	r1, sp, #24
c0de3560:	f1a7 0480 	sub.w	r4, r7, #128	@ 0x80
c0de3564:	f501 5126 	add.w	r1, r1, #10624	@ 0x2980
c0de3568:	2228      	movs	r2, #40	@ 0x28
c0de356a:	f003 fd84 	bl	c0de7076 <OUTLINED_FUNCTION_18>
c0de356e:	4620      	mov	r0, r4
c0de3570:	f7fc fe70 	bl	c0de0254 <_RINvNtCs77Jtq17PsCU_4core3ptr13drop_in_placeNtNtCsg5rqWeTekgV_12pearl_ledger6crypto10PrivateKeyEBK_>

OUTLINED_FUNCTION_18 moves r4 to r0 then tail-calls __aeabi_memcpy. The source pointer is sp+24+10624; the destination/drop pointer is r7-128. Only the moved destination is wiped on this success path.
```

The sample_main prologue gives r7=SP+11288. Thus the initialized/source object is SP+10648, while Drop receives SP+11160. The old contents-only observer passed this source in debug/release. The final host harness records the initialized scalar address and checks it at the same sole post-wipe observation point; a separate historical-source replay of success_preserves_aux_and_bip340_mode now fails with “private-key Drop must wipe the original initialized slot, not a moved copy” (exit 101, one failed and seven filtered tests). Final-source SHA502037 passes all eight tests in both profiles.
