import { Octokit } from '@octokit/rest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { listOrgRunners } from './runner-group';

const ORG = 'my-org';
const GROUP_ROUTE = 'GET /orgs/{org}/actions/runner-groups/{runner_group_id}/runners';

const listSelfHostedRunnersForOrg = vi.fn();
const mockClient = {
  actions: { listSelfHostedRunnersForOrg },
  paginate: vi.fn(),
};
const client = mockClient as unknown as Octokit;

const groupRunners = [{ id: 1, name: 'prod_i-1' }];
const orgRunners = [
  { id: 1, name: 'prod_i-1' },
  { id: 2, name: 'staging_i-2' },
];

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('listOrgRunners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RUNNER_GROUP_ID;
    delete process.env.RUNNER_GROUP_NAME;
    mockClient.paginate.mockImplementation(async (route: unknown) =>
      route === GROUP_ROUTE ? groupRunners : orgRunners,
    );
  });

  afterEach(() => {
    delete process.env.RUNNER_GROUP_ID;
    delete process.env.RUNNER_GROUP_NAME;
  });

  const expectOrgWideListing = (result: unknown) => {
    expect(result).toBe(orgRunners);
    expect(mockClient.paginate).toHaveBeenCalledWith(listSelfHostedRunnersForOrg, { org: ORG, per_page: 100 });
  };

  it('lists all the runners of the org when no runner group id is configured', async () => {
    process.env.RUNNER_GROUP_NAME = 'runners-production';

    expectOrgWideListing(await listOrgRunners(client, ORG));
    expect(mockClient.paginate).not.toHaveBeenCalledWith(GROUP_ROUTE, expect.anything());
  });

  it('lists only the runners of the runner group when its id is configured, in a single call', async () => {
    process.env.RUNNER_GROUP_ID = '42';
    process.env.RUNNER_GROUP_NAME = 'runners-production';

    const result = await listOrgRunners(client, ORG);

    expect(result).toBe(groupRunners);
    expect(mockClient.paginate).toHaveBeenCalledTimes(1);
    expect(mockClient.paginate).toHaveBeenCalledWith(GROUP_ROUTE, { org: ORG, runner_group_id: 42, per_page: 100 });
  });

  it('does not need the runner group name', async () => {
    process.env.RUNNER_GROUP_ID = '42';

    expect(await listOrgRunners(client, ORG)).toBe(groupRunners);
    expect(mockClient.paginate).toHaveBeenCalledTimes(1);
  });

  it.each([404, 403])(
    'lists all the runners of the org when GitHub cannot show the group (HTTP %i)',
    async (status) => {
      process.env.RUNNER_GROUP_ID = '42';
      mockClient.paginate.mockImplementation(async (route: unknown) => {
        if (route === GROUP_ROUTE) {
          throw httpError(status);
        }
        return orgRunners;
      });

      expectOrgWideListing(await listOrgRunners(client, ORG));
    },
  );

  it('fails on other errors, like it does when the org-wide listing fails', async () => {
    process.env.RUNNER_GROUP_ID = '42';
    mockClient.paginate.mockRejectedValue(httpError(502));

    await expect(listOrgRunners(client, ORG)).rejects.toThrow('HTTP 502');
    expect(mockClient.paginate).toHaveBeenCalledTimes(1);
  });

  it.each(['abc', '0', '-3', '4.5'])('ignores a runner group id that is not an id (%s)', async (value) => {
    process.env.RUNNER_GROUP_ID = value;

    expectOrgWideListing(await listOrgRunners(client, ORG));
    expect(mockClient.paginate).not.toHaveBeenCalledWith(GROUP_ROUTE, expect.anything());
  });
});
