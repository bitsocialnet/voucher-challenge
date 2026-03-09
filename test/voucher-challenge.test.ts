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
        tempDir = path.join(tmpdir(), "plebbit-test-" + Math.random().toString(36));
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
                address: "12D3test123"
            },
            content: "test content",
            timestamp: 1234567890,
            subplebbitAddress: "subplebbitAddress"
        };

        return {
            comment: {
                ...defaultPublication,
                ...(overrides.publication || {})
            },
            ...(remeda.omit(overrides, ["publication"]) || {})
        };
    };

    const createSubplebbit = (options: VoucherOptions = {}) => {
        const defaultOptions: VoucherOptions = {
            question: "What is your voucher code?",
            vouchers: "VOUCHER1,VOUCHER2,VOUCHER3"
        };

        return {
            address: "test-subplebbit-address",
            _plebbit: {
                dataPath: tempDir
            },
            settings: {
                challenges: [
                    {
                        name: "voucher",
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
        subplebbit: ReturnType<typeof createSubplebbit>,
        challengeRequestMessage: ReturnType<typeof createChallengeRequestMessage>,
        challengeIndex = 0
    ): GetChallengeArgsInput => ({
        challengeSettings: subplebbit.settings.challenges[0] as GetChallengeArgsInput["challengeSettings"],
        challengeRequestMessage: challengeRequestMessage as unknown as GetChallengeArgsInput["challengeRequestMessage"],
        challengeIndex,
        subplebbit: subplebbit as unknown as GetChallengeArgsInput["subplebbit"]
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
            const subplebbit = createSubplebbit();
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.true;
            if (isChallengeInput(result)) {
                const verification = await result.verify!("VOUCHER1");
                expect(verification.success).to.be.true;
            }
        });

        it("rejects invalid voucher codes", async () => {
            const subplebbit = createSubplebbit();
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage));

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
            const subplebbit = createSubplebbit();
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage));

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
            const subplebbit = createSubplebbit();
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            // First author redeems voucher
            const challengeRequestMessage1 = createChallengeRequestMessage({
                publication: { author: { address: "author1" } }
            });

            const result1 = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage1));

            expect(isChallengeInput(result1)).to.be.true;
            if (isChallengeInput(result1)) {
                const verification1 = await result1.verify!("VOUCHER1");
                expect(verification1.success).to.be.true;
            }

            // Second author tries to use same voucher
            const challengeRequestMessage2 = createChallengeRequestMessage({
                publication: { author: { address: "author2" } }
            });

            const result2 = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage2));

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
            const subplebbit = createSubplebbit();
            const challengeRequestMessage = createChallengeRequestMessage({
                challengeAnswers: ["VOUCHER1"]
            });
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.false;
            expect((result as ChallengeResultInput).success).to.be.true;
        });

        it("rejects pre-answered challenges with invalid voucher", async () => {
            const subplebbit = createSubplebbit();
            const challengeRequestMessage = createChallengeRequestMessage({
                challengeAnswers: ["INVALID_VOUCHER"]
            });
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage));

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
            const subplebbit = createSubplebbit({
                invalidVoucherError: "Custom invalid code message"
            });
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage));

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
            const subplebbit = createSubplebbit({
                alreadyRedeemedError: "Custom already used message"
            });
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            // First author redeems voucher
            const challengeRequestMessage1 = createChallengeRequestMessage({
                publication: { author: { address: "author1" } }
            });

            const result1 = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage1));

            if (isChallengeInput(result1)) {
                await result1.verify!("VOUCHER1");
            }

            // Second author tries same voucher
            const challengeRequestMessage2 = createChallengeRequestMessage({
                publication: { author: { address: "author2" } }
            });

            const result2 = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage2));

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
            const subplebbit = createSubplebbit();
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage));

            if (isChallengeInput(result)) {
                await result.verify!("VOUCHER1");
            }

            // Check that state file was created
            const stateFilePath = path.join(
                tempDir,
                "subplebbits",
                `${subplebbit.address}-challenge-data`,
                "voucher_redemption_states.json"
            );

            expect(fs.existsSync(stateFilePath)).to.be.true;

            const stateData = JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
            expect(stateData).to.have.property("VOUCHER1");
            expect(stateData.VOUCHER1).to.equal("12D3test123");
        });

        it("loads existing redemption state from file", async () => {
            const subplebbit = createSubplebbit();

            // Create state file manually
            const stateDir = path.join(tempDir, "subplebbits", `${subplebbit.address}-challenge-data`);
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
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage));

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
            const subplebbit = createSubplebbit({ vouchers: "" });
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            await expect(
                challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage))
            ).rejects.toThrow("No vouchers configured");
        });

        it("handles whitespace in voucher list", async () => {
            const subplebbit = createSubplebbit({
                vouchers: " VOUCHER1 , VOUCHER2 , VOUCHER3 "
            });
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.true;
            if (isChallengeInput(result)) {
                const verification = await result.verify!("VOUCHER2");
                expect(verification.success).to.be.true;
            }
        });

        it("filters out empty voucher codes", async () => {
            const subplebbit = createSubplebbit({
                vouchers: "VOUCHER1,,VOUCHER2,"
            });
            const challengeRequestMessage = createChallengeRequestMessage();
            const challengeFile = voucherChallenge({ challengeSettings: subplebbit.settings.challenges[0] } as Parameters<typeof voucherChallenge>[0]);

            const result = await challengeFile.getChallenge(getChallengeArgs(subplebbit, challengeRequestMessage));

            expect(isChallengeInput(result)).to.be.true;
            if (isChallengeInput(result)) {
                const verification1 = await result.verify!("VOUCHER1");
                expect(verification1.success).to.be.true;

                const verification2 = await result.verify!("VOUCHER2");
                expect(verification2.success).to.be.true;
            }
        });
    });
});
