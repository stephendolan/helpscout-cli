import { Command } from 'commander';
import { client } from '../lib/api-client.js';
import { outputJson } from '../lib/output.js';
import { withErrorHandling, confirmDelete, parseIdArg, requireAtLeastOneField } from '../lib/command-utils.js';

export function createCustomersCommand(): Command {
  const cmd = new Command('customers').description('Customer operations');

  cmd
    .command('list')
    .description('List customers')
    .option('-m, --mailbox <id>', 'Filter by mailbox ID')
    .option('--first-name <name>', 'Filter by first name')
    .option('--last-name <name>', 'Filter by last name')
    .option('--modified-since <date>', 'Filter by modified date (ISO 8601)')
    .option('--sort-field <field>', 'Sort by field (createdAt, firstName, lastName, modifiedAt)')
    .option('--sort-order <order>', 'Sort order (asc, desc)')
    .option('--page <number>', 'Page number')
    .option('-q, --query <query>', 'Advanced search query')
    .action(withErrorHandling(async (options: {
      mailbox?: string;
      firstName?: string;
      lastName?: string;
      modifiedSince?: string;
      sortField?: string;
      sortOrder?: string;
      page?: string;
      query?: string;
    }) => {
      const result = await client.listCustomers({
        mailbox: options.mailbox,
        firstName: options.firstName,
        lastName: options.lastName,
        modifiedSince: options.modifiedSince,
        sortField: options.sortField,
        sortOrder: options.sortOrder,
        page: options.page ? parseInt(options.page, 10) : undefined,
        query: options.query,
      });
      outputJson(result);
    }));

  cmd
    .command('view')
    .description('View a customer')
    .argument('<id>', 'Customer ID')
    .action(withErrorHandling(async (id: string) => {
      const customer = await client.getCustomer(parseIdArg(id, 'customer'));
      outputJson(customer);
    }));

  cmd
    .command('create')
    .description('Create a customer')
    .option('--first-name <name>', 'First name')
    .option('--last-name <name>', 'Last name')
    .option('--email <email>', 'Email address')
    .option('--phone <phone>', 'Phone number')
    .action(withErrorHandling(async (options: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
    }) => {
      const data = {
        ...(options.firstName && { firstName: options.firstName }),
        ...(options.lastName && { lastName: options.lastName }),
        ...(options.email && { emails: [{ type: 'work', value: options.email }] }),
        ...(options.phone && { phones: [{ type: 'work', value: options.phone }] }),
      };
      requireAtLeastOneField(data, 'Customer create');
      await client.createCustomer(data);
      outputJson({ message: 'Customer created' });
    }));

  cmd
    .command('update')
    .description('Update a customer')
    .argument('<id>', 'Customer ID')
    .option('--first-name <name>', 'First name')
    .option('--last-name <name>', 'Last name')
    .option('--job-title <title>', 'Job title')
    .option('--location <location>', 'Location')
    .option('--organization <org>', 'Organization')
    .option('--background <text>', 'Background notes')
    .action(withErrorHandling(async (id: string, options: {
      firstName?: string;
      lastName?: string;
      jobTitle?: string;
      location?: string;
      organization?: string;
      background?: string;
    }) => {
      const data = {
        ...(options.firstName && { firstName: options.firstName }),
        ...(options.lastName && { lastName: options.lastName }),
        ...(options.jobTitle && { jobTitle: options.jobTitle }),
        ...(options.location && { location: options.location }),
        ...(options.organization && { organization: options.organization }),
        ...(options.background && { background: options.background }),
      };
      requireAtLeastOneField(data, 'Customer update');
      await client.updateCustomer(parseIdArg(id, 'customer'), data);
      outputJson({ message: 'Customer updated' });
    }));

  cmd
    .command('delete')
    .description('Delete a customer')
    .argument('<id>', 'Customer ID')
    .option('-y, --yes', 'Skip confirmation')
    .action(withErrorHandling(async (id: string, options: { yes?: boolean }) => {
      await confirmDelete('customer', options.yes);
      await client.deleteCustomer(parseIdArg(id, 'customer'));
      outputJson({ message: 'Customer deleted' });
    }));

  return cmd;
}
