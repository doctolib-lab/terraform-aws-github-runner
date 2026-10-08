import { Octokit } from '@octokit/rest';
import { createChildLogger } from '@aws-github-runner/aws-powertools-util';

import { GhRunners } from '../scale-runners/cache';

const logger = createChildLogger('runner-group');

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

/**
 * Lists the self-hosted runners of an organization. When RUNNER_GROUP_ID is set only the runners of that runner
 * group are listed, so environments that share an organization do not paginate through each other's runners.
 * The id is trusted as given: it is not checked against the group name, that would cost an API call per container.
 * Without the id, or when GitHub cannot show that group, every runner of the organization is listed.
 */
export async function listOrgRunners(client: Octokit, org: string): Promise<GhRunners> {
  const groupId = configuredRunnerGroupId();

  if (groupId !== undefined) {
    try {
      const runners = await client.paginate('GET /orgs/{org}/actions/runner-groups/{runner_group_id}/runners', {
        org,
        runner_group_id: groupId,
        per_page: 100,
      });
      const groupName = process.env.RUNNER_GROUP_NAME;
      logger.info(
        `Listed ${runners.length} runners of runner group ${groupName ? `'${groupName}' ` : ''}(${groupId}) in ${org}`,
      );
      return runners;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 404 && status !== 403) {
        throw error;
      }
      logger.warn(
        `Runner group ${groupId} cannot be listed in ${org} (HTTP ${status}), listing all org runners instead. Update RUNNER_GROUP_ID if the group was recreated.`,
      );
    }
  }

  const runners = await client.paginate(client.actions.listSelfHostedRunnersForOrg, {
    org,
    per_page: 100,
  });
  logger.info(`Listed ${runners.length} runners of all runner groups in ${org}`);
  return runners;
}
