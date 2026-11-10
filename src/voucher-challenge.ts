import type {
    ChallengeFileInput,
    ChallengeInput,
    ChallengeResultInput,
    GetChallengeArgsInput,
    CommunityChallengeSetting
} from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import type { LocalCommunity } from "./types.js";

const defaultDescription =
    "Distribute unique voucher codes to specific authors. Each author gets their own voucher code that only works for them.";

const optionInputs = <NonNullable<ChallengeFileInput["optionInputs"]>>[
    {
        option: "question",
        label: "Question",
        default: "What is your voucher code?",
        description: "The question to ask for the voucher code.",
        placeholder: "What is your voucher code?"
    },
    {
        option: "vouchers",
        label: "Available Vouchers",
        default: "",
        description: "Comma-separated list of voucher codes available for redemption",
        placeholder: "VOUCHER123,VOUCHER456,VOUCHER789",
        required: true
    },
    {
        option: "description",
        label: "Description",
        default: defaultDescription,
        description: "Custom description for the challenge that explains the voucher system.",
        placeholder: "Enter your exclusive access code"
    },
    {
        option: "invalidVoucherError",
        label: "Invalid Voucher Error",
        default: "Invalid voucher code.",
        description: "Error message shown when an invalid voucher code is entered.",
        placeholder: "Invalid voucher code."
    },
    {
        option: "alreadyRedeemedError",
        label: "Already Redeemed Error",
        default: "This voucher has already been redeemed by another author.",
        description: "Error message shown when a voucher has already been redeemed by someone else.",
        placeholder: "This voucher has already been redeemed by another author."
    }
];

const type: ChallengeInput["type"] = "text/plain";

const getVoucherStateFilePath = (community: LocalCommunity): string => {
    const challengeDataDir = path.join(community._pkc.dataPath!, "communities", `${community.address}-challenge-data`);
    return path.join(challengeDataDir, "voucher_redemption_states.json");
};

const loadRedeemedVouchers = async (community: LocalCommunity): Promise<Record<string, string>> => {
    const filePath = getVoucherStateFilePath(community);

    try {
        const data = await fs.promises.readFile(filePath, "utf8");
        return JSON.parse(data);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
    }
};

const saveRedeemedVouchers = async (community: LocalCommunity, redeemedVouchers: Record<string, string>): Promise<void> => {
    const filePath = getVoucherStateFilePath(community);
    const dir = path.dirname(filePath);

    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(redeemedVouchers, null, 2));
};

// A redemption reads, checks and rewrites the whole state file, so redemptions for one file run one at a time.
// pkc-js runs a community in a single process, so an in-process queue covers every writer of the file.
const stateFileQueues = new Map<string, Promise<void>>();

const withStateFileLock = async <T>(filePath: string, task: () => Promise<T>): Promise<T> => {
    const previous = stateFileQueues.get(filePath) ?? Promise.resolve();
    const result = previous.then(task);
    const settled = result.then(
        () => undefined,
        () => undefined
    );
    stateFileQueues.set(filePath, settled);
    try {
        return await result;
    } finally {
        if (stateFileQueues.get(filePath) === settled) stateFileQueues.delete(filePath);
    }
};

// Binds the voucher to the author's public key unless another author already holds it. Returns false in that case.
const redeemVoucher = (
    community: LocalCommunity,
    voucher: string,
    author: { publicKey: string; address: string }
): Promise<boolean> =>
    withStateFileLock(getVoucherStateFilePath(community), async () => {
        const redeemedVouchers = await loadRedeemedVouchers(community);
        const holder = redeemedVouchers[voucher];

        if (holder === author.publicKey) return true;

        // Older versions stored author.address, which is the author's domain name when they have one.
        // Such an entry is rebound to the public key of the author who presents that address.
        if (holder && holder !== author.address) return false;

        redeemedVouchers[voucher] = author.publicKey;
        await saveRedeemedVouchers(community, redeemedVouchers);
        return true;
    });

const getChallenge = async ({
    challengeSettings,
    challengeRequestMessage,
    challengeIndex,
    community
}: GetChallengeArgsInput): Promise<ChallengeInput | ChallengeResultInput> => {
    if (!challengeSettings?.options?.question) throw Error("No option question");

    const vouchersString = challengeSettings?.options?.vouchers;
    if (!vouchersString || typeof vouchersString !== "string") {
        throw Error("No vouchers configured");
    }

    const availableVouchers = vouchersString
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    if (availableVouchers.length === 0) {
        throw Error("No valid vouchers configured");
    }

    const invalidVoucherError = challengeSettings?.options?.invalidVoucherError || "Invalid voucher code.";
    const alreadyRedeemedError =
        challengeSettings?.options?.alreadyRedeemedError || "This voucher has already been redeemed by another author.";

    const getAuthor = () => {
        return (
            challengeRequestMessage?.comment?.author ||
            challengeRequestMessage?.vote?.author ||
            challengeRequestMessage?.commentEdit?.author ||
            challengeRequestMessage?.commentModeration?.author ||
            challengeRequestMessage?.communityEdit?.author
        );
    };

    const author = getAuthor();
    const authorAddress = author?.address;
    if (!authorAddress) {
        throw Error("No author address found");
    }
    // pkc-js sets author.address to the author's domain name when they have one, else to their public key.
    // Vouchers are bound to the public key, which stays the same when the author sets or removes a name.
    const authorIdentity = { publicKey: author.publicKey || authorAddress, address: authorAddress };

    // Checks the answer against the state file as it is at answer time, not when the challenge was requested,
    // because pkc-js can hold a pending challenge for minutes while other authors redeem vouchers.
    const verifyVoucher = async (answer: string): Promise<ChallengeResultInput> => {
        if (!availableVouchers.includes(answer)) {
            return {
                success: false,
                error: invalidVoucherError
            };
        }

        if (!(await redeemVoucher(community, answer, authorIdentity))) {
            return {
                success: false,
                error: alreadyRedeemedError
            };
        }

        return {
            success: true
        };
    };

    const challengeAnswer = challengeRequestMessage?.challengeAnswers?.[challengeIndex];

    if (challengeAnswer === undefined) {
        return {
            challenge: challengeSettings?.options?.question,
            verify: verifyVoucher,
            type
        };
    }

    return verifyVoucher(challengeAnswer);
};

function ChallengeFileFactory({ challengeSettings }: { challengeSettings: CommunityChallengeSetting }): ChallengeFileInput {
    const question = challengeSettings?.options?.question;
    const challenge = question;
    const description = challengeSettings?.options?.description || defaultDescription;

    return { getChallenge, optionInputs, type, challenge, description };
}

export default ChallengeFileFactory;
