#!/usr/bin/env python3
"""Reconcile portable replay results directly with native log/APDU/ticker evidence."""
import argparse,hashlib,json,statistics
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run',type=Path,required=True)
parser.add_argument('--harness',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
a=parser.parse_args();R=a.run.resolve();sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_text())
prov=read(R/'provenance.json');run=R/'measurements';all_results=read(run/'summary.json');inputs=read(run/'harness-inputs.json')
assert all_results['status']=='passed' and all_results['sourceInputsUnchanged']
assert inputs['harnessSha256']==sha(a.harness)
rows=[]
for model,fw in prov['models'].items():
    assert fw['exactSourceMapVerified'] and fw['copiedElfVerified'] and fw['copiedManifestBytesVerified']
    manifest=read(Path(fw['frozenElf']).with_suffix('.build.json'))
    source_map={k:v for k,v in prov['sourceFiles'].items() if k!='fixtures/protocol-v1.json'}
    assert source_map==manifest['sources'] and sha(Path(fw['frozenElf']))==manifest['elfSha256']==fw['sha256']
    assert sha(Path(fw['frozenElf']).with_suffix('.build.json'))==fw['manifestSha256']
    result=read(run/model/'result.json');assert result['status']=='passed' and len(result['cases'])==4
    row={'model':model,'elfSha256':fw['sha256'],'preflightChecks':{'exactSourceMap':True,'copiedElfHash':True,'copiedManifestBytes':True},'states':[]}
    for no,name in [(1,'incomplete-receiving'),(2,'unapproved-review'),(3,'approved-partial-export')]:
        d=run/model/f'{no:02}-{name}';t=read(d/'apdu-transcript.json');observed=read(d/'ticker-observations.json')
        lines=(d/'speculos-monotonic.log').read_text().splitlines()
        ticks=[int(x.split(' ',1)[0]) for x in lines if 'seproxyhal.packet: send 0e0000' in x]
        exits=[int(x.split(' ',1)[0]) for x in lines if 'exit called (1)' in x]
        assert ticks==observed['normalTickDeliveryMonotonicNs'] and len(exits)==1 and exits[0]==observed['nativeExitNs']
        assert not any('Traceback' in x for x in lines)
        if no==2:
            upload_begin=next(x['atNs'] for x in t if x['direction']=='command' and x['hex'].startswith('e010'))
            mark=next(x for x in t if x['direction']=='command' and x['hex']=='e012000000' and x['atNs']>upload_begin)
        else:mark=[x for x in t if x['direction']=='response' and x['sw']=='9000'][-1]
        elapsed=(exits[0]-mark['atNs'])/1e9;active_ticks=[x for x in ticks if mark['atNs']<x<=exits[0]]
        assert len(active_ticks)==1200 and 119<elapsed<125
        assert not [x for x in t if x['direction']=='command' and mark['atNs']<x['atNs']<exits[0]]
        after=[x for x in t if x['direction']=='response' and x['atNs']>mark['atNs']]
        assert [x['hex'] for x in after]==(['6986'] if no==2 else [])
        case=result['cases'][no-1];assert case['status']=='passed' and case['normalTicksObserved']==1200 and case['elapsedSeconds']==elapsed
        assert case['transportClosed'] and case['postExpiryConnectRefused'] and case['nativeExitCode']==1
        intervals=[(b-a)/1e9 for a,b in zip(active_ticks,active_ticks[1:])]
        row['states'].append({'name':name,'elapsedSeconds':elapsed,'normalTicks':len(active_ticks),'medianTickIntervalSeconds':statistics.median(intervals),'maxTickIntervalSeconds':max(intervals),'nativeExitCode':1,'postReferenceResponseHex':[x['hex'] for x in after],'evidenceId':str(d.relative_to(R)),'evidenceSha256':{f:sha(d/f) for f in ['result.json','apdu-transcript.json','ticker-observations.json','speculos-monotonic.log','screens.json']}})
    for no,name in [(2,'unapproved-review'),(3,'approved-partial-export'),(4,'recovery-and-ordinary-idle')]:
        t=read(run/model/f'{no:02}-{name}'/'apdu-transcript.json')
        commands=[x['hex'] for x in t if x['direction']=='command'];responses=[x['hex'] for x in t if x['direction']=='response']
        assert commands[:3]==['e01300000101','e01300000100','e012000000'] and commands[3].startswith('e0110000161400')
        assert responses[:4]==['6986']*4
    idle=result['cases'][3];assert idle['status']=='passed' and idle['idleElapsedSeconds']>=125 and idle['idleNormalTicks']>=1200 and idle['sameIdleText'] and idle['infoApduStillWorks']
    assert idle['freshApprovalRequiredAndObserved'] and len(idle['freshSignaturesVerified'])==2
    d=run/model/'04-recovery-and-ordinary-idle';screens=read(d/'screens.json')
    start=next(x for x in screens if x['label']=='idle-start');end=next(x for x in screens if x['label']=='idle-end')
    assert [x['text'] for x in start['events']]==[x['text'] for x in end['events']]
    row['idle']={'elapsedSeconds':idle['idleElapsedSeconds'],'normalTicks':idle['idleNormalTicks'],'sameHomeText':True,'infoWorks':True,'evidenceId':str(d.relative_to(R)),'evidenceSha256':{f:sha(d/f) for f in ['result.json','apdu-transcript.json','ticker-observations.json','speculos-monotonic.log','screens.json']}}
    row['postExpiryStaleStateRejections']=12;row['freshPostExpiryApprovalAndTwoVerifiedSignatures']=True
    rows.append(row)
report={'status':'passed','kind':'Separate full portable-harness replay of previously qualified matrix; not additional unique coverage','models':rows,'testedHarnessSha256':sha(a.harness),'runInputSha256':sha(run/'harness-inputs.json'),'runProvenanceSha256':sha(R/'provenance.json'),'normalTickerOnly':True,'injectedTicks':False,'uniqueCoverage':'Five models x three pending states plus one idle/recovery control each. Replay does not expand that matrix.'}
with a.output.open('x') as f:json.dump(report,f,indent=2)
print(json.dumps(report,indent=2))
