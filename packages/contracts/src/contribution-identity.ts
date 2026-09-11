export interface ContributionIdentity {
  packageId: string
  contributionId: string
}

export function contributionKey(packageId: string, contributionId: string): string {
  return `${packageId}:${contributionId}`
}
