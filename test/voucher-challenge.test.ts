import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
            signer: {
                address: "test-community-address"
            },
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

        describe("voucher stored under an author name by older versions", () => {
            // A community whose node resolves author names, with alice.bso pointing to Alice's key
            const createResolvingCommunity = (resolveAuthorNames = true, resolveAuthorName = async () => "12D3aliceKey") => {
                const community = createCommunity();
                return { ...community, _pkc: { ...community._pkc, resolveAuthorNames, resolveAuthorName: vi.fn(resolveAuthorName) } };
            };

            const writeLegacyState = async (community: ReturnType<typeof createCommunity>): Promise<void> => {
                await fs.promises.mkdir(path.dirname(stateFilePath(community)), { recursive: true });
                await fs.promises.writeFile(stateFilePath(community), JSON.stringify({ VOUCHER1: "alice.bso" }));
            };

            const otherSignerWithAliceName: RuntimeAuthor = { name: "alice.bso", address: "alice.bso", publicKey: "12D3otherKey" };

            it("rebinds the voucher to the holder's public key when the name they present resolves to it", async () => {
                const community = createResolvingCommunity();
                const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);
                await writeLegacyState(community);

                expect((await verifyAs(challengeFile, community, aliceWithName, "VOUCHER1")).success).to.be.true;
                expect(community._pkc.resolveAuthorName).toHaveBeenCalledWith({ address: "alice.bso" });
                expect(JSON.parse(await fs.promises.readFile(stateFilePath(community), "utf8"))).to.deep.equal({ VOUCHER1: "12D3aliceKey" });
            });

            it("rejects another signer that presents the stored name when the name resolves to a different public key", async () => {
                const community = createResolvingCommunity();
                const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);
                await writeLegacyState(community);

                const verification = await verifyAs(challengeFile, community, otherSignerWithAliceName, "VOUCHER1");
                expect(verification.success).to.be.false;
                if (verification.success === false) {
                    expect(verification.error).to.equal("This voucher has already been redeemed by another author.");
                }
                expect(JSON.parse(await fs.promises.readFile(stateFilePath(community), "utf8"))).to.deep.equal({ VOUCHER1: "alice.bso" });
                expect((await verifyAs(challengeFile, community, aliceWithName, "VOUCHER1")).success).to.be.true;
            });

            it("keeps the voucher bound to the name when the node does not resolve author names", async () => {
                const community = createResolvingCommunity(false);
                const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);
                await writeLegacyState(community);

                // The node cannot tell who holds the name, so, as older versions did, it accepts any author presenting it
                expect((await verifyAs(challengeFile, community, otherSignerWithAliceName, "VOUCHER1")).success).to.be.true;
                expect(JSON.parse(await fs.promises.readFile(stateFilePath(community), "utf8"))).to.deep.equal({ VOUCHER1: "alice.bso" });
                expect((await verifyAs(challengeFile, community, aliceWithName, "VOUCHER1")).success).to.be.true;
                expect(community._pkc.resolveAuthorName).not.toHaveBeenCalled();
            });

            it("accepts the holder when the stored name resolves to their public key", async () => {
                const community = createResolvingCommunity();
                const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);
                await writeLegacyState(community);

                expect((await verifyAs(challengeFile, community, aliceWithoutName, "VOUCHER1")).success).to.be.true;
                expect(community._pkc.resolveAuthorName).toHaveBeenCalledWith({ address: "alice.bso" });
                expect(JSON.parse(await fs.promises.readFile(stateFilePath(community), "utf8"))).to.deep.equal({ VOUCHER1: "12D3aliceKey" });
            });

            it("rejects another author when the stored name resolves to a different public key", async () => {
                const community = createResolvingCommunity();
                const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);
                await writeLegacyState(community);
                const bob: RuntimeAuthor = { address: "12D3bobKey", publicKey: "12D3bobKey" };

                const verification = await verifyAs(challengeFile, community, bob, "VOUCHER1");
                expect(verification.success).to.be.false;
                if (verification.success === false) {
                    expect(verification.error).to.equal("This voucher has already been redeemed by another author.");
                }
                expect(JSON.parse(await fs.promises.readFile(stateFilePath(community), "utf8"))).to.deep.equal({ VOUCHER1: "alice.bso" });
            });

            it("does not resolve the stored name when the node does not resolve author names", async () => {
                const community = createResolvingCommunity(false);
                const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);
                await writeLegacyState(community);

                expect((await verifyAs(challengeFile, community, aliceWithoutName, "VOUCHER1")).success).to.be.false;
                expect(community._pkc.resolveAuthorName).not.toHaveBeenCalled();
            });

            it("keeps a rebinding made by another author while the name was being resolved", async () => {
                // alice.bso now points to another key, but the first resolution returns Alice's key from before the move
                const community = createResolvingCommunity(true, async () => "12D3otherKey");
                const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);
                await writeLegacyState(community);
                community._pkc.resolveAuthorName.mockImplementationOnce(async () => {
                    // Another redemption runs while the name resolves, so the lock is not held during resolution
                    expect((await verifyAs(challengeFile, community, otherSignerWithAliceName, "VOUCHER1")).success).to.be.true;
                    return "12D3aliceKey";
                });

                expect((await verifyAs(challengeFile, community, aliceWithoutName, "VOUCHER1")).success).to.be.false;
                expect(JSON.parse(await fs.promises.readFile(stateFilePath(community), "utf8"))).to.deep.equal({ VOUCHER1: "12D3otherKey" });
            });

            it("rejects the author without throwing when the stored name cannot be resolved", async () => {
                const community = createResolvingCommunity(true, async () => {
                    throw Error("resolver unavailable");
                });
                const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);
                await writeLegacyState(community);

                expect((await verifyAs(challengeFile, community, aliceWithoutName, "VOUCHER1")).success).to.be.false;
                expect(JSON.parse(await fs.promises.readFile(stateFilePath(community), "utf8"))).to.deep.equal({ VOUCHER1: "alice.bso" });
            });
        });
    });

    describe("community address changes", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        const verifyAs = async (
            challengeFile: ReturnType<typeof voucherChallenge>,
            community: ReturnType<typeof createCommunity>,
            authorAddress: string,
            voucher: string
        ): Promise<ChallengeResultInput> => {
            const challengeRequestMessage = createChallengeRequestMessage({
                publication: { author: { address: authorAddress } }
            });
            const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));
            if (!isChallengeInput(result)) throw Error("Expected a pending challenge");
            return result.verify!(voucher);
        };

        const stateFilePathFor = (communityAddress: string): string =>
            path.join(tempDir, "communities", `${communityAddress}-challenge-data`, "voucher_redemption_states.json");

        const writeStateFile = async (communityAddress: string, state: Record<string, string>, modifiedAt: Date): Promise<void> => {
            const filePath = stateFilePathFor(communityAddress);
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.writeFile(filePath, JSON.stringify(state));
            await fs.promises.utimes(filePath, modifiedAt, modifiedAt);
        };

        const hoursAgo = (hours: number): Date => new Date(Date.now() - hours * 60 * 60 * 1000);

        // pkc-js keeps community.signer.address and changes community.address when the owner sets or removes a domain name
        const createKeyAddressedCommunity = () => {
            const community = createCommunity();
            community.address = "12D3communityKey";
            community.signer.address = "12D3communityKey";
            return community;
        };

        it("keeps redemptions after the owner sets a domain name on the community", async () => {
            const community = createKeyAddressedCommunity();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            expect((await verifyAs(challengeFile, community, "author1", "VOUCHER1")).success).to.be.true;

            community.address = "my-community.bso";

            const verification = await verifyAs(challengeFile, community, "author2", "VOUCHER1");
            expect(verification.success).to.be.false;
            if (verification.success === false) {
                expect(verification.error).to.equal("This voucher has already been redeemed by another author.");
            }

            community.address = "12D3communityKey";
            expect((await verifyAs(challengeFile, community, "author2", "VOUCHER2")).success).to.be.true;
            community.address = "my-community.bso";
            expect((await verifyAs(challengeFile, community, "author3", "VOUCHER2")).success).to.be.false;
        });

        it("merges the state an older version saved under the community's domain name", async () => {
            const community = createKeyAddressedCommunity();
            community.address = "my-community.bso";
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            // Older versions keyed the file by community.address: redemptions from before the domain was set,
            // and the file for the domain name, written after it
            await writeStateFile("12D3communityKey", { VOUCHER2: "earlier_author" }, hoursAgo(2));
            await writeStateFile("my-community.bso", { VOUCHER1: "author1" }, hoursAgo(1));

            expect((await verifyAs(challengeFile, community, "author2", "VOUCHER1")).success).to.be.false;
            expect((await verifyAs(challengeFile, community, "author2", "VOUCHER2")).success).to.be.false;
            expect((await verifyAs(challengeFile, community, "earlier_author", "VOUCHER2")).success).to.be.true;

            expect(JSON.parse(await fs.promises.readFile(stateFilePathFor("12D3communityKey"), "utf8"))).to.deep.equal({
                VOUCHER1: "author1",
                VOUCHER2: "earlier_author"
            });
            expect(fs.existsSync(stateFilePathFor("my-community.bso"))).to.be.false;

            community.address = "renamed-community.bso";
            expect((await verifyAs(challengeFile, community, "author3", "VOUCHER1")).success).to.be.false;
            expect((await verifyAs(challengeFile, community, "author3", "VOUCHER2")).success).to.be.false;
        });

        it("keeps redemptions from a file an older version left under a previous domain name", async () => {
            const community = createKeyAddressedCommunity();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            await writeStateFile("old-name.bso", { VOUCHER2: "earlier_author" }, hoursAgo(2));
            await writeStateFile("12D3communityKey", { VOUCHER1: "author1" }, hoursAgo(1));

            // The owner goes back to the domain name the community had before
            community.address = "old-name.bso";

            expect((await verifyAs(challengeFile, community, "author2", "VOUCHER1")).success).to.be.false;
            expect((await verifyAs(challengeFile, community, "author2", "VOUCHER2")).success).to.be.false;
            expect((await verifyAs(challengeFile, community, "earlier_author", "VOUCHER2")).success).to.be.true;
        });

        it.each([
            { newerFile: "the file for the domain name", domainFileAge: 1, keyFileAge: 2, holder: "author2", otherAuthor: "author1" },
            { newerFile: "the signer-keyed file", domainFileAge: 2, keyFileAge: 1, holder: "author1", otherAuthor: "author2" }
        ])("keeps the binding from $newerFile when both files hold the same voucher", async ({ domainFileAge, keyFileAge, holder, otherAuthor }) => {
            const community = createKeyAddressedCommunity();
            community.address = "my-community.bso";
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            await writeStateFile("12D3communityKey", { VOUCHER1: "author1" }, hoursAgo(keyFileAge));
            await writeStateFile("my-community.bso", { VOUCHER1: "author2" }, hoursAgo(domainFileAge));

            expect((await verifyAs(challengeFile, community, otherAuthor, "VOUCHER1")).success).to.be.false;
            expect((await verifyAs(challengeFile, community, holder, "VOUCHER1")).success).to.be.true;
        });

        it("repeats the merge when the file for the domain name could not be removed", async () => {
            const community = createKeyAddressedCommunity();
            community.address = "my-community.bso";
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            await writeStateFile("12D3communityKey", { VOUCHER2: "earlier_author" }, hoursAgo(2));
            await writeStateFile("my-community.bso", { VOUCHER1: "author1" }, hoursAgo(1));

            // A crash after the merged state was saved leaves the file for the domain name in place
            vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));
            await expect(verifyAs(challengeFile, community, "author2", "VOUCHER3")).rejects.toThrow("EACCES");
            vi.restoreAllMocks();

            expect((await verifyAs(challengeFile, community, "author2", "VOUCHER1")).success).to.be.false;
            expect((await verifyAs(challengeFile, community, "author2", "VOUCHER2")).success).to.be.false;
            expect((await verifyAs(challengeFile, community, "author2", "VOUCHER3")).success).to.be.true;
            expect(JSON.parse(await fs.promises.readFile(stateFilePathFor("12D3communityKey"), "utf8"))).to.deep.equal({
                VOUCHER1: "author1",
                VOUCHER2: "earlier_author",
                VOUCHER3: "author2"
            });
            expect(fs.existsSync(stateFilePathFor("my-community.bso"))).to.be.false;
        });
    });

    describe("failed state file writes", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("keeps earlier redemptions when a save fails part way through", async () => {
            const community = createCommunity();
            const challengeFile = voucherChallenge({ challengeSettings: community.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);
            const verifyAs = async (authorAddress: string, voucher: string): Promise<ChallengeResultInput> => {
                const challengeRequestMessage = createChallengeRequestMessage({
                    publication: { author: { address: authorAddress } }
                });
                const result = await challengeFile.getChallenge(getChallengeArgs(community, challengeRequestMessage));
                if (!isChallengeInput(result)) throw Error("Expected a pending challenge");
                return result.verify!(voucher);
            };
            const stateFilePath = path.join(tempDir, "communities", `${community.address}-challenge-data`, "voucher_redemption_states.json");

            expect((await verifyAs("author1", "VOUCHER1")).success).to.be.true;

            // fs.promises.writeFile truncates its target before writing, so a crash or a full disk leaves it empty
            const writeFile = fs.promises.writeFile;
            vi.spyOn(fs.promises, "writeFile").mockImplementationOnce(async (file) => {
                await writeFile(file, "");
                throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
            });
            await expect(verifyAs("author2", "VOUCHER2")).rejects.toThrow("ENOSPC");
            vi.restoreAllMocks();

            const verification = await verifyAs("author3", "VOUCHER1");
            expect(verification.success).to.be.false;
            expect(JSON.parse(await fs.promises.readFile(stateFilePath, "utf8"))).to.deep.equal({ VOUCHER1: "author1" });
            expect(await fs.promises.readdir(path.dirname(stateFilePath))).to.deep.equal(["voucher_redemption_states.json"]);
        });
    });
});
