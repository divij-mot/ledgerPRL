/* SPDX-License-Identifier: Apache-2.0 */
#include <assert.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>
#include "prl.h"
#include "ui/display_utils.h"
static uint64_t next(uint64_t *s) {return *s=*s*UINT64_C(6364136223846793005)+1;}
int main(void) {
 uint64_t seed=1;
 for(size_t k=0;k<1000000;k++) {
  uint64_t sum=next(&seed),value=next(&seed),old=sum;
  bool expected=(__uint128_t)old+value<=PRL_MAX_MONEY;
  assert(prl_money_add(&sum,value)==expected);
  assert(sum==(expected?old+value:old));
  uint64_t fee=next(&seed),total=next(&seed);
  assert(prl_high_fee(fee,total)==(total>100000&&(__uint128_t)fee*10>=total));
 }
 for(uint64_t total=0;total<200000;total++)for(uint64_t fee=total/10;fee<=total/10+1;fee++)
  assert(prl_high_fee(fee,total)==(total>100000&&(__uint128_t)fee*10>=total));
 uint64_t sum=PRL_MAX_MONEY;assert(!prl_money_add(&sum,1));assert(sum==PRL_MAX_MONEY);
 assert(prl_high_fee(UINT64_C(1900000000000000000),PRL_MAX_MONEY));
 struct {uint64_t value;const char *text;} cases[]={
  {0,"0 PRL"},{1,"0.00000001 PRL"},{100000001,"1.00000001 PRL"},
  {UINT64_C(9007199254740991),"90071992.54740991 PRL"},
  {UINT64_C(9007199254740992),"90071992.54740992 PRL"},
  {UINT64_C(9007199254740993),"90071992.54740993 PRL"},
  {PRL_MAX_MONEY,"21000000000 PRL"},{PRL_MAX_MONEY-1,"20999999999.99999999 PRL"},
  {UINT64_MAX,"184467440737.09551615 PRL"}};
 for(size_t i=0;i<sizeof(cases)/sizeof(*cases);i++) {
  struct {unsigned char pre;char text[MAX_AMOUNT_LENGTH+1];unsigned char post;} out;
  memset(&out,0x5a,sizeof(out));format_sats_amount("PRL",cases[i].value,out.text);
  assert(out.pre==0x5a&&out.post==0x5a);assert(strcmp(out.text,cases[i].text)==0);
 }
 uint32_t path[]={PRL_HARDENED|86,PRL_HARDENED|PRL_COIN_TYPE,UINT32_MAX,1,0x7fffffff};
 assert(prl_account_path_valid(path,3));assert(prl_address_path_valid(path,5));
 assert(!prl_account_path_valid(path,2));assert(!prl_account_path_valid(path,4));
 path[4]=PRL_HARDENED;assert(!prl_address_path_valid(path,5));path[4]=0;
 path[3]=2;assert(!prl_address_path_valid(path,5));path[3]=0;
 path[1]^=1;assert(!prl_address_path_valid(path,5));
 printf("PASS network %u: 1M arithmetic, 400k fee boundaries, 9 amount strings/canaries, strict paths\n",PRL_NETWORK_ID);
}
