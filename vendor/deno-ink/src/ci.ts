/**
 * CI environment detection utilities.
 * Detects common CI environments and provides color support detection.
 */

/**
 * Check if running in a CI environment.
 * Checks for common CI environment variables.
 */
export function isCI(): boolean {
  try {
    const env = Deno.env.toObject();

    return !!(
      env.CI ||
      env.CONTINUOUS_INTEGRATION ||
      env.BUILD_NUMBER ||
      env.GITHUB_ACTIONS ||
      env.GITLAB_CI ||
      env.CIRCLECI ||
      env.TRAVIS ||
      env.JENKINS_URL ||
      env.BUILDKITE ||
      env.DRONE ||
      env.TEAMCITY_VERSION ||
      env.CODEBUILD_BUILD_ID || // AWS CodeBuild
      env.TF_BUILD || // Azure Pipelines
      env.BITBUCKET_BUILD_NUMBER // Bitbucket Pipelines
    );
  } catch {
    // If we can't access env, assume not in CI
    return false;
  }
}

/**
 * Check if colors should be used in output.
 * Respects FORCE_COLOR and NO_COLOR environment variables.
 */
export function shouldUseColors(): boolean {
  try {
    const env = Deno.env.toObject();

    // Force colors if explicitly set
    if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") {
      return true;
    }

    // Disable colors if NO_COLOR is set (https://no-color.org/)
    if (env.NO_COLOR !== undefined) {
      return false;
    }

    // In CI without explicit setting, disable colors
    if (isCI()) {
      return false;
    }

    // Check if stdout is a TTY
    return Deno.stdout.isTerminal();
  } catch {
    // Default to true if we can't determine
    return true;
  }
}

/**
 * Check if the terminal is interactive.
 * Returns false in CI or when stdin is not a TTY.
 */
export function isInteractive(): boolean {
  if (isCI()) {
    return false;
  }

  try {
    return Deno.stdin.isTerminal() && Deno.stdout.isTerminal();
  } catch {
    return false;
  }
}
