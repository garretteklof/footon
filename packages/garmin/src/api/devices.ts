import { pathSegment } from "@/util/validate";
import { GarminConnectionError, GarminError } from "@/errors";
import type { ApiClient } from "../types/api";
import { formatDate } from "@/util/date";
import type {
    Device,
    DeviceLastUsed,
    DeviceSettings,
    DeviceSolarDataResponse,
    PrimaryTrainingDevice,
} from "../types/devices";

interface DevicesHost {
    readonly client: ApiClient;
}

export function createDevicesApi(host: DevicesHost) {
    async function getDevices(): Promise<Device[] | null> {
        return host.client.connectapi<Device[]>(
            "/device-service/deviceregistration/devices",
        );
    }

    async function getDeviceSettings(
        deviceId: number | string,
    ): Promise<DeviceSettings | null> {
        const id = validateDeviceId(deviceId);
        return host.client.connectapi<DeviceSettings>(
            `/device-service/deviceservice/device-info/settings/${pathSegment(id)}`,
        );
    }

    async function getPrimaryTrainingDevice(): Promise<PrimaryTrainingDevice | null> {
        return host.client.connectapi<PrimaryTrainingDevice>(
            "/web-gateway/device-info/primary-training-device",
        );
    }

    /**
     * Garmin returns solar entries in `deviceSolarInput`.
     * The method uses single-day mode without `enddate`.
     * A missing field raises an error. An empty field returns `[]`.
     */
    async function getDeviceSolarData(
        deviceId: number | string,
        startdate: string | Date,
        enddate?: string | Date,
    ): Promise<unknown[]> {
        const id = validateDeviceId(deviceId);
        const start = formatDate(startdate);
        const singleDayView = enddate === undefined;
        const end = singleDayView ? start : formatDate(enddate);
        const resp = await host.client.connectapi<DeviceSolarDataResponse>(
            `/web-gateway/solar/${pathSegment(id)}/${pathSegment(start)}/${pathSegment(end)}`,
            { params: { singleDayView: String(singleDayView) } },
        );
        if (!resp || !("deviceSolarInput" in resp)) {
            throw new GarminConnectionError("No device solar input data received");
        }
        return resp.deviceSolarInput ?? [];
    }

     async function getDeviceLastUsed(): Promise<DeviceLastUsed | null> {
        return host.client.connectapi<DeviceLastUsed>(
            "/device-service/deviceservice/mylastused",
        );
    }

    /** Requires an ID for each device. Skips missing alarm lists and returns `[]` when no devices exist. */
    async function getDeviceAlarms(): Promise<unknown[]> {
        const devices = await getDevices();
        const alarms: unknown[] = [];
        for (const device of devices ?? []) {
            if (device.deviceId === undefined) {
                throw new GarminError(
                    "getDeviceAlarms: device entry missing deviceId",
                );
            }
            const settings = await getDeviceSettings(device.deviceId);
            const deviceAlarms = settings?.alarms;
            if (deviceAlarms != null) {
                alarms.push(...deviceAlarms);
            }
        }
        return alarms;
    }

    return {
        list: getDevices,
        getSettings: getDeviceSettings,
        getPrimaryTrainingDevice: getPrimaryTrainingDevice,
        getSolarData: getDeviceSolarData,
        getLastUsed: getDeviceLastUsed,
        getAlarms: getDeviceAlarms,
    };
}

/** Rejects malformed IDs such as `"123abc"` instead of parsing their numeric prefix. */
function validateDeviceId(deviceId: number | string): string {
    const n = Number(deviceId);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        throw new GarminError(`Invalid device id: "${String(deviceId)}"`);
    }
    return String(n);
}
