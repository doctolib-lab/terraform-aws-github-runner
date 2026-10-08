import { Octokit } from '@octokit/rest';
import { createChildLogger } from '@aws-github-runner/aws-powertools-util';

import { GhRunners } from '../scale-runners/cache';

const logger = createChildLogger('runner-group');

// Runner groups already checked against their expected name in this container: "org/id".
const verifiedGroups = new Set<string>();

export function resetRunnerGroupCache(): void {
  verifiedGroups.clear();
}

function configuredRunnerGroupId(): number | undefined {
  const raw = process.env.RUNNER_GROUP_ID;
  if (!raw) {
    return undefined;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    logger.warn(`Ignoring RUNNER_GROUP_ID '${raw}', it is not a runner group id`);
    return undefined;
  }
  return id;
}

// A wrong id would list a group that is not ours, and every runner of ours would look unknown to GitHub and be
// terminated as an orphan. So the group the id points to must carry the name we expect before we rely on it.
// Listing all org runners instead is always safe: it is a superset, it can only add runners we do not own.
async function groupHasExpectedName(client: Octokit, org: string, id: number, expectedName: string): Promise<boolean> {
  const key = `${org}/${id}`;
  if (verifiedGroups.has(key)) {
    return true;
  }
  try {
    const { data } = await client.request('GET /orgs/{org}/actions/runner-groups/{runner_group_id}', {
      org,
      runner_group_id: id,
    });
    if (data.name !== expectedName) {
      logger.error(
        `Runner group ${id} is named '${data.name}', not '${expectedName}': RUNNER_GROUP_ID is wrong, listing all org runners instead`,
      );
      return false;
    }
    verifiedGroups.add(key);
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 403) {
      logger.warn(
        `Runner group ${id} cannot be read in ${org} (HTTP ${status}), listing all org runners instead. Update RUNNER_GROUP_ID if the group was recreated.`,
      );
      return false;
    }
    throw error;
  }
}

/**
 * Lists the self-hosted runners of an organization. When RUNNER_GROUP_ID is set (and RUNNER_GROUP_NAME names that
 * group) only the runners of that runner group are listed, so environments that share an organization do not
 * paginate through each other's runners. Without it, every runner of the organization is listed.
 */
export async function listOrgRunners(client: Octokit, org: string): Promise<GhRunners> {
  const groupId = configuredRunnerGroupId();
  const groupName = process.env.RUNNER_GROUP_NAME;

  if (groupId !== undefined) {
    if (!groupName) {
      logger.warn(
        'RUNNER_GROUP_ID is set without RUNNER_GROUP_NAME, the group cannot be verified: listing all org runners',
      );
    } else if (await groupHasExpectedName(client, org, groupId, groupName)) {
      const runners = await client.paginate('GET /orgs/{org}/actions/runner-groups/{runner_group_id}/runners', {
        org,
        runner_group_id: groupId,
        per_page: 100,
      });
      logger.info(`Listed ${runners.length} runners of runner group '${groupName}' (${groupId}) in ${org}`);
      return runners;
    }
  }

  const runners = await client.paginate(client.actions.listSelfHostedRunnersForOrg, {
    org,
    per_page: 100,
  });
  logger.info(`Listed ${runners.length} runners of all runner groups in ${org}`);
  return runners;
}
