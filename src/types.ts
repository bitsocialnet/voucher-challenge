export type {
  ChallengeFileInput,
  ChallengeInput,
  ChallengeResultInput,
  GetChallengeArgsInput,
  CommunityChallengeSetting
} from "@pkcprotocol/pkc-js/challenges";

import type { GetChallengeArgsInput } from "@pkcprotocol/pkc-js/challenges";

export type LocalCommunity = GetChallengeArgsInput["community"];
