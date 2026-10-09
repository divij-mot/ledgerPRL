#!/usr/bin/env python3
"""Reconstruct entire fields from real Speculos drawing events, including Nano subpages."""
import json,pathlib,re,hashlib,sys
ROOT=pathlib.Path(sys.argv[1]) if len(sys.argv)==2 else None
if ROOT is None: raise SystemExit('Usage: verify-trusted-display.py EVIDENCE_ROOT')
FIELD_NAMES=['Network','From account','Recipient','Amount','Fee','Change','Change address','Change path','Account path','Master fingerprint','Privacy','Address','Derivation','Type']
STOP=['Reject','Cancel','Confirm','Show as QR','Hold to sign','Sign Pearl transfer','Approve export','More','Review anyway','Swipe to review','Swipe to continue']
def normalized(s):return re.sub(r'\s+','',s)
def fields(screens,label):
 values={}
 for screen in [s for s in screens if s['label']==label]:
  current=None
  for event in screen['events']:
   t=event['text']
   base=re.sub(r' \(\d+/\d+\)$','',t)
   if base.startswith('Change...'):base='Change address'
   if base in FIELD_NAMES:
    current=base;values.setdefault(current,'');continue
   if t in STOP or re.match(r'^\d+ of \d+$',t):current=None;continue
   if current:values[current]+=t
 return {k:normalized(v) for k,v in values.items()}
results=[]
for d in sorted(ROOT.glob('baseline-*-r1')):
 screens=json.loads((d/'screens.json').read_text());expected=json.loads((d/'expected.json').read_text())
 firmware=json.loads((d/'firmware.json').read_text());network=expected['account']['network'];coin=808276 if network=='mainnet' else 1
 checks={
  'account-0':{'Network':f'Pearl {network}' if network!='mainnet' else 'Pearl mainnet','Account path':f"m/86'/{coin}'/0'",'Master fingerprint':'3442193e','Privacy':'Companion can view all addresses in this account'},
  'account-max':{'Account path':f"m/86'/{coin}'/2147483647'",'Master fingerprint':'3442193e','Privacy':'Companion can view all addresses in this account'},
  'receive-0':{'Address':expected['receive'],'Network':f'Pearl {network}','Derivation':f"m/86'/{coin}'/0'/0/0",'Type':'BIP86 no-script Taproot'},
  'address-max':{'Address':expected['extreme'],'Network':f'Pearl {network}','Derivation':f"m/86'/{coin}'/2147483647'/1/2147483647",'Type':'BIP86 no-script Taproot'},
  'max-amount':{'Network':f'Pearl {network}','From account':f"m/86'/{coin}'/0'",'Recipient':expected['recipient'],'Amount':expected['maxAmount'],'Fee':'0.00000001 PRL','Change':'0.00000001 PRL','Change address':expected['change'],'Change path':f"m/86'/{coin}'/0'/1/0"},
  'max-fee':{'Network':f'Pearl {network}','From account':f"m/86'/{coin}'/0'",'Recipient':expected['recipient'],'Amount':'0.00000001 PRL','Fee':expected['maxFee'],'Change':'None','Change address':'None','Change path':'None'}
 }
 count=0
 for label,expectedFields in checks.items():
  actual=fields(screens,label)
  for field,val in expectedFields.items():
   assert actual[field]==normalized(val),(d.name,label,field,actual[field],normalized(val))
   count+=1
 results.append({'directory':d.name,'model':firmware['model'],'sha256':firmware['sha256'],'network':network,'exactFieldChecks':count,'status':'passed','missingOrTruncatedValues':False})
assert len(results)==10, 'Expected all five models on mainnet and simnet'
(ROOT/'baseline-field-verification.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({'status':'passed','modelNetworkPairs':len(results),'exactFieldComparisons':sum(x['exactFieldChecks'] for x in results)},indent=2))

# Boundary-flow verification
results=[]
for m in ['nanosp','nanox','stax','flex','apex_p']:
 d=ROOT/f'extreme-paths-{m}-r1';s=json.loads((d/'screens.json').read_text());r=json.loads((d/'results.json').read_text());assert r['status']=='passed'
 checks={'all-warnings-max':{'Network':'Pearl simnet','From account':"m/86'/1'/2147483647'",'Amount':'0.00000001 PRL','Fee':'20999999999.99999998 PRL','Change':'0.00000001 PRL','Change path':"m/86'/1'/2147483647'/1/2147483647"},'zero-fee':{'Amount':'0.00000001 PRL','Fee':'0.00000000 PRL'},'max-amount-zero-fee':{'Amount':'21000000000.00000000 PRL','Fee':'0.00000000 PRL'},'high-fee-below':{'Amount':'0.00090001 PRL','Fee':'0.00010000 PRL'},'high-fee-ceiling':{'Amount':'0.00090000 PRL','Fee':'0.00010001 PRL'},'small-total-exception':{'Amount':'0.00000001 PRL','Fee':'0.00099999 PRL'}}
 expected=json.loads((ROOT/f'baseline-{m}-simnet-r1'/'expected.json').read_text())
 checks['all-warnings-max']['Recipient']=expected['recipient']
 checks['all-warnings-max']['Change address']=expected['extreme']
 count=0
 for name,expected in checks.items():
  actual=fields(s,name)
  for k,val in expected.items():assert actual[k]==normalized(val),(m,name,k,actual[k]);count+=1
 groups=[];current='';started=False
 for screen in [x for x in s if x['label']=='all-warnings-max']:
  events=screen['events'];t=[x['text'] for x in events]
  if 'Review Pearl transfer' in t:break
  if any(x.startswith(('Unusual','High transaction')) for x in t):started=True
  if not started:continue
  for x in t:
   if x=='Review anyway':groups.append(normalized(current));current='';continue
   if x.startswith(('Unusual','High tr')) or x=='Reject':continue
   current+=x
 expected=["m/86'/1'/2147483647'","m/86'/1'/2147483647'/0/2147483647","m/86'/1'/2147483647'/1/2147483647",'Fee 20999999999.99999998 PRL is at least 10% of inputs']
 assert groups==[normalized(x) for x in expected],(m,groups,expected)
 results.append({'model':m,'status':'passed','exactFieldChecks':count,'exactWarningDetailChecks':len(groups),'explicitWarningApprovals':4,'sha256':r['firmware']['sha256']})
(ROOT/'boundary-field-verification.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({'status':'passed','modelCount':len(results),'exactFieldComparisons':sum(x['exactFieldChecks'] for x in results),'exactWarningDetailComparisons':sum(x['exactWarningDetailChecks'] for x in results)},indent=2))
