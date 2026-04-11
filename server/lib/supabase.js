const { createClient } = require('@supabase/supabase-js');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'found' : 'MISSING');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
module.exports = supabase;