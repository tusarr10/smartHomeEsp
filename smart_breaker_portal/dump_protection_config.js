const fs = require('fs');
const content = fs.readFileSync('D:/ai/Homeautomation_server/example/data/A96CC3BEEB77E6C12E6A49489880332D/Resources/1.2.10_6Atwjeh5s6G8NERj/main.js', 'utf8');

const idx = content.indexOf('eg=function');
console.log('--- eg=function match ---');
console.log(content.slice(idx, idx + 800));
