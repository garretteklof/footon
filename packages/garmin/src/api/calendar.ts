import { GarminError } from "@/errors";
import type { ApiClient } from "../types/api";
import { formatDate } from "@/util/date";
import { pathSegment } from "@/util/validate";
import type {
    CalendarEvent,
    CalendarEventDistanceUnit,
    CalendarEventInput,
    CalendarEventUpdate,
} from "../types/calendar";

interface CalendarHost {
    readonly client: ApiClient;
}

export function createCalendarApi(host: CalendarHost) {
    /** Uses an inclusive date range. If both dates are omitted, returns all account events. */
    async function listCalendarEvents(
        startdate?: string | Date,
        enddate?: string | Date,
    ): Promise<CalendarEvent[] | null> {
        if ((startdate === undefined) !== (enddate === undefined)) {
            throw new GarminError(
                "listCalendarEvents takes both startdate and enddate, or neither",
            );
        }
        const params =
            startdate !== undefined && enddate !== undefined
                ? { startDate: formatDate(startdate), endDate: formatDate(enddate) }
                : undefined;
        return host.client.connectapi<CalendarEvent[]>("/calendar-service/events", {
            params,
        });
    }

    /** Garmin uses HTTP 404 for an unknown event ID. */
    async function getCalendarEvent(
        eventId: number | string,
    ): Promise<CalendarEvent | null> {
        return host.client.connectapi<CalendarEvent>(
            `/calendar-service/event/${pathSegment(eventId)}`,
        );
    }

    /** Uses `/shareable` and a catalogue event's `shareableEventUuid`. User-created events have no UUID. */
    async function getSharedCalendarEvent(
        shareableEventUuid: string,
    ): Promise<CalendarEvent | null> {
        if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                shareableEventUuid,
            )
        ) {
            throw new GarminError(
                `Invalid shareable event UUID: "${shareableEventUuid}"`,
            );
        }
        return host.client.connectapi<CalendarEvent>(
            `/calendar-service/event/${pathSegment(shareableEventUuid)}/shareable`,
        );
    }

    /** Garmin returns the saved event with its ID. It forces user-created events to private. */
    async function createCalendarEvent(
        input: CalendarEventInput,
    ): Promise<CalendarEvent | null> {
        if (!input.name.trim())
            throw new GarminError("createCalendarEvent requires a non-empty name");
        if ((input.startTime === undefined) !== (input.timeZoneId === undefined)) {
            throw new GarminError(
                "startTime and timeZoneId go together: give both or neither",
            );
        }
        if (
            input.startTime !== undefined &&
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)
        ) {
            throw new GarminError(
                `startTime must be "HH:MM" (24-hour); got "${input.startTime}"`,
            );
        }
        if (input.distance !== undefined) {
            if (
                !Number.isFinite(input.distance.value) ||
                input.distance.value <= 0
            ) {
                throw new GarminError("distance.value must be a positive number");
            }
            if (!DISTANCE_UNITS.has(input.distance.unit)) {
                throw new GarminError(
                    `distance.unit must be meter, kilometer, yard or mile; got "${input.distance.unit}"`,
                );
            }
        }
        const body: Record<string, unknown> = {
            eventName: input.name,
            date: formatDate(input.date),
        };
        if (input.startTime !== undefined) {
            body["eventTimeLocal"] = {
                startTimeHhMm: input.startTime,
                timeZoneId: input.timeZoneId,
            };
        }
        if (input.eventType !== undefined) body["eventType"] = input.eventType;
        if (input.race !== undefined) body["race"] = input.race;
        if (input.distance !== undefined) {
            body["completionTarget"] = { ...input.distance, unitType: "distance" };
        }
        if (input.goalTimeSeconds !== undefined || input.primary !== undefined) {
            body["eventCustomization"] = {
                customGoal:
                    input.goalTimeSeconds === undefined
                        ? null
                        : timeGoal(input.goalTimeSeconds),
                isPrimaryEvent: input.primary ?? false,
            };
        }
        if (input.location !== undefined) body["location"] = input.location;
        if (input.url !== undefined) body["url"] = input.url;
        if (input.note !== undefined) body["note"] = input.note;
        return host.client.connectapi<CalendarEvent>("/calendar-service/event", {
            method: "POST",
            json: body,
        });
    }

    /** Sends the full event record. Concurrent updates can overwrite changes. Garmin returns no PUT body. */
    async function updateCalendarEvent(
        eventId: number | string,
        changes: CalendarEventUpdate,
    ): Promise<unknown> {
        if (Object.values(changes).every((v) => v === undefined)) {
            throw new GarminError(
                "updateCalendarEvent needs at least one field to change",
            );
        }
        if (changes.name !== undefined && !changes.name.trim()) {
            throw new GarminError("updateCalendarEvent cannot set an empty name");
        }
        const path = `/calendar-service/event/${pathSegment(eventId)}`;
        const current = await host.client.connectapi<CalendarEvent>(path);
        if (!current) {
            throw new GarminError(
                `Cannot update calendar event ${String(eventId)}: Garmin returned nothing`,
            );
        }
        const body: CalendarEvent = { ...current };
        if (changes.name !== undefined) body.eventName = changes.name;
        if (changes.date !== undefined) body.date = formatDate(changes.date);
        if (changes.location !== undefined) body.location = changes.location;
        if (changes.url !== undefined) body.url = changes.url;
        if (changes.note !== undefined) body.note = changes.note;
        if (changes.race !== undefined) body.race = changes.race;
        if (changes.goalTimeSeconds !== undefined) {
            body.eventCustomization = {
                ...current.eventCustomization,
                customGoal:
                    changes.goalTimeSeconds === null
                        ? null
                        : timeGoal(changes.goalTimeSeconds),
            };
        }
        return host.client.connectapi(path, { method: "PUT", json: body });
    }

    /** Event deletion cannot be undone. */
    async function deleteCalendarEvent(
        eventId: number | string,
    ): Promise<unknown> {
        return host.client.connectapi(
            `/calendar-service/event/${pathSegment(eventId)}`,
            { method: "DELETE" },
        );
    }

    return {
        list: listCalendarEvents,
        get: getCalendarEvent,
        getShared: getSharedCalendarEvent,
        create: createCalendarEvent,
        update: updateCalendarEvent,
        delete: deleteCalendarEvent,
    };
}

const DISTANCE_UNITS: ReadonlySet<string> = new Set<CalendarEventDistanceUnit>([
    "meter",
    "kilometer",
    "yard",
    "mile",
]);

function timeGoal(seconds: number): {
    value: number;
    unit: string;
    unitType: string;
} {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new GarminError(
            `goalTimeSeconds must be a positive number; got ${String(seconds)}`,
        );
    }
    return { value: seconds, unit: "second", unitType: "time" };
}
