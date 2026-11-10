import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { voucherChallenge } from "../src/index.js";
import type { ChallengeInput, ChallengeResultInput, GetChallengeArgsInput } from "../src/types.js";
import * as remeda from "remeda";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("voucher challenge", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = path.join(tmpdir(), "pkc-test-" + Math.random().toString(36));
    });

    afterEach(async () => {
        if (tempDir && fs.existsSync(tempDir)) {
            await fs.promises.rm(tempDir, { recursive: true });
        }
    });

    interface ChallengeRequestOverrides {
        publication?: Record<string, unknown>;
        challengeAnswers?: string[];
        [key: string]: unknown;
    }

    interface VoucherOptions {
        question?: string;
        vouchers?: string;
        invalidVoucherError?: string;
        alreadyRedeemedError?: string;
    }

    const createChallengeRequestMessage = (overrides: ChallengeRequestOverrides = {}) => {
        const defaultPublication = {
            author: {
                address: "12D3test123",
                publicKey: "12D3test123"
            },
            content: "test content",
            timestamp: 1234567890,
            communityAddress: "communityAddress"
        };

        return {
            comment: {
                ...defaultPublication,
                ...(overrides.publication || {})
            },
            ...(remeda.omit(overrides, ["publication"]) || {})
        };
    };

    const createCommunity = (options: VoucherOptions = {}) => {
        const defaultOptions: VoucherOptions = {
            question: "What is your voucher code?",
            vouchers: "VOUCHER1,VOUCHER2,VOUCHER3"
        };

        return {
            address: "test-community-address",
            _pkc: {
                dataPath: tempDir
            },
            settings: {
                challenges: [
                    {
                        name: "@bitsocial/voucher-challenge",
                        options: {
                            ...defaultOptions,
                            ...options
                        }
                    }
                ]
            }
        };
    };

    const getChallengeArgs = (
        community: ReturnType<typeof createCommunity>,
        challengeRequestMessage: ReturnType<typeof createChallengeRequestMessage>,
        challengeIndex = 0
    ): GetChallengeArgsInput => ({
        challengeSettings: community.settings.challenges[0] as GetChallengeArgsInput["challengeSettings"],
        challengeRequestMessage: challengeRequestMessage as unknown as GetChallengeArgsInput["challengeRequestMessage"],
        challengeIndex,
        community: community as unknown as GetChallengeArgsInput["community"]
    });

    const isChallengeInput = (result: ChallengeInput | ChallengeResultInput): result is ChallengeInput => {
        return "challenge" in result;
    };

    describe("basic functionality", () => {
        it("voucher challenge factory is a function", () => {
            expect(voucherChallenge).to.be.a("function");
        });

        it("creates voucher challenge with default options", () => {
            const challenge = voucherChallenge({ challengeSettings: {} } as Parameters<typeof voucherChallenge>[0]);
            expect(challenge.getChallenge).to.be.a("function");
            expect(challenge.optionInputs).to.be.an("array");
            expect(challenge.type).to.equal("text/plain");
        });

        it("has correct option inputs", () => {
            const challenge = voucherChallenge({ challengeSettings: {} } as Parameters<typeof voucherChallenge>[0]);
            const optionNames = challenge.optionInputs!.map((opt) => opt.option);
            expect(optionNames).to.include("question");
            expect(optionNames).to.include("vouchers");
            expect(optionNames).to.include("description");
            expect(optionNames).to.include("invalidVoucherError");
            expect(optionNames).to.include("alreadyRedeemedError");
        });
    });

    describe("challenge verification", () => {
        it("accepts valid voucher codes", async () => {
            const community = createCommunity();
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.true;
            if (isChallengeInput(result)) {
                const verification = await result.verify!("VOUCHER1");
                expect(verification.success).to.be.true;
            }
        });

        it("rejects invalid voucher codes", async () => {
            const community = createCommunity();
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.true;
            if (isChallengeInput(result)) {
                const verification = await result.verify!("INVALID_VOUCHER");
                expect(verification.success).to.be.false;
                if (verification.success === false) {
                    expect(verification.error).to.equal("Invalid voucher code.");
                }
            }
        });

        it("allows same author to reuse their voucher", async () => {
            const community = createCommunity();
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.true;
            if (isChallengeInput(result)) {
                // First use
                const verification1 = await result.verify!("VOUCHER1");
                expect(verification1.success).to.be.true;

                // Second use by same author
                const verification2 = await result.verify!("VOUCHER1");
                expect(verification2.success).to.be.true;
            }
        });

        it("rejects voucher already redeemed by different author", async () => {
            const community = createCommunity();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            // First author redeems voucher
            const challengeRequestMessage1 = createChallengeRequestMessage({
                publication: { author: { address: "author1" } }
            });

            const result1 = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage1));

            expect(isChallengeInput(result1)).to.be.true;
            if (isChallengeInput(result1)) {
                const verification1 = await result1.verify!("VOUCHER1");
                expect(verification1.success).to.be.true;
            }

            // Second author tries to use same voucher
            const challengeRequestMessage2 = createChallengeRequestMessage({
                publication: { author: { address: "author2" } }
            });

            const result2 = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage2));

            expect(isChallengeInput(result2)).to.be.true;
            if (isChallengeInput(result2)) {
                const verification2 = await result2.verify!("VOUCHER1");
                expect(verification2.success).to.be.false;
                if (verification2.success === false) {
                    expect(verification2.error).to.equal("This voucher has already been redeemed by another author.");
                }
            }
        });

        it("handles pre-answered challenges correctly", async () => {
            const community = createCommunity();
            const challengeRequestMessage = createChallengeRequestMessage({
                challengeAnswers: ["VOUCHER1"]
            });
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.false;
            expect((result as ChallengeResultInput).success).to.be.true;
        });

        it("rejects pre-answered challenges with invalid voucher", async () => {
            const community = createCommunity();
            const challengeRequestMessage = createChallengeRequestMessage({
                challengeAnswers: ["INVALID_VOUCHER"]
            });
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.false;
            const challengeResult = result as ChallengeResultInput;
            expect(challengeResult.success).to.be.false;
            if (challengeResult.success === false) {
                expect(challengeResult.error).to.equal("Invalid voucher code.");
            }
        });
    });

    describe("custom error messages", () => {
        it("uses custom invalid voucher error message", async () => {
            const community = createCommunity({
                invalidVoucherError: "Custom invalid code message"
            });
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.true;
            if (isChallengeInput(result)) {
                const verification = await result.verify!("INVALID_VOUCHER");
                expect(verification.success).to.be.false;
                if (verification.success === false) {
                    expect(verification.error).to.equal("Custom invalid code message");
                }
            }
        });

        it("uses custom already redeemed error message", async () => {
            const community = createCommunity({
                alreadyRedeemedError: "Custom already used message"
            });
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            // First author redeems voucher
            const challengeRequestMessage1 = createChallengeRequestMessage({
                publication: { author: { address: "author1" } }
            });

            const result1 = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage1));

            if (isChallengeInput(result1)) {
                await result1.verify!("VOUCHER1");
            }

            // Second author tries same voucher
            const challengeRequestMessage2 = createChallengeRequestMessage({
                publication: { author: { address: "author2" } }
            });

            const result2 = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage2));

            expect(isChallengeInput(result2)).to.be.true;
            if (isChallengeInput(result2)) {
                const verification = await result2.verify!("VOUCHER1");
                expect(verification.success).to.be.false;
                if (verification.success === false) {
                    expect(verification.error).to.equal("Custom already used message");
                }
            }
        });
    });

    describe("file persistence", () => {
        it("persists voucher redemptions to file", async () => {
            const community = createCommunity();
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));

            if (isChallengeInput(result)) {
                await result.verify!("VOUCHER1");
            }

            // Check that state file was created
            const stateFilePath = path.join(
                tempDir,
                "communities",
                `${community.address}-challenge-data`,
                "voucher_redemption_states.json"
            );

            expect(fs.existsSync(stateFilePath)).to.be.true;

            const stateData = JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
            expect(stateData).to.have.property("VOUCHER1");
            expect(stateData.VOUCHER1).to.equal("12D3test123");
        });

        it("loads existing redemption state from file", async () => {
            const community = createCommunity();

            // Create state file manually
            const stateDir = path.join(tempDir, "communities", `${community.address}-challenge-data`);
            const stateFilePath = path.join(stateDir, "voucher_redemption_states.json");

            await fs.promises.mkdir(stateDir, { recursive: true });
            await fs.promises.writeFile(
                stateFilePath,
                JSON.stringify({
                    VOUCHER1: "existing_author"
                })
            );

            // Try to use already redeemed voucher
            const challengeRequestMessage = createChallengeRequestMessage({
                publication: { author: { address: "different_author" } }
            });
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.true;
            if (isChallengeInput(result)) {
                const verification = await result.verify!("VOUCHER1");
                expect(verification.success).to.be.false;
                if (verification.success === false) {
                    expect(verification.error).to.equal("This voucher has already been redeemed by another author.");
                }
            }
        });
    });

    describe("edge cases", () => {
        it("throws error when no vouchers configured", async () => {
            const community = createCommunity({ vouchers: "" });
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            await expect(
                challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage))
            ).rejects.toThrow("No vouchers configured");
        });

        it("handles whitespace in voucher list", async () => {
            const community = createCommunity({
                vouchers: " VOUCHER1 , VOUCHER2 , VOUCHER3 "
            });
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.true;
            if (isChallengeInput(result)) {
                const verification = await result.verify!("VOUCHER2");
                expect(verification.success).to.be.true;
            }
        });

        it("filters out empty voucher codes", async () => {
            const community = createCommunity({
                vouchers: "VOUCHER1,,VOUCHER2,"
            });
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.true;
            if (isChallengeInput(result)) {
                const verification1 = await result.verify!("VOUCHER1");
                expect(verification1.success).to.be.true;

                const verification2 = await result.verify!("VOUCHER2");
                expect(verification2.success).to.be.true;
            }
        });
    });

    describe("concurrent redemptions", () => {
        const getPendingChallenge = async (
            challengeFile: ReturnType<typeof voucherChallenge>,
            community: ReturnType<typeof createCommunity>,
            authorAddress: string
        ): Promise<ChallengeInput> => {
            const challengeRequestMessage = createChallengeRequestMessage({
                publication: { author: { address: authorAddress } }
            });
            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));
            if (!isChallengeInput(result)) throw Error("Expected a pending challenge");
            return result;
        };

        const readStateFile = async (community: ReturnType<typeof createCommunity>): Promise<Record<string, string>> => {
            const stateFilePath = path.join(
                tempDir,
                "communities",
                `${community.address}-challenge-data`,
                "voucher_redemption_states.json"
            );
            return JSON.parse(await fs.promises.readFile(stateFilePath, "utf8"));
        };

        it("rejects a voucher redeemed by another author whose challenge was pending at the same time", async () => {
            const community = createCommunity();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            // Both authors request a challenge before either answers
            const challenge1 = await getPendingChallenge(challengeFile, community, "author1");
            const challenge2 = await getPendingChallenge(challengeFile, community, "author2");

            const verification1 = await challenge1.verify!("VOUCHER1");
            expect(verification1.success).to.be.true;

            const verification2 = await challenge2.verify!("VOUCHER1");
            expect(verification2.success).to.be.false;
            if (verification2.success === false) {
                expect(verification2.error).to.equal("This voucher has already been redeemed by another author.");
            }

            expect(await readStateFile(community)).to.deep.equal({ VOUCHER1: "author1" });
        });

        it("keeps every redemption when pending challenges are answered with different vouchers", async () => {
            const community = createCommunity();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const challenge1 = await getPendingChallenge(challengeFile, community, "author1");
            const challenge2 = await getPendingChallenge(challengeFile, community, "author2");

            const [verification1, verification2] = await Promise.all([challenge1.verify!("VOUCHER1"), challenge2.verify!("VOUCHER2")]);
            expect(verification1.success).to.be.true;
            expect(verification2.success).to.be.true;

            expect(await readStateFile(community)).to.deep.equal({ VOUCHER1: "author1", VOUCHER2: "author2" });
        });

        it("accepts a pre-answered voucher for only one of two simultaneous requests", async () => {
            const community = createCommunity();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const results = await Promise.all(
                ["author1", "author2"].map((authorAddress) =>
                    challengeFile.getChallenge(
                        getChallengeArgs(
                            community,
                            createChallengeRequestMessage({
                                publication: { author: { address: authorAddress } },
                                challengeAnswers: ["VOUCHER1"]
                            })
                        )
                    )
                )
            );

            const successes = results.filter((result) => !isChallengeInput(result) && result.success === true);
            expect(successes).to.have.length(1);
            expect(Object.keys(await readStateFile(community))).to.deep.equal(["VOUCHER1"]);
        });
    });

    describe("author identity", () => {
        interface RuntimeAuthor {
            address: string;
            publicKey: string;
            name?: string;
        }

        const verifyAs = async (
            challengeFile: ReturnType<typeof voucherChallenge>,
            community: ReturnType<typeof createCommunity>,
            author: RuntimeAuthor,
            voucher: string
        ): Promise<ChallengeResultInput> => {
            const challengeRequestMessage = createChallengeRequestMessage({ publication: { author } });
            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));
            if (!isChallengeInput(result)) throw Error("Expected a pending challenge");
            return result.verify!(voucher);
        };

        const stateFilePath = (community: ReturnType<typeof createCommunity>): string =>
            path.join(tempDir, "communities", `${community.address}-challenge-data`, "voucher_redemption_states.json");

        // pkc-js sets author.address to author.name when the author has a domain name, else to the signer's public key
        const aliceWithoutName: RuntimeAuthor = { address: "12D3aliceKey", publicKey: "12D3aliceKey" };
        const aliceWithName: RuntimeAuthor = { name: "alice.bso", address: "alice.bso", publicKey: "12D3aliceKey" };

        it("accepts the voucher holder after they set an author name", async () => {
            const community = createCommunity();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            expect((await verifyAs(challengeFile, community, aliceWithoutName, "VOUCHER1")).success).to.be.true;
            expect((await verifyAs(challengeFile, community, aliceWithName, "VOUCHER1")).success).to.be.true;
        });

        it("accepts the voucher holder after they remove their author name", async () => {
            const community = createCommunity();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            expect((await verifyAs(challengeFile, community, aliceWithName, "VOUCHER1")).success).to.be.true;
            expect((await verifyAs(challengeFile, community, aliceWithoutName, "VOUCHER1")).success).to.be.true;
        });

        it("rejects another signer that presents the holder's author name", async () => {
            const community = createCommunity();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);
            const otherSignerWithAliceName: RuntimeAuthor = { name: "alice.bso", address: "alice.bso", publicKey: "12D3otherKey" };

            expect((await verifyAs(challengeFile, community, aliceWithName, "VOUCHER1")).success).to.be.true;
            const verification = await verifyAs(challengeFile, community, otherSignerWithAliceName, "VOUCHER1");
            expect(verification.success).to.be.false;
            if (verification.success === false) {
                expect(verification.error).to.equal("This voucher has already been redeemed by another author.");
            }
        });

        it("rebinds a voucher stored under an author name by older versions to the holder's public key", async () => {
            const community = createCommunity();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);
            await fs.promises.mkdir(path.dirname(stateFilePath(community)), { recursive: true });
            await fs.promises.writeFile(stateFilePath(community), JSON.stringify({ VOUCHER1: "alice.bso" }));

            expect((await verifyAs(challengeFile, community, aliceWithName, "VOUCHER1")).success).to.be.true;
            expect(JSON.parse(await fs.promises.readFile(stateFilePath(community), "utf8"))).to.deep.equal({ VOUCHER1: "12D3aliceKey" });
        });
    });
});
