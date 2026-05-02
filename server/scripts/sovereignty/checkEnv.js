require('dotenv').config();
const id = process.env.AWS_ACCESS_KEY_ID;
const s = process.env.AWS_SECRET_ACCESS_KEY;
const r = process.env.AWS_REGION;

console.log('AWS_REGION:', r || 'MISSING');
console.log('AWS_ACCESS_KEY_ID length:', id ? id.length : 'MISSING');
console.log('AWS_ACCESS_KEY_ID first 4:', id ? id.slice(0, 4) : '');
console.log('AWS_SECRET_ACCESS_KEY length:', s ? s.length : 'MISSING');
console.log('AWS_SECRET_ACCESS_KEY first 4:', s ? s.slice(0, 4) : '');
console.log('AWS_SECRET_ACCESS_KEY last 4:', s ? s.slice(-4) : '');
console.log('AWS_SECRET_ACCESS_KEY has whitespace:', s ? /\s/.test(s) : 'n/a');
console.log('AWS_SECRET_ACCESS_KEY has quotes:', s ? (s.includes('"') || s.includes("'")) : 'n/a');
