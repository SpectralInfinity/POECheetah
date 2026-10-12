import struct
"""Research helpers for poe.ninja build data (2026-10-12); see design doc §3.11.
Not used by the app. Session 7b reimplements this in TypeScript."""
def varint(b,i):
    r=s=0
    while True:
        c=b[i]; i+=1; r|=(c&0x7f)<<s; s+=7
        if c<0x80: return r,i
def parse(b):
    i=0; out=[]
    while i<len(b):
        k,i=varint(b,i); f,w=k>>3,k&7
        if w==0: v,i=varint(b,i)
        elif w==2:
            n,i=varint(b,i); v=b[i:i+n]; i+=n
        elif w==1: v=b[i:i+8]; i+=8
        elif w==5: v=b[i:i+4]; i+=4
        else: raise ValueError(w)
        out.append((f,w,v))
    return out
def show(b,depth=0,maxd=4,limit=12):
    try: fs=parse(b)
    except Exception: return False
    for n,(f,w,v) in enumerate(fs[:limit]):
        if w==2:
            try: s=v.decode('utf-8'); ok=s.isprintable() and len(s)>0
            except: ok=False
            if ok and not (depth<maxd and len(v)>2 and parse_ok(v) and not s.isalpha()):
                print('  '*depth+f'{f}: "{s[:60]}"'); continue
            print('  '*depth+f'{f}: <{len(v)}b>')
            if depth<maxd: show(v,depth+1,maxd,limit)
        else: print('  '*depth+f'{f}: {v if w==0 else v.hex()}')
    if len(fs)>limit: print('  '*depth+f'... {len(fs)} fields')
    return True
def parse_ok(v):
    try: parse(v); return True
    except Exception: return False

def load(path):
    """poe.ninja build dictionary (NDIC v2): 36-byte header (count at 12, sparse
    index size at 28), the sparse index (8 bytes per entry), one length byte per
    name, then the names concatenated."""
    b = open(path, 'rb').read()
    assert b[:4] == b'NDIC'
    count = struct.unpack_from('<I', b, 12)[0]
    nindex = struct.unpack_from('<I', b, 28)[0]
    start = 36 + 8 * nindex
    lens = b[start:start + count]
    names, i = [], start + count
    for n in lens:
        names.append(b[i:i + n].decode('utf-8', 'replace')); i += n
    if i != len(b):
        raise ValueError('layout not recognised')
    return names
