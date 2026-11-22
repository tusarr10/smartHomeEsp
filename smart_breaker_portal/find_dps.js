const fs = require('fs');
const content = fs.readFileSync('D:/ai/Homeautomation_server/example/data/A96CC3BEEB77E6C12E6A49489880332D/Resources/1.2.10_6Atwjeh5s6G8NERj/main.js', 'utf8');

const keys = ['over_vol', 'over_vol_protect_time', 'over_vol_recovery_time', 'temp_value', 'alarm_set_2', 'alarm_set_1'];

for (const k of keys) {
  console.log(`\n=================== KEY: ${k} ===================`);
  let idx = 0;
  while ((idx = content.indexOf(k, idx + 1)) !== -1) {
    const chunk = content.slice(Math.max(0, idx - 100), Math.min(content.length, idx + 300));
    console.log(`--- [idx: ${idx}] ---`);
    console.log(chunk);
    if (chunk.includes('dpId')) break;
  }
}
