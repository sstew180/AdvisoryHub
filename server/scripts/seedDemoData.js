/**
 * AdvisoryHub Demo Data Seeding Script
 * 
 * Creates sessions, messages, and memories for the three demo users.
 * Also creates projects and uploads project documents for each user.
 * 
 * Usage:
 *   node server/scripts/seedDemoData.js
 *   node server/scripts/seedDemoData.js --user alex
 *   node server/scripts/seedDemoData.js --user jordan
 *   node server/scripts/seedDemoData.js --user sam
 *   node server/scripts/seedDemoData.js --reset  (deletes existing demo data first)
 * 
 * Demo users (must already exist in Supabase auth):
 *   alex:   riskuser@demo.advisoryhub.app
 *   jordan: contractsuser@demo.advisoryhub.app
 *   sam:    baseuser@demo.advisoryhub.app
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const USER_FILTER = (() => {
  const idx = process.argv.indexOf('--user');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const RESET = process.argv.includes('--reset');

// ─── Known demo user IDs ──────────────────────────────────────────────────────
// Update these if users are recreated
const DEMO_USERS = {
  alex: {
    email: 'riskuser@demo.advisoryhub.app',
    name: 'Alex Morgan',
    id: null, // resolved at runtime
  },
  jordan: {
    email: 'contractsuser@demo.advisoryhub.app',
    name: 'Jordan Clarke',
    id: null,
  },
  sam: {
    email: 'baseuser@demo.advisoryhub.app',
    name: 'Sam Nguyen',
    id: null,
  },
};

// ─── Embedding helper ─────────────────────────────────────────────────────────
async function embed(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000),
  });
  return response.data[0].embedding;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Resolve user IDs ─────────────────────────────────────────────────────────
async function resolveUserIds() {
  console.log('🔍 Resolving demo user IDs...');
  for (const [key, user] of Object.entries(DEMO_USERS)) {
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) throw new Error(`Failed to list users: ${error.message}`);
    const found = data.users.find(u => u.email === user.email);
    if (!found) throw new Error(`Demo user not found: ${user.email}. Run createDemoUsers.js first.`);
    DEMO_USERS[key].id = found.id;
    console.log(`  ✓ ${user.name}: ${found.id}`);
  }
}

// ─── Reset demo data ──────────────────────────────────────────────────────────
async function resetDemoData(userId) {
  console.log(`  🗑  Resetting data for user ${userId}...`);
  // Delete sessions (cascades to messages, embeddings)
  await supabase.from('sessions').delete().eq('user_id', userId);
  // Delete projects (cascades to documents)
  await supabase.from('projects').delete().eq('user_id', userId);
  console.log(`  ✓ Reset complete`);
}

// ─── Fix module assignments ───────────────────────────────────────────────────
// Ensures each demo user has exactly one correct module assigned.
// Runs during every seed so repeated runs don't accumulate wrong modules.
async function fixModules() {
  console.log('\n🔧 Fixing module assignments...');

  // Fetch all modules
  const { data: allModules, error } = await supabase.from('modules').select('id, name');
  if (error) { console.warn('  ⚠  Could not fetch modules -- skipping module fix'); return; }

  const moduleByName = {};
  allModules.forEach(m => { moduleByName[m.name] = m.id; });

  // Expected module per demo user
  const assignments = [
    { key: 'alex',   moduleName: 'Risk & Audit' },
    { key: 'jordan', moduleName: 'Contract Management' },
    { key: 'sam',    moduleName: 'General' },
  ];

  for (const { key, moduleName } of assignments) {
    const user = DEMO_USERS[key];
    if (!user.id) continue;

    const moduleId = moduleByName[moduleName];
    if (!moduleId) {
      console.warn(`  ⚠  Module "${moduleName}" not found -- skipping ${user.name}`);
      continue;
    }

    // Remove all existing module assignments for this user
    await supabase.from('user_modules').delete().eq('user_id', user.id);

    // Assign the correct single module
    const { error: insertError } = await supabase.from('user_modules').insert({
      user_id: user.id,
      module_id: moduleId,
    });

    if (insertError) {
      console.warn(`  ⚠  Failed to assign ${moduleName} to ${user.name}: ${insertError.message}`);
    } else {
      console.log(`  ✓ ${user.name} → ${moduleName}`);
    }

    // Also update last_active_module on profile so they land on the right module
    await supabase.from('profiles').update({ last_active_module: moduleId }).eq('id', user.id);
  }
}

// ─── Create project ───────────────────────────────────────────────────────────
async function createProject(userId, projectData) {
  const { data, error } = await supabase.from('projects').insert({
    user_id: userId,
    name: projectData.name,
    description: projectData.description,
    objectives: projectData.objectives,
    custom_instructions: projectData.custom_instructions,
    artefact_preference: projectData.artefact_preference || 'briefing note',
    high_scrutiny: projectData.high_scrutiny || false,
  }).select().single();

  if (error) throw new Error(`Failed to create project: ${error.message}`);
  console.log(`  ✓ Project created: "${projectData.name}" (${data.id})`);
  return data;
}

// ─── Upload project document ──────────────────────────────────────────────────
async function uploadProjectDocument(projectId, userId, filePath) {
  const filename = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');

  if (content.trim().length < 50) {
    console.log(`  ⚠  Skipping ${filename} (insufficient content)`);
    return;
  }

  const embedding = await embed(content);
  await sleep(500);

  const title = path.basename(filePath, path.extname(filePath));
  const { error } = await supabase.from('library_documents').insert({
    title,
    category: 'Project',
    domain: 'General',
    jurisdiction: 'Queensland',
    project_id: projectId,
    user_id: userId,
    content: content.slice(0, 50000),
    embedding,
    is_admin_managed: false,
    default_enabled: false,
  });

  if (error) throw new Error(`Failed to upload document ${filename}: ${error.message}`);
  console.log(`  ✓ Document uploaded: ${filename}`);
}

// ─── Create session with messages ────────────────────────────────────────────
async function createSession(userId, projectId, sessionData) {
  // Create session
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      project_id: projectId,
      title: sessionData.title,
      summary: sessionData.summary,
    })
    .select()
    .single();

  if (sessionError) throw new Error(`Failed to create session: ${sessionError.message}`);

  // Create messages
  for (const msg of sessionData.messages) {
    const { error: msgError } = await supabase.from('messages').insert({
      session_id: session.id,
      role: msg.role,
      content: msg.content,
    });
    if (msgError) throw new Error(`Failed to create message: ${msgError.message}`);
  }

  // Create session embedding from summary
  if (sessionData.summary) {
    const embedding = await embed(sessionData.summary);
    await sleep(500);
    await supabase.from('session_embeddings').insert({
      session_id: session.id,
      user_id: userId,
      content: sessionData.summary,
      embedding,
    });
  }

  console.log(`  ✓ Session created: "${sessionData.title}"`);
  return session;
}

// ─── ALEX MORGAN -- Risk & Insurance ─────────────────────────────────────────
async function seedAlex() {
  const user = DEMO_USERS.alex;
  console.log(`\n👤 Seeding Alex Morgan (${user.email})...`);

  if (RESET) await resetDemoData(user.id);

  // Project: Enterprise Risk Framework Review
  const project = await createProject(user.id, {
    name: 'Enterprise Risk Framework Review',
    description: 'Review and update the Enterprise Risk Management Framework in response to three Significant QAO findings. Engaging external consultant Meridian Risk Advisory.',
    objectives: 'Deliver updated ERM framework, risk appetite statement, and ARC reporting template by June 2026. Address all three QAO management letter findings. Embed updated framework across all 12 business units.',
    custom_instructions: 'This project has a firm deadline driven by the QAO audit cycle. The ARC must endorse the updated framework at the August 2026 meeting. All outputs must meet ISO 31000:2018 and QAO better practice standards. Responses should reference the three Significant QAO findings where relevant.',
    artefact_preference: 'briefing note',
    high_scrutiny: true,
  });

  // Upload project documents
  const docDir = path.join(__dirname, '../../demo/alex');
  if (fs.existsSync(docDir)) {
    const files = fs.readdirSync(docDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      await uploadProjectDocument(project.id, user.id, path.join(docDir, file));
    }
  } else {
    console.log(`  ⚠  Demo docs not found at ${docDir} -- skipping document upload`);
  }

  // Sessions
  await createSession(user.id, project.id, {
    title: 'QAO findings -- what do we need to do?',
    summary: 'Alex reviewed the three Significant QAO findings on risk management and discussed the implications for the ERM Framework Review. Key priorities identified: update risk appetite statement, redesign ARC reporting, address capability gaps in 3 business units. Olympic Games Delivery unit identified as critical gap.',
    messages: [
      {
        role: 'user',
        content: 'I have just received the QAO management letter and we have three Significant findings on risk management. Can you help me understand what these mean and what I need to do?',
      },
      {
        role: 'assistant',
        content: `Three Significant findings is a serious result -- that is the QAO's highest rating, and it means the issues are material enough to warrant specific management attention and a formal response. Let me work through what each finding means and the priority actions.\n\n**Finding 4.1 -- Risk Appetite Statement Not Current**\nThis is foundational. If the risk appetite statement is from 2021, it predates the Olympic Games program, the Digital Transformation Strategy, and the post-COVID risk profile changes. Six of your twelve business units cannot demonstrate how their registers align to it. The practical implication is that risk decisions across the organisation are being made without a consistent standard. Priority action: update the RAS as the first deliverable in the ERM review, not the last.\n\n**Finding 4.2 -- ARC Reporting Lacks Operational Detail**\nThe ARC is receiving a report that only covers treatment status for 38% of strategic risks. That means your Committee is making oversight decisions with incomplete information. This is also the quickest win -- you can redesign the reporting template without waiting for the full framework review. The QAO is expecting to see the redesigned report from the February 2026 ARC meeting.\n\n**Finding 4.3 -- Inconsistent Capability Across Business Units**\nThis is the systemic issue. Three units without risk champions, inconsistent methodology, infrequent workshops. This won't be fixed by updating a document -- it requires a genuine capability program.\n\n**What you need to do, in priority order:**\n1. Respond formally to each finding with specific commitments and dates -- this is due to the QAO within 30 days of the management letter\n2. Brief your CEO and ARC Chair on the findings before they see the letter\n3. Redesign the ARC report immediately (can be done ahead of the full framework review)\n4. Appoint risk champions in the three business units that don't have them -- Olympic Games Delivery is the most urgent\n5. Commission the full ERM Framework Review with a clear scope and timeline\n\nWould you like help drafting the management response to the QAO, or would it be more useful to start with the ARC Chair briefing note?`,
      },
      {
        role: 'user',
        content: 'Let us start with the briefing note for the ARC Chair. She will want to know the headline findings and what we are doing about it.',
      },
      {
        role: 'assistant',
        content: `Here is a draft briefing note for the ARC Chair:\n\n---\n\n**BRIEFING NOTE -- CONFIDENTIAL**\n\n**To:** Chair, Audit and Risk Committee\n**From:** Manager Risk and Insurance\n**Date:** [Date]\n**Subject:** QAO Management Letter -- Risk Management Findings\n\n**Purpose**\nThis note summarises three Significant findings in the QAO management letter relating to risk management and outlines management's response.\n\n**Summary of findings**\nThe QAO has rated three risk management findings as Significant -- the highest rating in their scale. The findings are: (1) the risk appetite statement has not been updated since 2021 and does not reflect the current operating environment; (2) the quarterly ARC risk report does not provide sufficient information for the Committee to exercise effective oversight; and (3) risk management capability is inconsistent across business units, with three units having no designated risk champion.\n\n**Management response**\nManagement has committed to addressing all three findings through an Enterprise Risk Framework Review commencing February 2026, with the updated framework to be presented to the ARC for endorsement at the August 2026 meeting. A redesigned ARC risk report will be implemented from the February 2026 meeting, addressing Finding 4.2 ahead of the broader review.\n\n**Action requested**\nThe Chair is asked to note these findings and management's response. Management recommends the ARC receive a verbal update on the ERM Review progress at each quarterly meeting.\n\n**Contact:** [Your name and number]\n\n---\n\nI have kept this factual and direct -- the Chair will appreciate knowing the headline before seeing the full letter. Do you want me to adjust the tone or add any detail on the Olympic Games Delivery gap, which is arguably the most urgent issue in Finding 4.3?`,
      },
    ],
  });

  await createSession(user.id, project.id, {
    title: 'Consultant selection -- Meridian Risk Advisory',
    summary: 'Alex discussed the RFQ process for the ERM framework consultant. Three proposals received. Meridian Risk Advisory selected based on methodology (36/40), experience (28/30), and key personnel scores. Fixed fee $85,000. Contract executed 3 February 2026.',
    messages: [
      {
        role: 'user',
        content: 'We have received three proposals for the ERM framework review consultant. Can you help me structure the evaluation?',
      },
      {
        role: 'assistant',
        content: `For a professional services evaluation of this type, I would recommend a weighted criteria model rather than just price comparison. Given the sensitivity of the QAO context and the need for credible outputs, quality and experience should carry more weight than price.\n\nSuggested weighting:\n- Relevant experience (local government ERM, QAO context): 30%\n- Proposed methodology (how they will approach the review): 40%\n- Key personnel qualifications and availability: 20%\n- Fee: 10%\n\nThe methodology weighting is deliberately high because the QAO will scrutinise the outputs. You need a consultant who understands the ISO 31000:2018 framework and can translate it into a local government context -- not just a generic risk consulting approach.\n\nFor the evaluation, I would suggest a panel of three: yourself as contract manager, the Director Corporate Services as sponsor, and an independent technical reviewer if you can source one. All panel members should score independently before any discussion.\n\nWould you like help with the scoring guide for each criterion, or with drafting the evaluation report once scores are in?`,
      },
    ],
  });

  await createSession(user.id, null, {
    title: 'Preparing for the ARC meeting -- risk reporting',
    summary: 'Alex discussed improvements to the ARC risk report template in response to QAO Finding 4.2. Agreed to add treatment status for all High and Extreme risks, emerging risks section, trend indicators, and overall risk profile movement indicator.',
    messages: [
      {
        role: 'user',
        content: 'The QAO said our ARC risk report only meets 4 of 9 better practice criteria. What are the 9 criteria and what does a better practice risk report look like?',
      },
      {
        role: 'assistant',
        content: `The QAO's better practice standard for risk reporting to governance bodies covers nine criteria. Based on the findings, your current report meets four of them -- likely the basics (risk list, ratings, ownership). Here is the full picture:\n\n**Criteria your report likely meets:**\n1. Strategic risks are listed with descriptions\n2. Risk ratings (likelihood/consequence) are provided\n3. Risk owners are identified\n4. High-level risk categories are used\n\n**Criteria you likely need to add:**\n5. Treatment status for all High and Extreme risks (you currently cover 38%)\n6. Emerging risks section -- new or escalating risks identified since last report\n7. Trend indicator for each risk -- is it improving, stable, or deteriorating?\n8. Overall risk profile indicator -- is the organisation's risk exposure increasing or decreasing quarter-on-quarter?\n9. Commentary on risks that have exceeded tolerance or where treatment is overdue\n\nA better practice risk report is typically structured as: (1) executive summary with overall risk profile movement; (2) risks by category with trend indicators; (3) all High/Extreme risks with full treatment status; (4) emerging risks; (5) risks where treatment is overdue or tolerance exceeded.\n\nThe trend indicators are the most visible improvement you can make quickly -- a simple up/down/stable arrow next to each risk rating tells the ARC a great deal at a glance. Would you like me to help design a revised template?`,
      },
    ],
  });

  console.log(`✅ Alex Morgan seeding complete`);
}

// ─── JORDAN CLARKE -- Contracts ───────────────────────────────────────────────
async function seedJordan() {
  const user = DEMO_USERS.jordan;
  console.log(`\n👤 Seeding Jordan Clarke (${user.email})...`);

  if (RESET) await resetDemoData(user.id);

  // Project: Facilities Management Retender
  const project = await createProject(user.id, {
    name: 'Facilities Management Services Retender',
    description: 'Retender of the Facilities Management Services contract ($6.5M pa, 47 buildings). Current contract with Ventia expires 30 September 2026. Significant Contract under procurement policy.',
    objectives: 'Execute a competitive open tender process and have a new contract in place by 1 October 2026. Achieve value for money improvement over current contract. Address incumbent performance shortfalls in reactive maintenance and documentation.',
    custom_instructions: 'This is a Significant Contract and must follow the full strategic contracting process including Significant Contracting Plan, independent probity adviser, and Director approval. All outputs must be consistent with the Queensland Procurement Policy 2026 and the organisation\'s Contract Manual. Responses should reference the contracting strategy and incumbent performance review where relevant.',
    artefact_preference: 'briefing note',
    high_scrutiny: false,
  });

  // Upload project documents
  const docDir = path.join(__dirname, '../../demo/jordan');
  if (fs.existsSync(docDir)) {
    const files = fs.readdirSync(docDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      await uploadProjectDocument(project.id, user.id, path.join(docDir, file));
    }
  } else {
    console.log(`  ⚠  Demo docs not found at ${docDir} -- skipping document upload`);
  }

  // Sessions
  await createSession(user.id, project.id, {
    title: 'Contracting strategy -- evaluation criteria',
    summary: 'Jordan discussed the evaluation criteria weighting for the FM retender. Agreed on: Price 30%, Technical capability 25%, Experience 20%, Key personnel 15%, Sustainability 10%. Price weighting lower than standard due to performance concerns with lowest-cost incumbent over contract life.',
    messages: [
      {
        role: 'user',
        content: 'I am setting up the evaluation criteria for the FM retender. Our current contract was awarded to the second cheapest at the time. How should I weight the criteria?',
      },
      {
        role: 'assistant',
        content: `The fact that your current contract went to the second cheapest and has still underperformed is useful context -- it suggests that price alone is not a good predictor of performance at this contract value and complexity.\n\nFor a $6.5M pa facilities management contract covering 47 buildings, I would recommend weighting quality of delivery higher than price. Here is a suggested breakdown:\n\n- **Price: 30%** -- Total cost of ownership over 3 years including optional services. Lower than some organisations use, but appropriate given the performance history.\n- **Technical capability and methodology: 25%** -- How the tenderer will actually deliver the services. This is where you stress-test their after-hours model, which was the incumbent's primary failure point.\n- **Relevant experience: 20%** -- Evidence of similar contracts in scale and complexity. Look for references from comparable organisations, not just volume of work.\n- **Key personnel: 15%** -- The site manager and account manager matter enormously in FM. Qualifications and retention history.\n- **Sustainability and social value: 10%** -- Environmental management, local employment, waste diversion.\n\nThe key to making the technical capability criterion work is specificity in the scoring guide. Define what a strong methodology for after-hours reactive maintenance looks like before you receive tenders -- not after. If you leave it vague, you will get vague responses and it becomes difficult to differentiate.\n\nWould you like help designing the scoring guide for the technical capability criterion, particularly around the after-hours model that has been the persistent issue?`,
      },
      {
        role: 'user',
        content: 'Yes please -- what should I be looking for in a strong tender response on after-hours capability?',
      },
      {
        role: 'assistant',
        content: `A strong tender response on after-hours reactive maintenance capability should demonstrate four things: staffing model, escalation process, subcontractor management, and performance evidence.\n\n**Strong response indicators:**\n- Named after-hours supervisor with contact details and clear authority to deploy resources without further approval\n- Minimum staffing levels for after-hours (e.g. 2 electricians and 2 plumbers on call at all times, not on-call from home)\n- Subcontractor register for specialist trades (hydraulics, fire systems, HVAC) with confirmed response time commitments in writing\n- GPS-tracked fleet with dispatch capability showing average mobilisation time from notification to site\n- Evidence from an existing comparable contract showing actual after-hours response rates (not just contractual commitment)\n- Contingency plan for when primary after-hours resource is unavailable\n\n**Weak response indicators:**\n- General commitment to meeting response times without describing how\n- Reliance on subcontractors without evidence of confirmed availability\n- Performance statistics that are averages rather than showing distribution (an average of 93% can mask many failures at 4:00am on weekends)\n- Key personnel named for after-hours management who are also named as day-shift management (suggests the same person is managing both)\n\n**Scoring guide:**\n- **Strong (4-5):** Specific staffing model, named subcontractors with confirmed commitments, evidence from current comparable contract showing >95% actual performance\n- **Adequate (2-3):** Reasonable methodology described but insufficient evidence, or methodology relies heavily on subcontractors without confirmed commitments\n- **Weak (0-1):** Generic commitments without operational specificity, no performance evidence, or response relies on same-day deployment of day-shift staff\n\nThis scoring guide should go into the evaluation plan before tenders are issued so all panel members are applying the same standard.`,
      },
    ],
  });

  await createSession(user.id, project.id, {
    title: 'Ventia variation claim -- Coomera road widening',
    summary: 'Jordan discussed how to assess and respond to BuildRight\'s $380K latent conditions variation claim on the Coomera road widening project. Recommended engaging QS to assess claim against contract clause 18.3. Negotiation strategy discussed.',
    messages: [
      {
        role: 'user',
        content: 'We have a variation claim for $380,000 on the road widening project. The contractor is claiming latent conditions for rock they encountered. How do I assess this?',
      },
      {
        role: 'assistant',
        content: `A latent conditions claim needs to be assessed against three elements: (1) whether the condition was genuinely unforeseeable based on information available at tender, (2) whether the condition materially differs from what a competent contractor would have anticipated, and (3) whether the claimed cost is substantiated.\n\n**Step 1 -- Review the contract clause**\nYour latent conditions clause (Clause 18.3 in your contract) will define the test for what constitutes a latent condition. Most Australian standard form contracts (AS 4300, AS 2124) require the condition to be one that could not have been anticipated by a competent contractor who had examined the site and the information provided at tender.\n\n**Step 2 -- Review the tender information**\nWhat geotechnical information was provided to tenderers? If a geotechnical report was included in the tender documents and showed potential for rock, the contractor's ability to claim may be limited. If no geotechnical information was provided, their claim is stronger.\n\n**Step 3 -- Engage an independent quantity surveyor**\nFor a $380K claim, you need a QS to: (a) assess whether the rock encountered is genuinely a latent condition under the clause definition, and (b) assess whether the claimed cost is reasonable for the work required. The QS will examine the contractor's daily records, plant logs, and invoices.\n\n**Step 4 -- Separate the claim components**\nYour preliminary assessment suggests $180-220K may be substantiated and $160-200K relates to productivity issues not attributable to the latent condition. The QS assessment should confirm this split. You negotiate based on the substantiated amount, not the claimed amount.\n\n**Step 5 -- Negotiate with a clear mandate**\nBefore you engage in negotiation, get the Director to approve: (a) the QS assessment mandate, (b) the negotiation range (e.g. settle between $180K and $250K), and (c) authority to escalate to formal dispute if settlement cannot be reached.\n\nTimeline: QS assessment 3-4 weeks. Negotiation 2-4 weeks. Target resolution before the project hits its critical path milestones.\n\nWould you like help drafting the Director briefing note seeking approval for the QS engagement?`,
      },
    ],
  });

  await createSession(user.id, null, {
    title: 'Contract KPI framework -- performance at risk regime',
    summary: 'Jordan discussed how to design an effective KPI framework and performance at-risk regime for the new FM contract. Agreed on 5% at-risk monthly, progressive penalties for persistent underperformance, and 2% bonus for sustained high performance.',
    messages: [
      {
        role: 'user',
        content: 'How should I structure the KPI regime and at-risk amounts for the new FM contract to make sure we get better performance than the current contract?',
      },
      {
        role: 'assistant',
        content: `The current contract's KPI regime has generated $412K in at-risk deductions over 4.5 years but has not produced the performance improvement you need -- so the regime is measuring failure but not preventing it. The new regime needs to be redesigned to create genuine incentives for sustained high performance, not just monthly penalty avoidance.\n\n**Key design principles:**\n\n1. **Progressive consequences for persistent underperformance.** A contractor who misses the 4-hour response target at 87% every month and pays the at-risk deduction is simply pricing the non-performance into their margin. Add a provision that if the same KPI is below target for 3 consecutive months, a performance improvement plan is triggered -- and if the PIP is not met within 90 days, it becomes grounds for termination for cause.\n\n2. **At-risk amount that actually hurts.** 5% of monthly management fee is the market standard. Ensure it applies to the whole management fee, not just the component related to the underperforming service.\n\n3. **Bonus for sustained excellence.** A 2% annual bonus for achieving >95% on all KPIs for 12 consecutive months is a meaningful incentive at $6.5M pa ($130K potential bonus). It shifts the psychology from penalty avoidance to performance aspiration.\n\n4. **KPIs that measure outcomes, not activity.** Replace "number of jobs completed" with "percentage of urgent reactive jobs responded to within 4 hours." Replace "PPM schedule adherence" with "percentage of assets with no overdue PPM at month end."\n\n5. **CAFM data quality as a standalone KPI.** Given the incumbent's poor documentation record, add a specific KPI: "percentage of work orders closed with complete asset coding and root cause documentation -- target 95%."\n\nSuggested KPI structure for the new contract:\n- Urgent reactive response (4 hour): 95% target, 3% at-risk\n- Standard reactive response (24 hour): 95% target, 1% at-risk\n- PPM completion: 98% target, 0.5% at-risk\n- CAFM data completeness: 95% target, 0.5% at-risk\n- Cleaning quality audit: 85% target, measured but no at-risk (manage through cleaning audit process)\n- Security incident response: 98% target, measured, escalation trigger rather than at-risk\n\nTotal at-risk: 5% of monthly management fee. Persistent underperformance trigger at 3 months consecutive below target on any KPI.`,
      },
    ],
  });

  console.log(`✅ Jordan Clarke seeding complete`);
}

// ─── SAM NGUYEN -- General Practitioner ──────────────────────────────────────
async function seedSam() {
  const user = DEMO_USERS.sam;
  console.log(`\n👤 Seeding Sam Nguyen (${user.email})...`);

  if (RESET) await resetDemoData(user.id);

  // Project: 2026-27 Business Unit Plan
  const project = await createProject(user.id, {
    name: '2026-27 Business Unit Plan — Transport and Roads',
    description: 'Development of the annual Business Unit Plan for the Transport and Roads Division. $54.5M total budget (operating $31.4M, capital $15.8M). Acting Manager Operations role.',
    objectives: 'Deliver an endorsed Business Unit Plan by 30 June 2026 covering 2026-27. Address the maintenance backlog, improve asset data completeness to 80%, deliver 90% of capital budget, achieve zero LTIs.',
    custom_instructions: 'Sam is acting in the Manager Operations role during the planning process. The plan needs Director endorsement. Key sensitivities: capital underspend history, QAO asset data finding, Olympic Games contractor market pressure. Use practical, operational language appropriate for infrastructure management context.',
    artefact_preference: 'briefing note',
    high_scrutiny: false,
  });

  // Upload project documents
  const docDir = path.join(__dirname, '../../demo/sam');
  if (fs.existsSync(docDir)) {
    const files = fs.readdirSync(docDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      await uploadProjectDocument(project.id, user.id, path.join(docDir, file));
    }
  } else {
    console.log(`  ⚠  Demo docs not found at ${docDir} -- skipping document upload`);
  }

  // Sessions
  await createSession(user.id, project.id, {
    title: 'Business unit plan -- what are the key priorities?',
    summary: 'Sam discussed the key priorities for the 2026-27 Transport and Roads business unit plan. Four priorities identified: reduce maintenance backlog from $12.4M to $10.0M, improve asset data completeness from 62% to 80%, deliver 90% of capital budget (vs 71% in 2025-26), achieve zero LTIs.',
    messages: [
      {
        role: 'user',
        content: 'I am putting together the business unit plan for next year. We have a maintenance backlog problem, a QAO finding on asset data, and we underdelivered on capital last year. Where do I start?',
      },
      {
        role: 'assistant',
        content: `You have three real problems and they are connected. The maintenance backlog grows partly because you cannot deliver the capital renewal program, and the asset data gap means you may not even know which assets are at highest risk. Let me help you frame the priorities in a way that tells a coherent story to the Director.\n\n**Priority 1 -- Backlog reduction (most visible community issue)**\nThe backlog has grown from $9.8M to $12.4M in two years -- that is a 27% increase. Community satisfaction with roads at 58% against a 65% target is a direct consequence. This needs to be the headline priority with a specific target: reduce to $10.0M by 30 June 2027. You will need additional budget allocation to make meaningful progress -- the base program is not keeping pace with deterioration.\n\n**Priority 2 -- Asset data completeness (foundational issue)**\nThe QAO finding at 62% vs 78% sector average is serious because poor asset data drives every other problem: you cannot prioritise the backlog accurately, you cannot justify budget requests robustly, and you cannot demonstrate value for money to the Director or the ARC. A condition assessment program is the fix -- relatively low cost ($380K) for a significant improvement in decision quality.\n\n**Priority 3 -- Capital delivery (credibility issue)**\nDelivering 71% of capital budget two years in a row damages your credibility and results in funds being surrendered. The fix is earlier contractor engagement (Q1 not Q2) and completing designs before October so you can mobilise construction in the dry season. Set a 90% target and show how you will achieve it.\n\n**Priority 4 -- Safety (non-negotiable)**\nTwo LTIs in 2025-26 both involving manual handling. Zero LTI target is right. A manual handling risk assessment for all operational roles and targeted equipment upgrades are the right treatments.\n\nThe plan should lead with these four priorities in this order -- it shows the Director that you understand the strategic context, not just the operational tasks. Want me to help structure the plan document or start with the budget narrative?`,
      },
      {
        role: 'user',
        content: 'The Coomera road widening has a contractor variation claim and the bridge project is stuck because of Ergon Energy. I need to brief the Director. Can you help?',
      },
      {
        role: 'assistant',
        content: `Two issues, two different types of briefing. The variation claim needs a decision briefing -- you need the Director to approve something. The Ergon issue needs an escalation briefing -- you need the Director to act on something.\n\n**Briefing Note -- Coomera Road Widening Variation Claim**\n\nPurpose: Seek Director approval to engage a quantity surveyor to assess BuildRight's $380,000 latent conditions claim and authorise a negotiation mandate.\n\nSituation: BuildRight Civil lodged a variation claim on 22 March for $380,000 relating to unexpected rock at chainage 1.4km. They are claiming under the latent conditions clause (Clause 18.3). Preliminary review suggests $180-220K may be substantiated; the remaining $160-200K appears to relate to contractor productivity issues not attributable to the latent condition.\n\nRecommended position: Engage the organisation's quantity surveyor to provide an independent assessment before negotiation begins. Authorise negotiation within a range of $180K-$250K. If settlement cannot be reached within the range, escalate to formal dispute process.\n\nDecision required: (1) Approve QS engagement (estimated cost $8,000-$12,000); (2) Approve negotiation mandate of $180K-$250K; (3) Approve Jordan Clarke as lead negotiator.\n\nBudget impact: If settled at $200K, a budget amendment of $200K will be required for this project.\n\n---\n\n**Briefing Note -- Bridge Renewal Ergon Energy Utility Conflict**\n\nPurpose: Seek Director escalation to Ergon Energy to unblock the Bridge 2 project.\n\nSituation: Survey work identified an Ergon Energy cable through the Bridge 2 structure at a depth inconsistent with as-built records. Construction cannot proceed. Ergon was notified 14 February. They have acknowledged the issue but have not committed to a resolution timeline. Their current estimate is 8-12 weeks from design confirmation -- which means earliest construction start is June 2026, putting full-year completion at risk.\n\nRecommended position: Director to contact Ergon Energy's General Manager directly to request a committed resolution timeline by 21 April. Legal team to advise on cost recovery for additional design costs under the road occupancy agreement.\n\nDecision required: (1) Director to make direct contact with Ergon GM; (2) Legal team engagement for cost recovery assessment.\n\nBudget impact: Additional design and potential cable protection works estimated $45K-$95K. May be recoverable from Ergon.\n\n---\n\nShall I turn these into full briefing notes with the standard header and formatting?`,
      },
    ],
  });

  await createSession(user.id, project.id, {
    title: 'Capital program -- why are we underspending?',
    summary: 'Sam discussed the root causes of the capital underspend (71% delivery in 2025-26) and identified three structural causes: late contractor engagement (Q2 rather than Q1), design not completed before construction season, and two specific project delays (Ergon conflict, design issue). Agreed on actions to improve to 90% in 2026-27.',
    messages: [
      {
        role: 'user',
        content: 'The Director is asking why we only delivered 71% of the capital budget again. How do I explain this without it just sounding like excuses?',
      },
      {
        role: 'assistant',
        content: `The key to a credible explanation is separating the structural causes from the one-off events -- and being honest about which is which. If the Director hears only one-off explanations for a repeated pattern, they will not believe it is being fixed.\n\n**Structural causes (the real problem):**\n\n1. **Late contractor engagement.** If you are going to market for construction contractors in Q2 (October-December), you are competing with every other organisation's wet-season program. The best contractors are already committed. Fix: go to market in Q1 (July-September) for the following financial year's program.\n\n2. **Designs not completed before construction season.** If design is still being finalised in October when you should be mobilising, the program slips into the wet season and you lose months. Fix: all designs for the following year's capital program to be completed by October of the current year.\n\n**Specific project delays (this year's contributing factors):**\n\n1. Bridge 2 -- Ergon Energy utility conflict discovered post-survey. Construction start pushed from April to June at earliest. $600K at risk of carryforward.\n\n2. Drainage Helensvale -- design delay of 6 weeks due to consultant resourcing. Construction start pushed from March to June. $800K expected carryforward.\n\n**How to frame this for the Director:**\n\n"The 71% delivery reflects two structural issues and two specific project delays. We have addressed the structural issues in the 2026-27 plan -- contractor engagement will move to Q1 and all designs will be complete by October. The two project delays account for $1.4M of the $4.6M underspend. The remaining $3.2M reflects the structural lag that the Q1 engagement change will fix. We are forecasting 90% delivery in 2026-27 based on these changes."\n\nThis is honest, specific, and shows a credible fix rather than a repeat promise. The Director needs to see that you understand the cause, not just the symptom. Would you like help drafting the capital delivery section of the business unit plan with this framing?`,
      },
    ],
  });

  await createSession(user.id, null, {
    title: 'How do I manage the Olympic Games contractor crunch?',
    summary: 'Sam discussed the Extreme risk of Olympic Games construction competing for civil contractor capacity. Identified three mitigation strategies: standing offer arrangements for routine maintenance, early engagement for capital contracts, and a contingency scope reduction plan if market capacity is constrained.',
    messages: [
      {
        role: 'user',
        content: 'I am worried about not being able to get contractors for next year because of the Olympics construction program. What should I do?',
      },
      {
        role: 'assistant',
        content: `This is a legitimate Extreme risk and the right time to act on it is now, before the Olympic program ramps up further. The civil contractor market in southeast Queensland is already tightening and will get significantly worse through 2027-2028.\n\nThree strategies, in order of priority:\n\n**1. Lock in standing offer arrangements for routine maintenance now.**\nFor your $18.3M in contracted services, the highest-volume routine work (road maintenance, drainage cleaning, pathway repairs) should be covered by standing offer arrangements with confirmed pricing and capacity commitments. If your current arrangements expire in 2026, renew them early -- before the market tightens further. Standing offers with 3-year terms and annual CPI adjustment will give contractors certainty and you capacity.\n\n**2. Go to market for 2026-27 capital contracts in July-August 2026.**\nThis is the Q1 engagement change that addresses the structural underspend issue and also gets you in front of the contractor market before they commit to Olympic work. For your $15.8M capital program, identify the 3-4 largest projects and approach the market for early pricing or expressions of interest. Frame it as early market engagement -- not a tender -- so you are not creating procurement obligations but are building relationships and understanding capacity.\n\n**3. Prepare a scope reduction contingency plan.**\nIdentify which capital projects can be deferred without significant service impact if you cannot secure competitive pricing. Categorise your program into: must-deliver (safety-critical, regulatory), should-deliver (backlog reduction priority), and can-defer (nice-to-have). If contractor pricing comes in 20% above budget, you have a pre-approved scope reduction rather than a budget emergency.\n\nThe Director needs to know about this risk formally -- it should be rated Extreme in your risk register with these treatments documented. An Extreme rating without a visible treatment plan will attract ARC attention.\n\nWould you like help writing the risk entry for the register, or the Director briefing on the contractor market risk?`,
      },
    ],
  });

  console.log(`✅ Sam Nguyen seeding complete`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║       AdvisoryHub Demo Data Seeding Script           ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  if (RESET) console.log('⚠  RESET MODE -- existing demo data will be deleted\n');
  if (USER_FILTER) console.log(`👤 Seeding user: ${USER_FILTER}\n`);

  await resolveUserIds();

  // Always fix module assignments -- ensures correct module regardless of how many times script is run
  await fixModules();

  if (!USER_FILTER || USER_FILTER === 'alex') await seedAlex();
  if (!USER_FILTER || USER_FILTER === 'jordan') await seedJordan();
  if (!USER_FILTER || USER_FILTER === 'sam') await seedSam();

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║              Demo Seeding Complete                   ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
