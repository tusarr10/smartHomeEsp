import glob, re

target = r'D:\ai\Homeautomation_server\example\data\A96CC3BEEB77E6C12E6A49489880332D\Resources\1.2.10_6Atwjeh5s6G8NERj'
for p in glob.glob(f'{target}\\*.js'):
    with open(p, 'r', encoding='utf-8', errors='ignore') as f:
        txt = f.read()
    matches = re.findall(r'.{0,30}(?:dp_id[\'\"]?:\s*[\'\"]?132[\'\"]?|["\']132["\']|leakage).{0,50}', txt)
    if matches:
        print(p, 'Found:', len(matches))
        for m in matches[:6]:
            print('  ->', repr(m.strip()))
