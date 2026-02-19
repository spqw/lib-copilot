import axios from 'axios';
import { CopilotClient } from '../index';

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
  console.log('=== Copilot Token Response ===');
  console.log(JSON.stringify(tokenRes.data, null, 2));

  const copilotToken = tokenRes.data.token;

  // Check GitHub user billing/copilot endpoints
  const ghEndpoints = [
    'https://api.github.com/user/copilot_billing',
    'https://api.github.com/user/copilot',
    'https://api.github.com/copilot_internal/user',
  ];

  for (const url of ghEndpoints) {
    try {
      const res = await axios.get(url, {
        headers: { 'Authorization': `token ${ghToken}`, 'Accept': 'application/json' },
      });
      console.log(`\n=== ${url} (${res.status}) ===`);
      console.log(JSON.stringify(res.data, null, 2).substring(0, 1000));
    } catch (e: any) {
      console.log(`\n=== ${url} (${e.response?.status || 'err'}) ===`);
      if (e.response?.data) console.log(JSON.stringify(e.response.data).substring(0, 300));
    }
  }

  // Check copilot API endpoints for usage/models info
  const copilotEndpoints = [
    'https://api.githubcopilot.com/models',
    'https://api.githubcopilot.com/usage',
    'https://api.githubcopilot.com/user',
  ];

  for (const url of copilotEndpoints) {
    try {
      const res = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${copilotToken}`,
          'User-Agent': 'GithubCopilot/1.200.0',
          'Accept': 'application/json',
          'Editor-Version': 'vscode/1.95.0',
          'Copilot-Integration-Id': 'vscode-chat',
          'Openai-Organization': 'github-copilot',
        },
      });
      console.log(`\n=== ${url} (${res.status}) ===`);
      console.log(JSON.stringify(res.data, null, 2).substring(0, 3000));
    } catch (e: any) {
      console.log(`\n=== ${url} (${e.response?.status || 'err'}) ===`);
      if (e.response?.data) console.log(JSON.stringify(e.response.data).substring(0, 300));
    }
  }
}

main().catch(console.error);
