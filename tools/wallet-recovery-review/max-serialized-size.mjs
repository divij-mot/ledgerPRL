// Conservative serialized-shape bound only, not a cryptographic fixture.
// Every length is capped by the canonical parser/backup schema.
const record={
 id:'a'.repeat(64),state:'broadcast-unknown',createdAt:Number.MAX_SAFE_INTEGER,
 bundleHex:'a'.repeat(3014),outpoints:Array(16).fill('a'.repeat(64)+':4294967295'),
 txid:'a'.repeat(64),rawTx:'a'.repeat(3620),lastError:'\u0000'.repeat(1000),
 archived:{status:'confirmed',block:{height:4294967295,hash:'a'.repeat(64)},checkedAt:Number.MAX_SAFE_INTEGER}
};
const backup={schema:2,kind:'pearl-watch-backup',account:{network:'testnet2',account:2147483647,masterFingerprint:'a'.repeat(8),publicKey:'a'.repeat(66),chainCode:'a'.repeat(64)},journal:{schema:1,nextChangeIndex:2147483647,issuedReceiveThrough:2147483647,payments:Array(2000).fill(record)}};
console.log(JSON.stringify({conservativePrettyBytes:Buffer.byteLength(JSON.stringify(backup,null,2)),limit32MiB:32*1024*1024}));
for(const mode of ['compact','compact-without-archive','compact-without-archive-error']){
 const copy=structuredClone(backup);
 for(const p of copy.journal.payments){
  if(mode!=='compact')delete p.archived;
  if(mode==='compact-without-archive-error')delete p.lastError;
 }
 console.log(JSON.stringify({mode,bytes:Buffer.byteLength(JSON.stringify(copy)),limit16MiB:16*1024*1024}));
}
{
 const copy=structuredClone(backup);
 for(const p of copy.journal.payments)delete p.lastError;
 console.log(JSON.stringify({mode:'compact-without-error-preserve-archive',bytes:Buffer.byteLength(JSON.stringify(copy)),limit16MiB:16*1024*1024}));
}
