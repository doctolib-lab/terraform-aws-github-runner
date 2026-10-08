import { Octokit } from '@octokit/rest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { listOrgRunners, resetRunnerGroupCache } from './runner-group';

const ORG = 'my-org';
const GROUP_ROUTE = 'GET /orgs/{org}/actions/runner-groups/{runner_group_id}/runners';
const GROUP_INFO_ROUTE = 'GET /orgs/{org}/actions/runner-groups/{runner_group_id}';

const listSelfHostedRunnersForOrg = vi.fn();
const mockClient = {
  actions: { listSelfHostedRunnersForOrg },
  paginate: vi.fn(),
  request: vi.fn(),
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
    resetRunnerGroupCache();
    delete process.env.RUNNER_GROUP_ID;
    delete process.env.RUNNER_GROUP_NAME;
    mockClient.paginate.mockImplementation(async (route: unknown) =>
      route === GROUP_ROUTE ? groupRunners : orgRunners,
    );
    mockClient.request.mockResolvedValue({ data: { name: 'runners-production' } });
  });

  afterEach(() => {
    delete process.env.RUNNER_GROUP_ID;
    delete process.env.RUNNER_GROUP_NAME;
  });

  const expectOrgWideListing = (result: unknown) => {
    expect(result).toBe(orgRunners);
    expect(mockClient.paginate).toHaveBeenCalledWith(listSelfHostedRunnersForOrg, { org: ORG, per_page: 100 });
    expect(mockClient.paginate).not.toHaveBeenCalledWith(GROUP_ROUTE, expect.anything());
  };

  it('lists all the runners of the org when no runner group id is configured', async () => {
    process.env.RUNNER_GROUP_NAME = 'runners-production';

    expectOrgWideListing(await listOrgRunners(client, ORG));
    expect(mockClient.request).not.toHaveBeenCalled();
  });

  it('lists only the runners of the runner group when its id is configured and the name matches', async () => {
    process.env.RUNNER_GROUP_ID = '42';
    process.env.RUNNER_GROUP_NAME = 'runners-production';

    const result = await listOrgRunners(client, ORG);

    expect(result).toBe(groupRunners);
    expect(mockClient.request).toHaveBeenCalledWith(GROUP_INFO_ROUTE, { org: ORG, runner_group_id: 42 });
    expect(mockClient.paginate).toHaveBeenCalledWith(GROUP_ROUTE, { org: ORG, runner_group_id: 42, per_page: 100 });
    expect(mockClient.paginate).not.toHaveBeenCalledWith(listSelfHostedRunnersForOrg, expect.anything());
  });

  it('checks the name of the group once per container, not on every listing', async () => {
    process.env.RUNNER_GROUP_ID = '42';
    process.env.RUNNER_GROUP_NAME = 'runners-production';

    await listOrgRunners(client, ORG);
    await listOrgRunners(client, ORG);
    await listOrgRunners(client, ORG);

    expect(mockClient.request).toHaveBeenCalledTimes(1);
    expect(mockClient.paginate).toHaveBeenCalledTimes(3);
  });

  it('lists all the org runners when the id belongs to a group with another name', async () => {
    process.env.RUNNER_GROUP_ID = '42';
    process.env.RUNNER_GROUP_NAME = 'runners-production';
    mockClient.request.mockResolvedValue({ data: { name: 'runners-staging' } });

    expectOrgWideListing(await listOrgRunners(client, ORG));
  });

  it('does not remember a group that failed the name check', async () => {
    process.env.RUNNER_GROUP_ID = '42';
    process.env.RUNNER_GROUP_NAME = 'runners-production';
    mockClient.request.mockResolvedValueOnce({ data: { name: 'runners-staging' } });

    await listOrgRunners(client, ORG);
    const second = await listOrgRunners(client, ORG);

    expect(mockClient.request).toHaveBeenCalledTimes(2);
    expect(second).toBe(groupRunners);
  });

  it.each([404, 403])('lists all the org runners when the group cannot be read (HTTP %i)', async (status) => {
    process.env.RUNNER_GROUP_ID = '42';
    process.env.RUNNER_GROUP_NAME = 'runners-production';
    mockClient.request.mockRejectedValue(httpError(status));

    expectOrgWideListing(await listOrgRunners(client, ORG));
  });

  it('fails on other errors, like it does when the org-wide listing fails', async () => {
    process.env.RUNNER_GROUP_ID = '42';
    process.env.RUNNER_GROUP_NAME = 'runners-production';
    mockClient.request.mockRejectedValue(httpError(502));

    await expect(listOrgRunners(client, ORG)).rejects.toThrow('HTTP 502');
    expect(mockClient.paginate).not.toHaveBeenCalled();
  });

  it('lists all the org runners when the id is set without the group name to check it against', async () => {
    process.env.RUNNER_GROUP_ID = '42';

    expectOrgWideListing(await listOrgRunners(client, ORG));
    expect(mockClient.request).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-3', '4.5'])('ignores a runner group id that is not an id (%s)', async (value) => {
    process.env.RUNNER_GROUP_ID = value;
    process.env.RUNNER_GROUP_NAME = 'runners-production';

    expectOrgWideListing(await listOrgRunners(client, ORG));
    expect(mockClient.request).not.toHaveBeenCalled();
  });
});
