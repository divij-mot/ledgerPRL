#!/usr/bin/env python3
"""Replay the bounded original-slot cleanup checks for 25 exact immutable ELFs.
Not a formal verifier, CPU emulator, physical-erasure test, or general ARM parser.
Both caller branch outcomes are followed, stopping at each first PrivateKey Drop.
Normal-return/ABI/no-memory-corruption assumptions apply. RNG timing and other
manual-review conclusions remain bounded by REPORT.md; this script does not
turn those manual observations into an all-platform physical guarantee.
"""
import argparse, hashlib, json, os, re, subprocess, sys
from pathlib import Path

def parse(path):
    ins={}; main=[]; cur=None
    for line in path.read_text().splitlines():
        h=re.match(r'([0-9a-f]+) <(.+)>:',line)
        if h: cur=h[2]; continue
        m=re.match(r'([0-9a-f]+):\s+([0-9a-f ]+)\t([^\t]+)\t?(.*)',line)
        if m:
            a=int(m[1],16); op=m[3].strip(); arg=m[4].strip(); ins[a]=(op,arg,line,cur)
            if cur=='sample_main': main.append(a)
    return ins,main

def trace(ins,main,at,reg,depth=0):
    if depth>150: raise ValueError('pointer recursion')
    if reg=='sp': return 0
    ix=main.index(at)
    for a in reversed(main[:ix]):
        op,arg,_,_=ins[a]; op=op.replace('.w','').replace('.n','')
        bits=arg.split('@')[0].strip().split(', ')
        if op=='bl' and reg in ['r0','r1','r2','r3','ip']: raise ValueError(f'call-clobbered {reg} at {a:x}')
        if not bits or bits[0]!=reg or op.startswith(('str','cmp','tst','b','it','push')): continue
        if op in ['mov','movs']: return int(bits[1][1:],0) if bits[1].startswith('#') else trace(ins,main,a,bits[1],depth+1)
        if op in ['add','adds','addw']:
            src=bits[1] if len(bits)>2 else reg; rhs=bits[2] if len(bits)>2 else bits[1]
            val=trace(ins,main,a,src,depth+1)
            return val+(int(rhs[1:],0) if rhs.startswith('#') else trace(ins,main,a,rhs,depth+1))
        if op=='ldr' and '[pc,' in arg:
            addr=int(re.search(r'@ \(([0-9a-f]+)',arg)[1],16)
            lop,larg,*_=ins[addr]; assert lop=='.word'; return int(larg.split()[0],16)
        raise ValueError(f'unsupported definition {reg}: {ins[a][2]}')
    raise ValueError(f'no definition {reg} before {at:x}')

def graph(ins,main,start):
    seen=set(); todo=[start]; drops=[]; calls=[]; branches=[]
    nexts=dict(zip(main,main[1:]))
    while todo:
        a=todo.pop()
        if a in seen:continue
        seen.add(a); op,arg,line,_=ins[a]; base=op.split('.')[0]
        if base=='bl':
            calls.append((a,arg))
            if 'crypto10PrivateKey' in arg: drops.append(a); continue
            assert not any(x in arg for x in ['cx_ecschnorr_verify','os_perso_get_master_key_identifier']),line
            todo.append(nexts[a]); continue
        if base in ['blx','bx','pop','ldmia'] or base=='.word': raise ValueError('unexpected CFG exit '+line)
        if base in ['b','beq','bne','bhi','bls','bcc','bcs','bpl','bmi','bge','blt','bgt','ble','cbz','cbnz']:
            target=int(re.search(r'(c[0-9a-f]+) <',arg)[1],16); assert target in nexts,line
            branches.append(a); todo.append(target)
            if base!='b':todo.append(nexts[a])
        else:
            assert not re.search(r'\bsp\b',arg.split('@')[0]) or not base.startswith(('sub','push','pop')),line
            todo.append(nexts[a])
    assert len(drops)==2, drops
    return {'visitedInstructions':len(seen),'branchAddresses':[f'{a:08x}' for a in sorted(branches)],'dropCalls':[f'{a:08x}' for a in sorted(drops)],'calls':[{'address':f'{a:08x}','target':t} for a,t in calls]},drops

def shape(ins,name):
    seq=[(a,*ins[a][:2]) for a in ins if ins[a][3]==name]
    # Functions can include alignment traps after return. Retain exact extent
    # through the last ordinary return, excluding trailing padding only.
    while seq and seq[-1][1] in ['bmi.n','nop']:seq.pop()
    start=seq[0][0]; out=[]
    for a,op,arg in seq:
        sym=re.search(r'([0-9a-f]+) <(.+)>',arg)
        arg=arg.split('@')[0].rstrip()
        if sym:
            target=int(sym[1],16); dst=sym[2]
            if dst.split('+')[0]==name: role=f'local+{target-start:x}'
            elif 'zeroizeAhj20_' in dst: role='zeroize32'
            elif 'zeroizeAhj40_' in dst: role='zeroize64'
            elif 'IterMuth' in dst and 'Zeroize7zeroize' in dst: role='zeroizeIterator'
            else: raise ValueError('unexpected callee '+dst)
            arg=re.sub(r'[0-9a-f]+ <.+>',role,arg)
        out.append(op+' '+arg)
    return out

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1048576),b''): h.update(block)
    return h.hexdigest()

def require(condition,message):
    if not condition: raise ValueError(message)

def unique(names,predicate,label):
    matches=[n for n in names if n and predicate(n)]
    require(len(matches)==1,f"Expected exactly one {label}; got {len(matches)}")
    return matches[0]

def verify_inputs(args,expected):
    require(sha(args.source_file)==expected['cryptoSha256'],'Source file SHA256 mismatch')
    require(len(expected['artifacts'])==25,'Identity file must contain exactly 25 artifacts')
    require(len({x['name'] for x in expected['artifacts']})==25,'Duplicate artifact identities')
    for rec in expected['artifacts']:
        elf=args.artifacts_dir/rec['elfFile']; mf=args.artifacts_dir/rec['manifestFile']
        require(sha(elf)==rec['elfSha256'],f"ELF SHA256 mismatch: {elf.name}")
        require(sha(mf)==rec['manifestSha256'],f"Manifest SHA256 mismatch: {mf.name}")
        m=json.loads(mf.read_text())
        require(m['elfSha256']==rec['elfSha256'],f"Manifest ELF hash mismatch: {elf.name}")
        require(m['sources'][expected['sourceRelativePath']]==expected['cryptoSha256'],f"Manifest source mismatch: {elf.name}")
        for key in ['device','network','rustSdk','secureSdk']:
            require(m[key]==rec[key],f"Manifest {key} mismatch: {elf.name}")

def analyze_cfg(path):
    ins,main=parse(path)
    derive=[a for a in main if ins[a][0]=='bl' and 'crypto6derive' in ins[a][1]]
    tweak=[a for a in main if ins[a][0]=='bl' and 'crypto11tweaked_key' in ins[a][1]]
    require(len(derive)==len(tweak)==1,f"Expected single account derive/signing tweak: {path.name}")
    row={'artifact':path.stem}
    for label,site,reg in [('account',derive[0],'r3'),('signing',tweak[0],'r1')]:
        value=trace(ins,main,site,reg); g,drops=graph(ins,main,main[main.index(site)+1])
        pointers=[trace(ins,main,d,'r0') for d in drops]
        require(all(p==value for p in pointers),f"Original-slot mismatch: {path.name} {label}")
        row[label]={'keySPoffset':value,'entryCall':f'{site:08x}',**g}
    sign=[a for a in main if ins[a][0]=='bl' and '<cx_ecschnorr_sign_no_throw>' in ins[a][1]]
    require(len(sign)==1,f"Expected single sign call: {path.name}")
    require(trace(ins,main,sign[0],'r0')==row['signing']['keySPoffset'],f"Signing key address mismatch: {path.name}")
    row['signCall']=f'{sign[0]:08x}'
    return ins,row

def main():
    # Helper assertions are security checks; never permit -O to disable them.
    if not __debug__: raise SystemExit('Do not run this checker with Python -O/-OO')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-file',type=Path,required=True,help='Exact final apps/ledger/src/crypto.rs')
    parser.add_argument('--artifacts-dir',type=Path,required=True,help='Directory containing all 25 immutable ELFs and adjacent .build.json files')
    parser.add_argument('--objdump',type=Path,required=True,help='Explicit arm-none-eabi-objdump executable')
    parser.add_argument('--output-dir',type=Path,required=True,help='New or empty separate directory; full replay disassemblies are written here')
    parser.add_argument('--objdump-library-dir',type=Path,help='Optional toolchain library directory for LD_LIBRARY_PATH')
    args=parser.parse_args()
    package=Path(__file__).resolve().parent
    expected=json.loads((package/'identities.json').read_text())
    expected_cfg=json.loads((package/'evidence/cfg-results.json').read_text())
    expected_wipes=json.loads((package/'evidence/wipe-shapes.json').read_text())
    args.source_file=args.source_file.resolve(strict=True)
    args.artifacts_dir=args.artifacts_dir.resolve(strict=True)
    args.objdump=args.objdump.resolve(strict=True)
    args.output_dir=args.output_dir.resolve()
    require(args.objdump.is_file() and os.access(args.objdump,os.X_OK),'objdump must be an executable file')
    # Prevent accidental writes to retained evidence or input artifacts/source.
    for protected in [package,args.artifacts_dir,args.source_file.parent]:
        require(not args.output_dir.is_relative_to(protected),'Output directory must be outside inputs and package')
    require(not args.output_dir.exists() or (args.output_dir.is_dir() and not any(args.output_dir.iterdir())),'Output directory must be new or empty')
    verify_inputs(args,expected)  # Fail before launching objdump on any mismatch.
    args.output_dir.mkdir(parents=True,exist_ok=True)
    env=dict(os.environ)
    if args.objdump_library_dir:
        lib=args.objdump_library_dir.resolve(strict=True)
        require(lib.is_dir(),'objdump library path must be a directory')
        env['LD_LIBRARY_PATH']=str(lib)+(os.pathsep+env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
    version=subprocess.check_output([str(args.objdump),'--version'],env=env,text=True)
    cfg=[]; wipe_results=[]
    for rec in expected['artifacts']:
        asm=args.output_dir/(rec['name']+'.asm')
        with asm.open('wb') as out:
            subprocess.run([str(args.objdump),'-d',str(args.artifacts_dir/rec['elfFile'])],env=env,stdout=out,check=True)
        ins,row=analyze_cfg(asm); cfg.append(row)
        names={x[3] for x in ins.values()}
        kinds={
            'privateDrop':unique(names,lambda n:'crypto10PrivateKey' in n,'PrivateKey Drop'),
            'zeroize32':unique(names,lambda n:'zeroizeAhj20_' in n,'zeroize32'),
            'zeroize64':unique(names,lambda n:'zeroizeAhj40_' in n,'zeroize64'),
            'iterator':unique(names,lambda n:'IterMuth' in n and 'Zeroize7zeroize' in n,'byte iterator')}
        actual={k:shape(ins,n) for k,n in kinds.items()}
        require(actual==expected_wipes['baselineShapes'][rec['device']],f"Wipe instruction shape mismatch: {rec['name']}")
        wipe_results.append({'artifact':rec['name'],'zeroizerSemanticShapeMatchesManuallyReviewedSimnet':True})
    cfg.sort(key=lambda r:r['artifact']); wipe_results.sort(key=lambda r:r['artifact'])
    require(cfg==expected_cfg,'CFG/pointer result differs from retained independent review')
    require(wipe_results==expected_wipes['results'],'Wipe result set differs from retained review')
    verify_inputs(args,expected)  # Detect changed inputs across replay.
    result={'status':'PASS','artifactCount':25,'claim':'Original-slot scalar32 + d_len32 + curve8 zero stores on ordinary caller success/error paths; no physical/register/OS-exception guarantee','objdumpVersion':version,'cfgResults':cfg,'wipeResults':wipe_results,'sourceSha256':expected['cryptoSha256']}
    (args.output_dir/'replay-results.json').write_text(json.dumps(result,indent=2)+'\n')
    print('PASS: all 25 exact artifacts match retained original-slot CFG/address and zeroizer checks.')
    print('Explicit stores: scalar32 + d_len32 + curve8. ABI padding and OS/register/physical limitations remain.')
    print(args.output_dir/'replay-results.json')

if __name__=='__main__':
    try: main()
    except (AssertionError, ValueError, KeyError, OSError, subprocess.CalledProcessError) as exc:
        print(f'FAIL: {exc}',file=sys.stderr); sys.exit(1)
