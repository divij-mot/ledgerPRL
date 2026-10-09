# Final lexical-scope compiled review

Crypto SHA256: `50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`. All five immutable simnet pilots passed manual original-slot review. Addresses below are specific to these ELFs. SP means the unchanged sample_main frame SP, not the callee SP. Ordinary errors include derivation, public generation, tweak and signing returns; RNG errors precede construction. Length and verify errors occur after the key is already wiped.

The signing success path copies a 76-byte public-key object, then passes the original 40-byte private-key object to Drop. There is no moved private-key temporary. The account path likewise wipes its original object before the identifier syscall. Drop zeroizes scalar bytes at key+8 through key+39, then d_len and curve; the loops below show actual zero stores.

## nanosplus
ELF `pearl-nanosplus-simnet.elf`, SHA256 `b4a0e2d8165d37a1a0a5bc31b5ae8ebd646ed5eb850d56b6d2edfd9961044835`.
Original account object: SP+10944; original signing object: SP+10720.
Account success/error Drop: 0xc0de1a20/0xc0de1996; identifier: 0xc0de1a32. Signing call: 0xc0de3512; success/error Drop: 0xc0de3532/0xc0de3632; verify: 0xc0de3562.

```text
c0de1a18:	f880 4440 	strb.w	r4, [r0, #1088]	@ 0x440
c0de1a1c:	f50d 502b 	add.w	r0, sp, #10944	@ 0x2ac0
c0de1a20:	f7fe fc18 	bl	c0de0254 <_RINvNtCs77Jtq17PsCU_4core3ptr13drop_in_placeNtNtCskVXdcy3eKtj_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de198e:	e0f7      	b.n	c0de1b80 <sample_main+0xb88>
c0de1990:	240d      	movs	r4, #13
c0de1992:	f50d 502b 	add.w	r0, sp, #10944	@ 0x2ac0
c0de1996:	f7fe fc5d 	bl	c0de0254 <_RINvNtCs77Jtq17PsCU_4core3ptr13drop_in_placeNtNtCskVXdcy3eKtj_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de350a:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de350e:	f503 5321 	add.w	r3, r3, #10304	@ 0x2840
c0de3512:	f004 f84b 	bl	c0de75ac <cx_ecschnorr_sign_no_throw>
...
c0de352c:	a808      	add	r0, sp, #32
c0de352e:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de3532:	f7fc fe8f 	bl	c0de0254 <_RINvNtCs77Jtq17PsCU_4core3ptr13drop_in_placeNtNtCskVXdcy3eKtj_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de362a:	9042      	str	r0, [sp, #264]	@ 0x108
c0de362c:	a808      	add	r0, sp, #32
c0de362e:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de3632:	f7fc fe0f 	bl	c0de0254 <_RINvNtCs77Jtq17PsCU_4core3ptr13drop_in_placeNtNtCskVXdcy3eKtj_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de0254 <_RINvNtCs77Jtq17PsCU_4core3ptr13drop_in_placeNtNtCskVXdcy3eKtj_12pearl_ledger6crypto10PrivateKeyEBK_>:
c0de0254:	b5d0      	push	{r4, r6, r7, lr}
c0de0256:	af02      	add	r7, sp, #8
c0de0258:	4604      	mov	r4, r0
c0de025a:	3008      	adds	r0, #8
c0de025c:	f006 f924 	bl	c0de64a8 <_RNvXs2_CsgnFOl4UCvib_7zeroizeAhj20_NtB5_7Zeroize7zeroizeCs2ztrPTGy3KX_10pearl_core>
c0de0260:	2000      	movs	r0, #0
c0de0262:	6060      	str	r0, [r4, #4]
c0de0264:	7020      	strb	r0, [r4, #0]
c0de0266:	bdd0      	pop	{r4, r6, r7, pc}

c0de64a8 <_RNvXs2_CsgnFOl4UCvib_7zeroizeAhj20_NtB5_7Zeroize7zeroizeCs2ztrPTGy3KX_10pearl_core>:
c0de64a8:	b5e0      	push	{r5, r6, r7, lr}
c0de64aa:	af02      	add	r7, sp, #8
c0de64ac:	9000      	str	r0, [sp, #0]
c0de64ae:	3020      	adds	r0, #32
c0de64b0:	9001      	str	r0, [sp, #4]
c0de64b2:	4668      	mov	r0, sp
c0de64b4:	f000 f80a 	bl	c0de64cc <_RNvXs4_CsgnFOl4UCvib_7zeroizeINtNtNtCs77Jtq17PsCU_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs2ztrPTGy3KX_10pearl_core>
c0de64b8:	bd8c      	pop	{r2, r3, r7, pc}

c0de64cc <_RNvXs4_CsgnFOl4UCvib_7zeroizeINtNtNtCs77Jtq17PsCU_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs2ztrPTGy3KX_10pearl_core>:
c0de64cc:	b580      	push	{r7, lr}
c0de64ce:	466f      	mov	r7, sp
c0de64d0:	2100      	movs	r1, #0
c0de64d2:	e9d0 2300 	ldrd	r2, r3, [r0]
c0de64d6:	429a      	cmp	r2, r3
c0de64d8:	bf08      	it	eq
c0de64da:	bd80      	popeq	{r7, pc}
c0de64dc:	f802 1b01 	strb.w	r1, [r2], #1
c0de64e0:	6002      	str	r2, [r0, #0]
c0de64e2:	e7f6      	b.n	c0de64d2 <_RNvXs4_CsgnFOl4UCvib_7zeroizeINtNtNtCs77Jtq17PsCU_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs2ztrPTGy3KX_10pearl_core+0x6>

```

## nanox
ELF `pearl-nanox-simnet.elf`, SHA256 `71920b16eaa629fd23b032756ae7dd0faecafab61da19ce40c4b5680433af568`.
Original account object: SP+11224; original signing object: SP+11000.
Account success/error Drop: 0xc0de1f0e/0xc0de1d60; identifier: 0xc0de1f24. Signing call: 0xc0de38ac; success/error Drop: 0xc0de38c6/0xc0de3994; verify: 0xc0de38ee.

```text
c0de1f06:	f00a f839 	bl	c0debf7c <__aeabi_memcpy>
c0de1f0a:	4852      	ldr	r0, [pc, #328]	@ (c0de2054 <sample_main+0xf58>)
c0de1f0c:	4468      	add	r0, sp
c0de1f0e:	f7fe f9db 	bl	c0de02c8 <_RINvNtCs46aIOn39SU8_4core3ptr13drop_in_placeNtNtCsks7nMV9NENT_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de1d5a:	240d      	movs	r4, #13
c0de1d5c:	48bd      	ldr	r0, [pc, #756]	@ (c0de2054 <sample_main+0xf58>)
c0de1d5e:	4468      	add	r0, sp
c0de1d60:	f7fe fab2 	bl	c0de02c8 <_RINvNtCs46aIOn39SU8_4core3ptr13drop_in_placeNtNtCsks7nMV9NENT_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de38a4:	2203      	movs	r2, #3
c0de38a6:	4b67      	ldr	r3, [pc, #412]	@ (c0de3a44 <sample_main+0x2948>)
c0de38a8:	446b      	add	r3, sp
c0de38aa:	495b      	ldr	r1, [pc, #364]	@ (c0de3a18 <sample_main+0x291c>)
c0de38ac:	f003 ffa8 	bl	c0de7800 <cx_ecschnorr_sign_no_throw>
...
c0de38be:	f008 fb62 	bl	c0debf86 <__aeabi_memcpy4>
c0de38c2:	485d      	ldr	r0, [pc, #372]	@ (c0de3a38 <sample_main+0x293c>)
c0de38c4:	4468      	add	r0, sp
c0de38c6:	f7fc fcff 	bl	c0de02c8 <_RINvNtCs46aIOn39SU8_4core3ptr13drop_in_placeNtNtCsks7nMV9NENT_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de398c:	200d      	movs	r0, #13
c0de398e:	908d      	str	r0, [sp, #564]	@ 0x234
c0de3990:	4829      	ldr	r0, [pc, #164]	@ (c0de3a38 <sample_main+0x293c>)
c0de3992:	4468      	add	r0, sp
c0de3994:	f7fc fc98 	bl	c0de02c8 <_RINvNtCs46aIOn39SU8_4core3ptr13drop_in_placeNtNtCsks7nMV9NENT_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de02c8 <_RINvNtCs46aIOn39SU8_4core3ptr13drop_in_placeNtNtCsks7nMV9NENT_12pearl_ledger6crypto10PrivateKeyEBK_>:
c0de02c8:	b5d0      	push	{r4, r6, r7, lr}
c0de02ca:	af02      	add	r7, sp, #8
c0de02cc:	4604      	mov	r4, r0
c0de02ce:	3008      	adds	r0, #8
c0de02d0:	f006 face 	bl	c0de6870 <_RNvXs2_Csew5e7ktAoNj_7zeroizeAhj20_NtB5_7Zeroize7zeroizeCs4qqpmTE3yor_10pearl_core>
c0de02d4:	2000      	movs	r0, #0
c0de02d6:	6060      	str	r0, [r4, #4]
c0de02d8:	7020      	strb	r0, [r4, #0]
c0de02da:	bdd0      	pop	{r4, r6, r7, pc}

c0de6870 <_RNvXs2_Csew5e7ktAoNj_7zeroizeAhj20_NtB5_7Zeroize7zeroizeCs4qqpmTE3yor_10pearl_core>:
c0de6870:	b5e0      	push	{r5, r6, r7, lr}
c0de6872:	af02      	add	r7, sp, #8
c0de6874:	9000      	str	r0, [sp, #0]
c0de6876:	3020      	adds	r0, #32
c0de6878:	9001      	str	r0, [sp, #4]
c0de687a:	4668      	mov	r0, sp
c0de687c:	f000 f80a 	bl	c0de6894 <_RNvXs4_Csew5e7ktAoNj_7zeroizeINtNtNtCs46aIOn39SU8_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs4qqpmTE3yor_10pearl_core>
c0de6880:	bd8c      	pop	{r2, r3, r7, pc}

c0de6894 <_RNvXs4_Csew5e7ktAoNj_7zeroizeINtNtNtCs46aIOn39SU8_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs4qqpmTE3yor_10pearl_core>:
c0de6894:	b580      	push	{r7, lr}
c0de6896:	af00      	add	r7, sp, #0
c0de6898:	c806      	ldmia	r0!, {r1, r2}
c0de689a:	3808      	subs	r0, #8
c0de689c:	4291      	cmp	r1, r2
c0de689e:	d004      	beq.n	c0de68aa <_RNvXs4_Csew5e7ktAoNj_7zeroizeINtNtNtCs46aIOn39SU8_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs4qqpmTE3yor_10pearl_core+0x16>
c0de68a0:	2200      	movs	r2, #0
c0de68a2:	700a      	strb	r2, [r1, #0]
c0de68a4:	1c49      	adds	r1, r1, #1
c0de68a6:	6001      	str	r1, [r0, #0]
c0de68a8:	e7f6      	b.n	c0de6898 <_RNvXs4_Csew5e7ktAoNj_7zeroizeINtNtNtCs46aIOn39SU8_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs4qqpmTE3yor_10pearl_core+0x4>
c0de68aa:	bd80      	pop	{r7, pc}

```

## stax
ELF `pearl-stax-simnet.elf`, SHA256 `5f6fbc9d7330992958afb8f875c48f8df9ecab1446d8ec4366f2016d0a2a7449`.
Original account object: SP+10936; original signing object: SP+10712.
Account success/error Drop: 0xc0de1a32/0xc0de1954; identifier: 0xc0de1a42. Signing call: 0xc0de3446; success/error Drop: 0xc0de3466/0xc0de3556; verify: 0xc0de3498.

```text
c0de1a2c:	a80e      	add	r0, sp, #56	@ 0x38
c0de1a2e:	f500 502a 	add.w	r0, r0, #10880	@ 0x2a80
c0de1a32:	f7fe fc0f 	bl	c0de0254 <_RINvNtCs5DroFJSorLX_4core3ptr13drop_in_placeNtNtCsbtBwyjVvsTk_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de194c:	240d      	movs	r4, #13
c0de194e:	a80e      	add	r0, sp, #56	@ 0x38
c0de1950:	f500 502a 	add.w	r0, r0, #10880	@ 0x2a80
c0de1954:	f7fe fc7e 	bl	c0de0254 <_RINvNtCs5DroFJSorLX_4core3ptr13drop_in_placeNtNtCsbtBwyjVvsTk_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de343e:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de3442:	f503 5321 	add.w	r3, r3, #10304	@ 0x2840
c0de3446:	f003 ffb5 	bl	c0de73b4 <cx_ecschnorr_sign_no_throw>
...
c0de3460:	a806      	add	r0, sp, #24
c0de3462:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de3466:	f7fc fef5 	bl	c0de0254 <_RINvNtCs5DroFJSorLX_4core3ptr13drop_in_placeNtNtCsbtBwyjVvsTk_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de354e:	9040      	str	r0, [sp, #256]	@ 0x100
c0de3550:	a806      	add	r0, sp, #24
c0de3552:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de3556:	f7fc fe7d 	bl	c0de0254 <_RINvNtCs5DroFJSorLX_4core3ptr13drop_in_placeNtNtCsbtBwyjVvsTk_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de0254 <_RINvNtCs5DroFJSorLX_4core3ptr13drop_in_placeNtNtCsbtBwyjVvsTk_12pearl_ledger6crypto10PrivateKeyEBK_>:
c0de0254:	b5d0      	push	{r4, r6, r7, lr}
c0de0256:	af02      	add	r7, sp, #8
c0de0258:	4604      	mov	r4, r0
c0de025a:	3008      	adds	r0, #8
c0de025c:	f004 fb66 	bl	c0de492c <_RNvXs2_CsiLTHchqG5uO_7zeroizeAhj20_NtB5_7Zeroize7zeroizeCs4evpqr0qGFa_17ledger_device_sdk>
c0de0260:	2000      	movs	r0, #0
c0de0262:	6060      	str	r0, [r4, #4]
c0de0264:	7020      	strb	r0, [r4, #0]
c0de0266:	bdd0      	pop	{r4, r6, r7, pc}

c0de492c <_RNvXs2_CsiLTHchqG5uO_7zeroizeAhj20_NtB5_7Zeroize7zeroizeCs4evpqr0qGFa_17ledger_device_sdk>:
c0de492c:	b5e0      	push	{r5, r6, r7, lr}
c0de492e:	af02      	add	r7, sp, #8
c0de4930:	9000      	str	r0, [sp, #0]
c0de4932:	3020      	adds	r0, #32
c0de4934:	9001      	str	r0, [sp, #4]
c0de4936:	4668      	mov	r0, sp
c0de4938:	f000 f80a 	bl	c0de4950 <_RNvXs4_CsiLTHchqG5uO_7zeroizeINtNtNtCs5DroFJSorLX_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs4evpqr0qGFa_17ledger_device_sdk>
c0de493c:	bd8c      	pop	{r2, r3, r7, pc}

c0de4950 <_RNvXs4_CsiLTHchqG5uO_7zeroizeINtNtNtCs5DroFJSorLX_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs4evpqr0qGFa_17ledger_device_sdk>:
c0de4950:	b580      	push	{r7, lr}
c0de4952:	466f      	mov	r7, sp
c0de4954:	2100      	movs	r1, #0
c0de4956:	e9d0 2300 	ldrd	r2, r3, [r0]
c0de495a:	429a      	cmp	r2, r3
c0de495c:	bf08      	it	eq
c0de495e:	bd80      	popeq	{r7, pc}
c0de4960:	f802 1b01 	strb.w	r1, [r2], #1
c0de4964:	6002      	str	r2, [r0, #0]
c0de4966:	e7f6      	b.n	c0de4956 <_RNvXs4_CsiLTHchqG5uO_7zeroizeINtNtNtCs5DroFJSorLX_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs4evpqr0qGFa_17ledger_device_sdk+0x6>

```

## flex
ELF `pearl-flex-simnet.elf`, SHA256 `d13e2224a766bcff9ccb5f0bc3d09ca59f686a9444092eb80ea594c0ba86e7f1`.
Original account object: SP+10944; original signing object: SP+10720.
Account success/error Drop: 0xc0de1a78/0xc0de19ee; identifier: 0xc0de1a8a. Signing call: 0xc0de356a; success/error Drop: 0xc0de358a/0xc0de368a; verify: 0xc0de35ba.

```text
c0de1a70:	f880 4440 	strb.w	r4, [r0, #1088]	@ 0x440
c0de1a74:	f50d 502b 	add.w	r0, sp, #10944	@ 0x2ac0
c0de1a78:	f7fe fbec 	bl	c0de0254 <_RINvNtCshdjlaM1dxLQ_4core3ptr13drop_in_placeNtNtCsgKvHugvzaNQ_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de19e6:	e0f7      	b.n	c0de1bd8 <sample_main+0xb88>
c0de19e8:	240d      	movs	r4, #13
c0de19ea:	f50d 502b 	add.w	r0, sp, #10944	@ 0x2ac0
c0de19ee:	f7fe fc31 	bl	c0de0254 <_RINvNtCshdjlaM1dxLQ_4core3ptr13drop_in_placeNtNtCsgKvHugvzaNQ_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de3562:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de3566:	f503 5321 	add.w	r3, r3, #10304	@ 0x2840
c0de356a:	f004 f845 	bl	c0de75f8 <cx_ecschnorr_sign_no_throw>
...
c0de3584:	a808      	add	r0, sp, #32
c0de3586:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de358a:	f7fc fe63 	bl	c0de0254 <_RINvNtCshdjlaM1dxLQ_4core3ptr13drop_in_placeNtNtCsgKvHugvzaNQ_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de3682:	9042      	str	r0, [sp, #264]	@ 0x108
c0de3684:	a808      	add	r0, sp, #32
c0de3686:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de368a:	f7fc fde3 	bl	c0de0254 <_RINvNtCshdjlaM1dxLQ_4core3ptr13drop_in_placeNtNtCsgKvHugvzaNQ_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de0254 <_RINvNtCshdjlaM1dxLQ_4core3ptr13drop_in_placeNtNtCsgKvHugvzaNQ_12pearl_ledger6crypto10PrivateKeyEBK_>:
c0de0254:	b5d0      	push	{r4, r6, r7, lr}
c0de0256:	af02      	add	r7, sp, #8
c0de0258:	4604      	mov	r4, r0
c0de025a:	3008      	adds	r0, #8
c0de025c:	f004 fbe4 	bl	c0de4a28 <_RNvXs2_Cs2waOsJYWFo6_7zeroizeAhj20_NtB5_7Zeroize7zeroizeCsiQwBDyy0eFg_17ledger_device_sdk>
c0de0260:	2000      	movs	r0, #0
c0de0262:	6060      	str	r0, [r4, #4]
c0de0264:	7020      	strb	r0, [r4, #0]
c0de0266:	bdd0      	pop	{r4, r6, r7, pc}

c0de4a28 <_RNvXs2_Cs2waOsJYWFo6_7zeroizeAhj20_NtB5_7Zeroize7zeroizeCsiQwBDyy0eFg_17ledger_device_sdk>:
c0de4a28:	b5e0      	push	{r5, r6, r7, lr}
c0de4a2a:	af02      	add	r7, sp, #8
c0de4a2c:	9000      	str	r0, [sp, #0]
c0de4a2e:	3020      	adds	r0, #32
c0de4a30:	9001      	str	r0, [sp, #4]
c0de4a32:	4668      	mov	r0, sp
c0de4a34:	f000 f80a 	bl	c0de4a4c <_RNvXs4_Cs2waOsJYWFo6_7zeroizeINtNtNtCshdjlaM1dxLQ_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCsiQwBDyy0eFg_17ledger_device_sdk>
c0de4a38:	bd8c      	pop	{r2, r3, r7, pc}

c0de4a4c <_RNvXs4_Cs2waOsJYWFo6_7zeroizeINtNtNtCshdjlaM1dxLQ_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCsiQwBDyy0eFg_17ledger_device_sdk>:
c0de4a4c:	b580      	push	{r7, lr}
c0de4a4e:	466f      	mov	r7, sp
c0de4a50:	2100      	movs	r1, #0
c0de4a52:	e9d0 2300 	ldrd	r2, r3, [r0]
c0de4a56:	429a      	cmp	r2, r3
c0de4a58:	bf08      	it	eq
c0de4a5a:	bd80      	popeq	{r7, pc}
c0de4a5c:	f802 1b01 	strb.w	r1, [r2], #1
c0de4a60:	6002      	str	r2, [r0, #0]
c0de4a62:	e7f6      	b.n	c0de4a52 <_RNvXs4_Cs2waOsJYWFo6_7zeroizeINtNtNtCshdjlaM1dxLQ_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCsiQwBDyy0eFg_17ledger_device_sdk+0x6>

```

## apex_p
ELF `pearl-apex_p-simnet.elf`, SHA256 `98d624ac34120b70c2df7f5b3696fddef219f7d3aeee19e50e3f60590aae8959`.
Original account object: SP+10944; original signing object: SP+10720.
Account success/error Drop: 0xc0de1a78/0xc0de19ee; identifier: 0xc0de1a8a. Signing call: 0xc0de356a; success/error Drop: 0xc0de358a/0xc0de368a; verify: 0xc0de35ba.

```text
c0de1a70:	f880 4440 	strb.w	r4, [r0, #1088]	@ 0x440
c0de1a74:	f50d 502b 	add.w	r0, sp, #10944	@ 0x2ac0
c0de1a78:	f7fe fbec 	bl	c0de0254 <_RINvNtCshTAuGF9Ap7R_4core3ptr13drop_in_placeNtNtCs369opVfLGbd_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de19e6:	e0f7      	b.n	c0de1bd8 <sample_main+0xb88>
c0de19e8:	240d      	movs	r4, #13
c0de19ea:	f50d 502b 	add.w	r0, sp, #10944	@ 0x2ac0
c0de19ee:	f7fe fc31 	bl	c0de0254 <_RINvNtCshTAuGF9Ap7R_4core3ptr13drop_in_placeNtNtCs369opVfLGbd_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de3562:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de3566:	f503 5321 	add.w	r3, r3, #10304	@ 0x2840
c0de356a:	f004 f839 	bl	c0de75e0 <cx_ecschnorr_sign_no_throw>
...
c0de3584:	a808      	add	r0, sp, #32
c0de3586:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de358a:	f7fc fe63 	bl	c0de0254 <_RINvNtCshTAuGF9Ap7R_4core3ptr13drop_in_placeNtNtCs369opVfLGbd_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de3682:	9042      	str	r0, [sp, #264]	@ 0x108
c0de3684:	a808      	add	r0, sp, #32
c0de3686:	f500 5027 	add.w	r0, r0, #10688	@ 0x29c0
c0de368a:	f7fc fde3 	bl	c0de0254 <_RINvNtCshTAuGF9Ap7R_4core3ptr13drop_in_placeNtNtCs369opVfLGbd_12pearl_ledger6crypto10PrivateKeyEBK_>
...
c0de0254 <_RINvNtCshTAuGF9Ap7R_4core3ptr13drop_in_placeNtNtCs369opVfLGbd_12pearl_ledger6crypto10PrivateKeyEBK_>:
c0de0254:	b5d0      	push	{r4, r6, r7, lr}
c0de0256:	af02      	add	r7, sp, #8
c0de0258:	4604      	mov	r4, r0
c0de025a:	3008      	adds	r0, #8
c0de025c:	f006 f94a 	bl	c0de64f4 <_RNvXs2_CseAgIIkq7PG_7zeroizeAhj20_NtB5_7Zeroize7zeroizeCs22dDtkByXt3_10pearl_core>
c0de0260:	2000      	movs	r0, #0
c0de0262:	6060      	str	r0, [r4, #4]
c0de0264:	7020      	strb	r0, [r4, #0]
c0de0266:	bdd0      	pop	{r4, r6, r7, pc}

c0de64f4 <_RNvXs2_CseAgIIkq7PG_7zeroizeAhj20_NtB5_7Zeroize7zeroizeCs22dDtkByXt3_10pearl_core>:
c0de64f4:	b5e0      	push	{r5, r6, r7, lr}
c0de64f6:	af02      	add	r7, sp, #8
c0de64f8:	9000      	str	r0, [sp, #0]
c0de64fa:	3020      	adds	r0, #32
c0de64fc:	9001      	str	r0, [sp, #4]
c0de64fe:	4668      	mov	r0, sp
c0de6500:	f000 f80a 	bl	c0de6518 <_RNvXs4_CseAgIIkq7PG_7zeroizeINtNtNtCshTAuGF9Ap7R_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs22dDtkByXt3_10pearl_core>
c0de6504:	bd8c      	pop	{r2, r3, r7, pc}

c0de6518 <_RNvXs4_CseAgIIkq7PG_7zeroizeINtNtNtCshTAuGF9Ap7R_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs22dDtkByXt3_10pearl_core>:
c0de6518:	b580      	push	{r7, lr}
c0de651a:	466f      	mov	r7, sp
c0de651c:	2100      	movs	r1, #0
c0de651e:	e9d0 2300 	ldrd	r2, r3, [r0]
c0de6522:	429a      	cmp	r2, r3
c0de6524:	bf08      	it	eq
c0de6526:	bd80      	popeq	{r7, pc}
c0de6528:	f802 1b01 	strb.w	r1, [r2], #1
c0de652c:	6002      	str	r2, [r0, #0]
c0de652e:	e7f6      	b.n	c0de651e <_RNvXs4_CseAgIIkq7PG_7zeroizeINtNtNtCshTAuGF9Ap7R_4core5slice4iter7IterMuthENtB5_7Zeroize7zeroizeCs22dDtkByXt3_10pearl_core+0x6>

```


## Fixed-length scalar-zero predicate

All five final simnet ELFs also retain the full 32-byte OR-reduction loop in pearl_scalar_is_zero, with no data-dependent early exit. Entry addresses: Nano S Plus 0xc0de74bc, Nano X 0xc0de7710, Stax 0xc0de72c4, Flex 0xc0de7508, Gen5/apex_p 0xc0de74f0. Only the public counter controls the loop; this machine-code observation does not establish secure-element timing/power resistance. Nano S Plus example:

```text
c0de74bc <pearl_scalar_is_zero>:
c0de74bc:	2100      	movs	r1, #0
c0de74be:	2200      	movs	r2, #0
c0de74c0:	2a20      	cmp	r2, #32
c0de74c2:	d003      	beq.n	c0de74cc <pearl_scalar_is_zero+0x10>
c0de74c4:	5c83      	ldrb	r3, [r0, r2]
c0de74c6:	3201      	adds	r2, #1
c0de74c8:	4319      	orrs	r1, r3
c0de74ca:	e7f9      	b.n	c0de74c0 <pearl_scalar_is_zero+0x4>
c0de74cc:	fab1 f081 	clz	r0, r1
c0de74d0:	0940      	lsrs	r0, r0, #5
c0de74d2:	4770      	bx	lr
```
