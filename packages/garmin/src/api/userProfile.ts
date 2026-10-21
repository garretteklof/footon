import type { ApiClient } from "../types/api";
import type {
    SocialProfile,
    UserprofileSettings,
    UserSettings,
} from "../types/userProfile";

interface UserProfileHost {
    readonly client: ApiClient;
}

interface ProfileApiHost extends UserProfileHost {
    getUserProfile(): Promise<SocialProfile>;
    getUserSettings(): Promise<UserSettings>;
}

export function createProfileApi(host: ProfileApiHost) {
    /** Reads user-profile settings from a separate endpoint. */
    async function getUserprofileSettings(): Promise<UserprofileSettings | null> {
        return host.client.connectapi<UserprofileSettings>(
            "/userprofile-service/userprofile/settings",
        );
    }

    /** Garmin marks Connect+ access with a premium icon or feature-role prefix. */
     async function hasConnectPlus(): Promise<boolean> {
        const profile = await host.getUserProfile();
        if (profile["hasPremiumSocialIcon"] === true) return true;
        const roles = profile["userRoles"];
        return (
            Array.isArray(roles) &&
            roles.some(
                (r) => typeof r === "string" && r.startsWith("ROLE_SP_FEATURE_"),
            )
        );
    }

    return {
        get: (): Promise<SocialProfile> => host.getUserProfile(),
        measurementSystem: async () =>
            (await host.getUserSettings()).userData?.measurementSystem,
        getSettings: getUserprofileSettings,
        hasConnectPlus,
    };
}
