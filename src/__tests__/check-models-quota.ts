import axios from 'axios';

async function main() {
  const ghToken = process.env.GITHUB_TOKEN!;

  // Get copilot session token
  const tokenRes = await axios.get('https://api.github.com/copilot_internal/v2/token', {
    headers: {
      'Authorization': `token ${ghToken}`,
      'User-Agent': 'GithubCopilot/1.200.0',
      'Accept': 'application/json',
      'Editor-Version': 'vscode/1.95.0',
      'Editor-Plugin-Version': 'copilot/1.200.0',
    },
  });
  const copilotToken = tokenRes.data.token;

  // Get full models list
  const modelsRes = await axios.get('https://api.githubcopilot.com/models', {
    headers: {
      'Authorization': `Bearer ${copilotToken}`,
      'User-Agent': 'GithubCopilot/1.200.0',
      'Accept': 'application/json',
      'Copilot-Integration-Id': 'vscode-chat',
      'Openai-Organization': 'github-copilot',
    },
  });

  console.log('=== MODELS ===\n');
  for (const m of modelsRes.data.data) {
    const limits = m.capabilities?.limits || {};
    const supports = m.capabilities?.supports || {};
    console.log(`${m.id}`);
    console.log(`  name: ${m.name} | vendor: ${m.vendor} | preview: ${m.preview}`);
    console.log(`  category: ${m.model_picker_category} | policy: ${m.policy?.state}`);
    console.log(`  context: ${limits.max_context_window_tokens} | max_output: ${limits.max_output_tokens}`);
    console.log(`  vision: ${supports.vision || false} | tools: ${supports.tool_calls || false} | streaming: ${supports.streaming || false}`);
    console.log(`  endpoints: ${m.supported_endpoints?.join(', ')}`);
    console.log('');
  }

  // Get quota/usage info
  const userRes = await axios.get('https://api.github.com/copilot_internal/user', {
    headers: { 'Authorization': `token ${ghToken}`, 'Accept': 'application/json' },
  });

  console.log('\n=== QUOTA / USAGE ===\n');
  console.log('plan:', userRes.data.copilot_plan);
  console.log('sku:', userRes.data.access_type_sku);
  console.log('org:', userRes.data.organization_login_list?.join(', '));
  console.log('reset date:', userRes.data.quota_reset_date);
  console.log('');

  if (userRes.data.quota_snapshots) {
    for (const [key, val] of Object.entries(userRes.data.quota_snapshots) as any) {
      console.log(`[${key}]`);
      console.log(`  entitlement: ${val.entitlement} | overage: ${val.overage_count} | remaining: ${val.percent_remaining}%`);
      console.log(`  overage_permitted: ${val.overage_permitted}`);
      if (val.premium_requests_used !== undefined) console.log(`  premium_requests_used: ${val.premium_requests_used}`);
      console.log('');
    }
  }

  // Also print the full quota_snapshots raw
  console.log('\n=== RAW QUOTA ===');
  console.log(JSON.stringify(userRes.data.quota_snapshots, null, 2));
}

main().catch(console.error);
