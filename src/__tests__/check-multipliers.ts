import axios from 'axios';

async function main() {
  const ghToken = process.env.GITHUB_TOKEN!;

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

  // Get full models response - look for pricing/multiplier fields
  const modelsRes = await axios.get('https://api.githubcopilot.com/models', {
    headers: {
      'Authorization': `Bearer ${copilotToken}`,
      'User-Agent': 'GithubCopilot/1.200.0',
      'Accept': 'application/json',
      'Copilot-Integration-Id': 'vscode-chat',
      'Openai-Organization': 'github-copilot',
    },
  });

  // Print ALL fields for each model to find multiplier/pricing info
  for (const m of modelsRes.data.data) {
    // Get all top-level keys
    const keys = Object.keys(m);
    const interestingKeys = keys.filter(k => !['capabilities', 'policy'].includes(k));
    const info: any = {};
    for (const k of interestingKeys) {
      info[k] = m[k];
    }
    // Also check for any pricing/tier/multiplier/cost fields anywhere
    const allStr = JSON.stringify(m);
    if (allStr.includes('multiplier') || allStr.includes('cost') || allStr.includes('tier') || allStr.includes('premium') || allStr.includes('price') || allStr.includes('rate') || allStr.includes('quota')) {
      info._has_pricing_fields = true;
    }
    info._policy = m.policy;
    console.log(JSON.stringify(info));
  }

  // Also dump one full model object to see all possible fields
  console.log('\n=== FULL FIRST MODEL ===');
  console.log(JSON.stringify(modelsRes.data.data[0], null, 2));

  // Check if there's a separate pricing/rate-card endpoint
  const pricingEndpoints = [
    'https://api.githubcopilot.com/models/pricing',
    'https://api.githubcopilot.com/pricing',
    'https://api.githubcopilot.com/rate-card',
    'https://api.github.com/copilot_internal/models',
    'https://api.github.com/copilot_internal/v2/models',
  ];

  console.log('\n=== PRICING ENDPOINTS ===');
  for (const url of pricingEndpoints) {
    try {
      const res = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${copilotToken}`,
          'User-Agent': 'GithubCopilot/1.200.0',
          'Copilot-Integration-Id': 'vscode-chat',
          'Openai-Organization': 'github-copilot',
        },
      });
      console.log(`${url} (${res.status}): ${JSON.stringify(res.data).substring(0, 500)}`);
    } catch (e: any) {
      console.log(`${url} (${e.response?.status || 'err'})`);
    }
  }
}

main().catch(console.error);
