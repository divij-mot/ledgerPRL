#!/usr/bin/env python3
"""Hash exact source and binary inputs; no network, device, or seed access."""
from pathlib import Path
import hashlib,json,os,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
APP=ROOT/'apps/ledger-bitcoin-prl'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def snapshot():
    files=[APP/'Makefile']
    for name in ['src','glyphs','icons']:
        files += [p for p in (APP/name).rglob('*') if p.is_file()]
    return {str(p.relative_to(APP)):sha(p) for p in sorted(files)}
def version(command): return subprocess.check_output(command,text=True).strip().splitlines()[0]
if sys.argv[1]=='snapshot': print(json.dumps(snapshot(),sort_keys=True,indent=2));sys.exit(0)
if sys.argv[1]!='record' or len(sys.argv)!=5: raise SystemExit('snapshot | record target network output')
target,network,out=sys.argv[2],sys.argv[3],Path(sys.argv[4])
sources=json.loads((out/'source-before.json').read_text())
if sources!=snapshot():raise SystemExit('source changed before manifest')
manifest={'schema':1,'target':target,'network':network,'upstream':json.loads((APP/'UPSTREAM.json').read_text()),
 'source_sha256':hashlib.sha256(json.dumps(sources,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
 'source_files':sources,'elf_sha256':sha(out/'app.elf'),'hex_sha256':sha(out/'app.hex'),
 'sdk_path':os.environ['BOLOS_SDK'],'compiler':version(['clang','--version']),
 'linker':version(['ld.lld','--version']),'arm_gcc':version(['arm-none-eabi-gcc','--version']),
 'build_log_sha256':sha(out/'build.log'),'warning_exception':'Only SDK src/app_metadata.c: clang19 ignores advisory nonstring attribute; warning retained. App remains -Werror.',
 'limitations':['Experimental fork, not vendor-approved','No physical-device installation or validation','API27 retarget differs from upstream deployment SDK26.6.2','No reproducible-across-paths claim']}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
