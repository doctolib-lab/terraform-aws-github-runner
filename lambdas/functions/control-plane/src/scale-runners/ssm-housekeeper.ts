import { DeleteParametersCommand, GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import { logger } from '@aws-github-runner/aws-powertools-util';
import { getTracedAWSV3Client } from '@aws-github-runner/aws-powertools-util';

const MAX_DELETE_BATCH_SIZE = 10;
// DeleteParameters default throughput is 3 TPS (standard tier)
const DELETE_BATCH_DELAY_MS = 350;

export interface SSMCleanupOptions {
  dryRun: boolean;
  minimumDaysOld: number;
  tokenPath: string;
}

function validateOptions(options: SSMCleanupOptions): void {
  const errorMessages: string[] = [];
  if (!options.minimumDaysOld || options.minimumDaysOld < 1) {
    errorMessages.push(`minimumDaysOld must be greater then 0, value is set to "${options.minimumDaysOld}"`);
  }
  if (!options.tokenPath) {
    errorMessages.push('tokenPath must be defined');
  }
  if (errorMessages.length > 0) {
    throw new Error(errorMessages.join(', '));
  }
}

export async function cleanSSMTokens(options: SSMCleanupOptions): Promise<void> {
  logger.info(`Cleaning tokens / JIT config older then ${options.minimumDaysOld} days, dryRun: ${options.dryRun}`);
  logger.debug('Cleaning with options', { options });
  validateOptions(options);

  const client = getTracedAWSV3Client(new SSMClient({ region: process.env.AWS_REGION }));
  const parameters = await client.send(new GetParametersByPathCommand({ Path: options.tokenPath }));
  while (parameters.NextToken) {
    const nextParameters = await client.send(
      new GetParametersByPathCommand({ Path: options.tokenPath, NextToken: parameters.NextToken }),
    );
    parameters.Parameters?.push(...(nextParameters.Parameters ?? []));
    parameters.NextToken = nextParameters.NextToken;
  }
  logger.info(`Found #${parameters.Parameters?.length} parameters in path ${options.tokenPath}`);
  logger.debug('Found parameters', { parameters });

  // minimumDate = today - minimumDaysOld
  const minimumDate = new Date();
  minimumDate.setDate(minimumDate.getDate() - options.minimumDaysOld);

  const expiredNames: string[] = [];
  for (const parameter of parameters.Parameters ?? []) {
    if (parameter.Name && parameter.LastModifiedDate && new Date(parameter.LastModifiedDate) < minimumDate) {
      logger.info(`Deleting parameter ${parameter.Name} with last modified date ${parameter.LastModifiedDate}`);
      expiredNames.push(parameter.Name);
    } else {
      logger.debug(`Skipping parameter ${parameter.Name} with last modified date ${parameter.LastModifiedDate}`);
    }
  }

  if (options.dryRun) {
    return;
  }

  let deleted = 0;
  for (let i = 0; i < expiredNames.length; i += MAX_DELETE_BATCH_SIZE) {
    const batch = expiredNames.slice(i, i + MAX_DELETE_BATCH_SIZE);
    try {
      await new Promise((resolve) => setTimeout(resolve, DELETE_BATCH_DELAY_MS));
      const result = await client.send(new DeleteParametersCommand({ Names: batch }));
      deleted += result.DeletedParameters?.length ?? 0;
      if (result.InvalidParameters?.length) {
        logger.warn(`Failed to delete parameters (not found): ${result.InvalidParameters.join(', ')}`);
      }
    } catch (e) {
      logger.warn(`Failed to delete batch of ${batch.length} parameters with error ${(e as Error).message}`);
      logger.debug('Failed to delete parameters', { e });
    }
  }
  logger.info(`Deleted #${deleted} of #${expiredNames.length} expired parameters`);
}
