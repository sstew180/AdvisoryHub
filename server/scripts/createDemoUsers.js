// server/scripts/createDemoUsers.js
// Run from repo root: node server/scripts/createDemoUsers.js
// Requires server/.env to be present with SUPABASE_URL and SUPABASE_SERVICE_KEY

require('dotenv').config({ path: __dirname + '/../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const DEMO_USERS = [
  {
    email: 'riskuser@demo.advisoryhub.app',
    password: 'AdvisoryHub2026!',
    first_name: 'Alex',
    last_name: 'Morgan',
    organisation: 'City of Gold Coast',
    access_tier: 'standard',
    role: 'Manager Risk and Insurance',
    service_area: 'Corporate Governance',
    goals: 'Leading the enterprise risk management framework review for Q3 2026 ARC endorsement. Developing a new risk appetite statement linked to strategic objectives. Building capability across the organisation in risk identification and treatment.',
    preferences: 'You prefer direct, evidence-based responses. Lead with the recommendation. No bullet points by default. Flag assumptions explicitly. Cite QAO guidance where relevant.',
    working_style: 'You work at pace and need answers you can act on immediately. You are a specialist in risk management and do not need frameworks explained. You value challenge and adversarial review.',
  },
  {
    email: 'contractsuser@demo.advisoryhub.app',
    password: 'AdvisoryHub2026!',
    first_name: 'Jordan',
    last_name: 'Clarke',
    organisation: 'City of Gold Coast',
    access_tier: 'standard',
    role: 'Senior Contracts Officer',
    service_area: 'Procurement and Contract Management',
    goals: 'Managing a portfolio of high-value contracts across infrastructure and professional services. Implementing the new contract management framework. Preparing for an internal audit of contract management practices.',
    preferences: 'You prefer structured, practical responses. Use headings where appropriate. Flag legal boundaries explicitly. Cite Queensland procurement policy where relevant.',
    working_style: 'You work methodically and want thorough responses. You have solid working knowledge of contract management but are not a legal specialist. You want the AI to flag when legal review is needed.',
  },
  {
    email: 'baseuser@demo.advisoryhub.app',
    password: 'AdvisoryHub2026!',
    first_name: 'Sam',
    last_name: 'Nguyen',
    organisation: 'City of Gold Coast',
    access_tier: 'standard',
    role: 'Project Manager',
    service_area: 'City Infrastructure',
    goals: 'Delivering a major capital works project on time and on budget. Managing project risk and reporting to the executive. Preparing briefing notes for the Director and CEO.',
    preferences: 'You prefer plain English responses. Lead with the answer. Keep it concise -- you are a generalist, not a specialist. No jargon.',
    working_style: 'You work across multiple domains and need quick, clear answers. You are not a risk or audit specialist but need to comply with governance requirements. You appreciate when the AI keeps things practical.',
  },
];

async function createDemoUsers() {
  console.log('Creating demo users...\n');

  for (const user of DEMO_USERS) {
    console.log(`Creating ${user.email}...`);

    // 1. Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
    });

    if (authError) {
      console.error(`  Auth error: ${authError.message}`);
      continue;
    }

    const userId = authData.user.id;
    console.log(`  Created auth user: ${userId}`);

    // 2. Update profile
    const { error: profileError } = await supabase.from('profiles').update({
      first_name: user.first_name,
      last_name: user.last_name,
      organisation: user.organisation,
      access_tier: user.access_tier,
      theme: 'light',
    }).eq('id', userId);

    if (profileError) {
      console.error(`  Profile error: ${profileError.message}`);
    } else {
      console.log(`  Profile updated`);
    }

    // 3. Get base modules and create personas
    const { data: modules } = await supabase.from('modules').select('id, name');
    if (modules && modules.length > 0) {
      for (const module of modules) {
        const { error: personaError } = await supabase.from('personas').upsert({
          user_id: userId,
          module_id: module.id,
          role: user.role,
          service_area: user.service_area,
          goals: user.goals,
          preferences: user.preferences,
          working_style: user.working_style,
          high_scrutiny: false,
        }, { onConflict: 'user_id,module_id' });

        if (personaError) {
          console.error(`  Persona error (${module.name}): ${personaError.message}`);
        }
      }
      console.log(`  Personas created for ${modules.length} module(s)`);

      // 4. Licence all base modules
      for (const module of modules) {
        const { error: licenceError } = await supabase.from('user_modules').upsert({
          user_id: userId,
          module_id: module.id,
        }, { onConflict: 'user_id,module_id' });

        if (licenceError) {
          console.error(`  Licence error (${module.name}): ${licenceError.message}`);
        }
      }
      console.log(`  Modules licenced`);
    }

    console.log(`  Done: ${user.first_name} ${user.last_name} (${user.email})\n`);
  }

  console.log('All demo users created.');
  console.log('\nLogin credentials:');
  DEMO_USERS.forEach(u => {
    console.log(`  ${u.email} / ${u.password}`);
  });
}

createDemoUsers().catch(console.error);
