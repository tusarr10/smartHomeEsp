
import sys
sys.stdout.reconfigure(encoding='utf-8')
with open('esp8266_4mb/src/web_server.cpp', 'r', encoding='utf-8') as f:
    lines = f.readlines()
for idx, l in enumerate(lines):
    if '/api/ota/upload' in l:
        print('esp8266_4mb:', ''.join(lines[idx:idx+35]))
        break
with open('esp01_1mb/src/web_server.cpp', 'r', encoding='utf-8') as f:
    lines = f.readlines()
for idx, l in enumerate(lines):
    if '/api/ota/upload' in l:
        print('esp01_1mb:', ''.join(lines[idx:idx+35]))
        break
