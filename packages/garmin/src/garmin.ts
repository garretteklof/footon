import { homedir } from "node:os";
import { join } from "node:path";
import { GarminAuthError, GarminError } from "./errors";
import { createActivitiesApi } from "./api/activities";
import { createChallengesApi } from "./api/badges";
import { createBodyCompositionApi } from "./api/bodyComposition";
import { createCalendarApi } from "./api/calendar";
import { createCoursesApi } from "./api/courses";
import { createDevicesApi } from "./api/devices";
import { createGearApi } from "./api/gear";
import { createGoalsApi } from "./api/goals";
import { createGolfApi } from "./api/golf";
import { createMetricsApi } from "./api/metrics";
import { createMiscApi } from "./api/misc";
import { createNutritionApi } from "./api/nutrition";
import { createProfileApi } from "./api/userProfile";
import { createTrainingPlansApi } from "./api/trainingPlans";
import { createWeightApi } from "./api/weight";
import { createWellnessApi } from "./api/wellness";
import { createWorkoutsApi } from "./api/workouts";
import { createWomensHealthApi } from "./api/womensHealth";
import {
    login as ssoLogin,
    refreshToken,
    resumeLogin as ssoResumeLogin,
    type DiContext,
    type DiTokens,
    type LoginResult,
    type MfaChallenge,
} from "./auth/di";
import {
    authorizationHeader,
    isExpired,
    refreshExpired,
    validateTokens,
    type Tokens,
} from "./auth/tokens";
import { FileTokenStore, type TokenStore } from "./auth/token-store";
import {
    SOCIAL_PROFILE_ENDPOINT,
    USER_SETTINGS_ENDPOINT,
} from "./constants/endpoints";
import { Fetcher, parseJsonResponse } from "./http/fetcher";
import type { ApiOptions, ApiTransferClient } from "./types/api";
import type { SocialProfile, UserSettings } from "./types/userProfile";

export interface GarminOptions {
    tokenStore?: TokenStore;
    /** Directory or JSON file for token persistence. Defaults to `~/.garmints`. */
    tokenPath?: string;
    isCn?: boolean;
    timeoutMs?: number;
    retries?: number;
    backoffMs?: number;
    fetchImpl?: typeof fetch;
}

type TrainingApi = ReturnType<typeof createMetricsApi> &
    ReturnType<typeof createTrainingPlansApi>;

const API_USER_AGENT = "GCM-Android-5.23";
const TRANSFER_TIMEOUT_MS = 60_000;

export class Garmin {
    readonly #domain: string;
    readonly #tokenStore: TokenStore;
    readonly #fetcher: Fetcher;
    readonly #apiClient: ApiTransferClient;
    #tokens: Tokens | null = null;
    #pendingMfa: MfaChallenge | null = null;
    // A generation number rejects results from an earlier authentication state.
    #authGeneration = 0;
    #refreshing: Promise<Tokens> | null = null;
    // Queue token-store operations so logout clears tokens after any active write.
    #tokenStoreQueue: Promise<void> = Promise.resolve();
    #profile: Promise<SocialProfile> | null = null;
    #settings: Promise<UserSettings> | null = null;

    readonly profile: ReturnType<typeof createProfileApi>;
    readonly wellness: ReturnType<typeof createWellnessApi>;
    readonly activities: ReturnType<typeof createActivitiesApi>;
    readonly training: TrainingApi;
    readonly workouts: ReturnType<typeof createWorkoutsApi>;
    readonly courses: ReturnType<typeof createCoursesApi>;
    readonly calendar: ReturnType<typeof createCalendarApi>;
    readonly gear: ReturnType<typeof createGearApi>;
    readonly devices: ReturnType<typeof createDevicesApi>;
    readonly challenges: ReturnType<typeof createChallengesApi>;
    readonly weight: ReturnType<typeof createWeightApi>;
    readonly bodyComposition: ReturnType<typeof createBodyCompositionApi>;
    readonly womensHealth: ReturnType<typeof createWomensHealthApi>;
    readonly goals: ReturnType<typeof createGoalsApi>;
    readonly golf: ReturnType<typeof createGolfApi>;
    readonly nutrition: ReturnType<typeof createNutritionApi>;
    readonly misc: ReturnType<typeof createMiscApi>;

    constructor(options: GarminOptions = {}) {
        this.#domain = options.isCn ? "garmin.cn" : "garmin.com";
        this.#tokenStore =
            options.tokenStore ??
            new FileTokenStore(
                options.tokenPath ?? join(homedir(), ".garmints"),
            );
        this.#fetcher = new Fetcher({
            timeoutMs: options.timeoutMs ?? 15_000,
            retries: options.retries ?? 2,
            backoffMs: options.backoffMs,
            fetchImpl: options.fetchImpl,
        });
        this.#apiClient = {
            connectapi: <T = unknown>(
                path: string,
                requestOptions?: ApiOptions,
            ) => this.request<T>(path, requestOptions),
            download: (path, requestOptions) =>
                this.#download(path, requestOptions),
            upload: (file, filename, path, requestOptions) =>
                this.#upload(file, filename, path, requestOptions),
        };

        const profileContext = {
            client: this.#apiClient,
            getUserProfile: () => this.#socialProfile(),
            getUserSettings: () => this.#userSettings(),
        };
        const displayName = async () =>
            (await this.#socialProfile()).displayName;

        this.profile = createProfileApi(profileContext);
        this.bodyComposition = createBodyCompositionApi({
            client: this.#apiClient,
        });
        this.devices = createDevicesApi({ client: this.#apiClient });
        this.wellness = createWellnessApi({
            ...profileContext,
            displayName,
            getBodyComposition: this.bodyComposition.getRange,
        });
        this.activities = createActivitiesApi({
            client: this.#apiClient,
            displayName,
        });
        this.training = {
            ...createMetricsApi({ client: this.#apiClient, displayName }),
            ...createTrainingPlansApi({ client: this.#apiClient }),
        };
        this.workouts = createWorkoutsApi({
            client: this.#apiClient,
            getLastUsedDevice: this.devices.getLastUsed,
        });
        this.courses = createCoursesApi({ client: this.#apiClient });
        this.calendar = createCalendarApi({ client: this.#apiClient });
        this.gear = createGearApi({ client: this.#apiClient });
        this.challenges = createChallengesApi({ client: this.#apiClient });
        this.weight = createWeightApi({ client: this.#apiClient });
        this.womensHealth = createWomensHealthApi({
            client: this.#apiClient,
            getUserProfile: () => this.#socialProfile(),
        });
        this.goals = createGoalsApi({ client: this.#apiClient });
        this.golf = createGolfApi({ client: this.#apiClient });
        this.nutrition = createNutritionApi({
            client: this.#apiClient,
            hasConnectPlus: () => this.profile.hasConnectPlus(),
        });
        this.misc = createMiscApi({ client: this.#apiClient });
    }

    async login(email: string, password: string): Promise<LoginResult> {
        const attempt = this.#advanceAuthGeneration();
        this.#clearCaches();
        this.#pendingMfa = null;
        const result = await ssoLogin(email, password, this.#authContext);
        this.#assertAuthGeneration(attempt);
        if (result.status === "success") {
            const generation = this.#advanceAuthGeneration();
            await this.#persist(result.tokens, generation);
            this.#pendingMfa = null;
        } else {
            this.#pendingMfa = result.challenge;
        }
        return result;
    }

    async resumeLogin(code: string): Promise<void> {
        if (!this.#pendingMfa)
            throw new GarminAuthError("No MFA login is pending");
        const attempt = this.#authGeneration;
        const challenge = this.#pendingMfa;
        const tokens = await ssoResumeLogin(challenge, code, this.#authContext);
        this.#assertAuthGeneration(attempt);
        const generation = this.#advanceAuthGeneration();
        await this.#persist(tokens, generation);
        this.#pendingMfa = null;
    }

    async loadTokens(): Promise<boolean> {
        this.#clearCaches();
        const attempt = this.#advanceAuthGeneration();
        const tokens = validateTokens(
            await this.#queueTokenStore(() => this.#tokenStore.load()),
        );
        if (this.#authGeneration !== attempt) return false;
        if (!tokens) return false;
        this.#advanceAuthGeneration();
        this.#tokens = tokens;
        return true;
    }

    refreshTokens(options: { withinMs?: number } = {}): Promise<DiTokens> {
        return this.#ensureFresh(
            Math.max(60, Math.ceil((options.withinMs ?? 0) / 1000)),
        );
    }

    async logout(): Promise<void> {
        this.#advanceAuthGeneration();
        this.#clearCaches();
        this.#tokens = null;
        this.#pendingMfa = null;
        await this.#queueTokenStore(() => this.#tokenStore.clear());
    }

    /** Sends an authenticated request to a relative Connect API path. Returns `null` for an empty response. */
    async request<T = unknown>(
        path: string,
        options: ApiOptions = {},
    ): Promise<T | null> {
        return parseJsonResponse<T>(await this.#apiRequest(path, options));
    }

    get #authContext(): DiContext {
        return { fetcher: this.#fetcher, domain: this.#domain };
    }

    #clearCaches(): void {
        this.#profile = null;
        this.#settings = null;
    }

    async #persist(tokens: Tokens, generation: number): Promise<void> {
        const valid = validateTokens(tokens);
        if (!valid)
            throw new GarminAuthError(
                "Garmin returned an invalid DI token pair",
            );
        await this.#queueTokenStore(async () => {
            this.#assertAuthGeneration(generation);
            await this.#tokenStore.save(valid);
            this.#assertAuthGeneration(generation);
        });
        this.#assertAuthGeneration(generation);
        this.#tokens = valid;
    }

    #advanceAuthGeneration(): number {
        this.#authGeneration++;
        this.#refreshing = null;
        return this.#authGeneration;
    }

    #assertAuthGeneration(generation: number): void {
        if (this.#authGeneration !== generation) {
            throw new GarminAuthError(
                "Authentication state changed before the operation completed",
            );
        }
    }

    #queueTokenStore<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.#tokenStoreQueue.then(operation);
        this.#tokenStoreQueue = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    async #ensureFresh(marginSeconds = 60): Promise<Tokens> {
        const current = this.#tokens;
        if (!current)
            throw new GarminAuthError(
                "Not authenticated: call login() or loadTokens() first",
            );
        if (!isExpired(current, marginSeconds)) return current;
        if (refreshExpired(current))
            throw new GarminAuthError("Refresh token expired; log in again");
        if (this.#refreshing) return this.#refreshing;
        const generation = this.#authGeneration;
        const refreshing = refreshToken(current, this.#authContext).then(
            async (tokens) => {
                await this.#queueTokenStore(async () => {
                    this.#assertAuthGeneration(generation);
                    await this.#tokenStore.save(tokens);
                    this.#assertAuthGeneration(generation);
                });
                this.#assertAuthGeneration(generation);
                this.#tokens = tokens;
                return tokens;
            },
        );
        this.#refreshing = refreshing;
        try {
            return await refreshing;
        } finally {
            if (this.#refreshing === refreshing) this.#refreshing = null;
        }
    }

    #url(path: string): string {
        if (!path.startsWith("/") || path.startsWith("//")) {
            throw new GarminError(
                "Garmin API paths must begin with one slash and be relative to Connect API",
            );
        }
        return `https://connectapi.${this.#domain}${path}`;
    }

    async #apiRequest(
        path: string,
        options: ApiOptions = {},
    ): Promise<Response> {
        const tokens = await this.#ensureFresh();
        const headers = new Headers(options.headers);
        headers.set("authorization", authorizationHeader(tokens));
        headers.set("User-Agent", API_USER_AGENT);
        headers.set("Accept", "application/json");
        return this.#fetcher.request(this.#url(path), {
            method: options.method,
            params: options.params,
            json: options.json,
            timeoutMs: options.timeoutMs,
            headers,
        });
    }

    async #download(
        path: string,
        options: ApiOptions = {},
    ): Promise<Uint8Array> {
        const response = await this.#apiRequest(path, {
            ...options,
            timeoutMs: options.timeoutMs ?? TRANSFER_TIMEOUT_MS,
        });
        return new Uint8Array(await response.arrayBuffer());
    }

    async #upload(
        file: Blob,
        filename: string,
        path = "/upload-service/upload",
        options: Pick<ApiOptions, "timeoutMs" | "headers"> = {},
    ): Promise<unknown> {
        const tokens = await this.#ensureFresh();
        const form = new FormData();
        form.append("file", file, filename);
        const headers = new Headers({ "User-Agent": API_USER_AGENT });
        new Headers(options.headers).forEach((value, name) =>
            headers.set(name, value),
        );
        headers.set("authorization", authorizationHeader(tokens));
        const response = await this.#fetcher.request(this.#url(path), {
            method: "POST",
            body: form,
            timeoutMs: options.timeoutMs ?? TRANSFER_TIMEOUT_MS,
            headers,
        });
        return parseJsonResponse(response);
    }

    async #socialProfile(): Promise<SocialProfile> {
        if (!this.#profile) {
            this.#profile = this.#apiClient
                .connectapi<SocialProfile>(SOCIAL_PROFILE_ENDPOINT)
                .then((profile) => {
                    if (
                        !profile ||
                        typeof profile.displayName !== "string" ||
                        typeof profile.profileId !== "number"
                    ) {
                        throw new GarminError(
                            "Garmin returned an incomplete social profile",
                        );
                    }
                    return profile;
                })
                .catch((error: unknown) => {
                    this.#profile = null;
                    throw error;
                });
        }
        return this.#profile;
    }

    async #userSettings(): Promise<UserSettings> {
        if (!this.#settings) {
            this.#settings = this.#apiClient
                .connectapi<UserSettings>(USER_SETTINGS_ENDPOINT)
                .then((settings) => {
                    if (!settings)
                        throw new GarminError(
                            "Garmin returned no user settings",
                        );
                    return settings;
                })
                .catch((error: unknown) => {
                    this.#settings = null;
                    throw error;
                });
        }
        return this.#settings;
    }
}

export type { MfaChallenge };
