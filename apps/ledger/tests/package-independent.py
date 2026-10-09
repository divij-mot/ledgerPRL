#!/usr/bin/env python3
"""Read-only independent ELF/APDU verifier. Standard library only; no Ledger imports."""
import argparse, binascii, hashlib, json, pathlib, struct

def ensure(ok, message):
    if not ok: raise ValueError(message)

def cstring(raw, off):
    ensure(0 <= off < len(raw), 'bad string offset')
    end=raw.find(b'\0',off); ensure(end >= 0,'unterminated string')
    return raw[off:end].decode('ascii')

def elf_info(path):
    b=pathlib.Path(path).read_bytes()
    e=struct.unpack_from('<16sHHIIIIIHHHHHH',b)
    ensure(e[0][:7] == b'\x7fELF\x01\x01\x01' and e[1:3] == (2,40),'not little-endian ARM ELF32 executable')
    ensure(e[11] == 40 and e[12]>0 and e[13]<e[12],'invalid section table')
    headers=[struct.unpack_from('<IIIIIIIIII',b,e[6]+40*i) for i in range(e[12])]
    h=headers[e[13]]; names=b[h[4]:h[4]+h[5]]
    sections={}; symbols={}; expected={}; metadata={}
    for h in headers:
        name=cstring(names,h[0]); ensure(name not in sections or not name,'duplicate section')
        ensure(h[1] == 8 or h[4]+h[5] <= len(b),'section outside file')
        payload=b[h[4]:h[4]+h[5]] if h[1]!=8 else b''
        sections[name]=(h,payload)
        if name.startswith('ledger.'):
            ensure(payload.endswith(b'\n') and payload.count(b'\n')==1,'non-canonical ELF metadata')
            metadata[name[7:]]=payload[:-1].decode('ascii')
        if h[2]&2 and h[1]!=8 and h[5]:
            ensure(0xc0de0000 <= h[3] < 0xc0e00000,'unexpected allocated file-backed address')
            for i,v in enumerate(payload):
                address=h[3]+i; ensure(address not in expected,'overlapping allocated sections'); expected[address]=v
        if h[1]==2:
            ensure(h[9]==16 and h[5]%16==0,'bad symbol table')
            stringheader=headers[h[6]]; strings=b[stringheader[4]:stringheader[4]+stringheader[5]]
            for off in range(0,len(payload),16):
                s=struct.unpack_from('<IIIBBH',payload,off); nm=cstring(strings,s[0])
                if nm.startswith('_'):
                    ensure(nm not in symbols or symbols[nm]==s[1], 'conflicting symbol')
                    symbols[nm]=s[1]
    lo=min(expected); hi=max(expected)+1
    image=bytearray(hi-lo)
    for address,value in expected.items(): image[address-lo]=value
    data=symbols['_envram_data']-symbols['_nvram_data']
    params=symbols['_einstall_parameters']-symbols['_install_parameters']
    ensure(data>=0 and params>0 and symbols['_einstall_parameters']==hi,'invalid data/params layout')
    param_offset=symbols['_install_parameters']-lo
    ensure(param_offset==len(image)-params,'install params not at image tail')
    tlv={}; off=param_offset
    while off<len(image):
        tag=image[off]; off+=1; length=image[off]; off+=1
        if length&128:
            n=length&127; ensure(n in (1,2),'invalid BER length'); ensure(off+n<=len(image),'short BER length')
            length=int.from_bytes(image[off:off+n],'big'); off+=n
            ensure(length >= (128 if n==1 else 256),'noncanonical BER length')
        ensure(tag not in tlv and off+length<=len(image),'bad/duplicate TLV')
        tlv[tag]=bytes(image[off:off+length]);off+=length
    ensure(set(tlv)=={1,2,3,4},'unexpected install tag set')
    ensure(tlv[1].decode()==metadata['app_name'] and tlv[2].decode()==metadata['app_version'],'name/version disagreement')
    ensure(len(tlv[3])>0,'missing icon')
    target=metadata['target']; ids={'nanos2':0x33100004,'nanox':0x33000004,'stax':0x33200004,'flex':0x33300004,'apex_p':0x33400004}
    # Alias recorded by this SDK uses nanosplus, rather than build-system nanos2, on some versions.
    ids['nanosplus']=0x33100004
    ensure(target in ids and int(metadata['target_id'],0)==ids[target],'wrong device/target ID')
    flags=int(metadata['app_flags'],0); ensure(flags==(0 if target in ('nanos2','nanosplus') else 0x200),'unexpected app flags')
    ensure(int(metadata['api_level'])==27,'unexpected API level')
    names={'Pearl Dev':'mainnet','Pearl Test Dev':'testnet','Pearl Test2 Dev':'testnet2','Pearl Reg Dev':'regtest','Pearl Sim Dev':'simnet'}
    ensure(metadata['app_name'] in names,'unexpected app name')
    network=names[metadata['app_name']]; coin=808276 if network=='mainnet' else 1
    ensure(tlv[4]==bytes([1,2])+struct.pack('>II',0x80000056,0x80000000|coin),'unexpected curve/path permissions')
    boot=(e[4]-lo)|1; ensure(0<=boot<len(image),'invalid boot offset')
    create=struct.pack('>BIIIII',27,len(image)-data-params,data,params,flags,boot)
    digest=hashlib.sha256(struct.pack('>I',ids[target])+create+image).hexdigest()
    return dict(raw=b,metadata=metadata,expected=expected,image=bytes(image),lo=lo,hi=hi,create=create,target=ids[target],network=network,flags=flags,params=params,hash=digest)

def verify(elf, apdu):
    info=elf_info(elf); raw=pathlib.Path(apdu).read_bytes(); lines=raw.splitlines(); ensure(lines,'empty script')
    commands=[]
    for line in lines:
        ensure(line and line.strip()==line and len(line)%2==0,'noncanonical script line')
        command=bytes.fromhex(line.decode('ascii'))
        ensure(len(command)>=6 and command[4]==len(command)-5,'APDU length mismatch')
        ensure(command[:4] in (b'\xe0\x00\x00\x00',b'\xe0\x04\x00\x00'),'unexpected APDU header')
        commands.append(command)
    cursor=0
    if commands[0][1]==4:
        ensure(commands[0][5:]==struct.pack('>I',info['target']),'target mismatch');cursor+=1
    ensure(commands[cursor][:5]==bytes([0xe0,0,0,0,22]) and commands[cursor][5:]==b'\x0b'+info['create'],'createApp mismatch');cursor+=1
    writes={}; segment=None; segdata=bytearray(); flushed=False; crcs=0
    while cursor<len(commands):
        c=commands[cursor];cursor+=1;ensure(c[1]==0,'late target command');d=c[5:];op=d[0]
        if op==5:
            ensure(len(d)==5 and segment is None,'bad segment select/order');segment=int.from_bytes(d[1:],'big');segdata=bytearray();flushed=False
            ensure(segment<len(info['image']),'segment outside image')
        elif op==6:
            ensure(segment is not None and not flushed and len(d)>3,'bad load/order')
            off=int.from_bytes(d[1:3],'big');ensure(off==len(segdata),'noncontiguous chunk')
            ensure(segment+off+len(d)-3<=len(info['image']),'write beyond image')
            for i,v in enumerate(d[3:]):
                absolute=info['lo']+segment+off+i;ensure(absolute not in writes,'duplicate/overlapping write');writes[absolute]=v
            segdata.extend(d[3:])
        elif op==7:
            ensure(d==b'\x07' and segment is not None and segdata and not flushed,'bad flush');flushed=True
        elif op==8:
            ensure(len(d)==9 and segment is not None and flushed,'bad CRC/order')
            off,length,crc=struct.unpack('>HIH',d[1:]);ensure(off==0 and length==len(segdata),'CRC bounds mismatch')
            ensure(crc==binascii.crc_hqx(segdata,0xffff),'CRC mismatch');segment=None;crcs+=1
        elif op==9:
            ensure(d==b'\x09' and segment is None and cursor==len(commands),'bad/trailing commit');break
        else: raise ValueError('forbidden command '+hex(op))
    else: raise ValueError('missing final commit')
    ensure(writes and crcs,'no writes/CRCs')
    ensure(all(writes.get(a)==v for a,v in info['expected'].items()),'ELF loaded bytes mismatch/missing')
    ensure(all(a in info['expected'] or v==0 for a,v in writes.items()),'nonzero gap write')
    replay=bytearray(len(info['image']))
    for a,v in writes.items(): replay[a-info['lo']]=v
    ensure(bytes(replay)==info['image'],'zero-padded image mismatch')
    digest=hashlib.sha256(struct.pack('>I',info['target'])+commands[(1 if commands[0][1]==4 else 0)][6:]+replay).hexdigest()
    ensure(digest==info['hash'],'replayed device hash mismatch')
    return dict(elf=str(elf),apdu=str(apdu),elfSha256=hashlib.sha256(info['raw']).hexdigest(),apduSha256=hashlib.sha256(raw).hexdigest(),appHash=digest,target=info['metadata']['target'],targetId=hex(info['target']),apiLevel=27,flags=hex(info['flags']),network=info['network'],appName=info['metadata']['app_name'],imageBytes=len(replay),writtenBytes=len(writes),implicitZeroGapBytes=len(replay)-len(writes),installParamsBytes=info['params'],commands=len(commands),crcSegments=crcs,status='PASS: exact ELF image and strict command grammar independently reconstructed')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('elf');p.add_argument('apdu');a=p.parse_args()
    print(json.dumps(verify(a.elf,a.apdu),indent=2))
