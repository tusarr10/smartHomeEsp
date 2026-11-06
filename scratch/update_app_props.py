with open('central_server_js/public/assets/app.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('const devices = data.devices || [];', 'const devices = data.devices || data.nodes || [];')
text = text.replace('${data.durationMs}ms', '${data.durationMs ? data.durationMs + "ms" : ""}')
text = text.replace('d.protected ?', '(d.protected || d.isProtected) ?')
text = text.replace("escapeHtml(d.firmware || '1.0')", "escapeHtml(d.firmwareVersion || d.firmware || '1.0')")

with open('central_server_js/public/assets/app.js', 'w', encoding='utf-8') as f:
    f.write(text)

print('app.js updated successfully!')
