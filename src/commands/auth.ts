import { Command } from 'commander';
import { auth } from '../lib/auth.js';
import { client } from '../lib/api-client.js';
import { outputJson } from '../lib/output.js';
import { withErrorHandling } from '../lib/command-utils.js';

export function createAuthCommand(): Command {
  const cmd = new Command('auth').description('Authentication operations');

  cmd
    .command('login')
    .description('Configure Help Scout API credentials')
    .requiredOption('--app-id <id>', 'Help Scout App ID')
    .requiredOption('--app-secret <secret>', 'Help Scout App Secret')
    .action(
      withErrorHandling(async (options: { appId: string; appSecret: string }) => {
        await auth.setAppId(options.appId);
        await auth.setAppSecret(options.appSecret);

        client.clearToken();
        await client.refreshAccessToken();

        outputJson({ message: 'Successfully authenticated with Help Scout' });
      })
    );

  cmd
    .command('logout')
    .description('Remove stored credentials')
    .action(
      withErrorHandling(async () => {
        await auth.logout();
        client.clearToken();
        outputJson({ message: 'Logged out successfully' });
      })
    );

  cmd
    .command('status')
    .description('Check authentication status')
    .action(
      withErrorHandling(async () => {
        const hasToken = await auth.isAuthenticated();
        const hasAppId = !!(await auth.getAppId());
        const hasAppSecret = !!(await auth.getAppSecret());

        outputJson({
          authenticated: hasToken,
          configured: hasAppId && hasAppSecret,
        });
      })
    );

  cmd
    .command('refresh')
    .description('Refresh access token')
    .action(
      withErrorHandling(async () => {
        client.clearToken();
        await client.refreshAccessToken();
        outputJson({ message: 'Access token refreshed' });
      })
    );

  return cmd;
}
